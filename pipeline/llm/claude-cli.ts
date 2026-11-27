// `claude -p … --output-format json` prints one JSON envelope. With `--json-schema`, the
// structured result is the parsed object in its `structured_output` field (`result` carried
// the same JSON as a string; it is not used).
// Failures set `is_error: true` with the message in `result`, on stdout, with exit code 1.
// Observed with CLI 2.1.319 on 2026-11-26, both success and authentication failure.
// The validator rejects the draft-2020-12 `$schema` that Zod emits by default: pass draft-07.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '@/pipeline/config'
import { LlmLimitError, LlmOutputError, LlmUnavailableError, parseOutput, timeoutError } from './errors'

export type Exec = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number },
) => Promise<{ stdout: string; stderr: string }>

const execFileAsync = promisify(execFile)

// Prompts carry scraped web text, so the call gets none of the owner's setup: no hooks,
// plugins, CLAUDE.md, MCP servers or permission rules, and no built-in tools beyond the ones
// asked for. Tested as a set with CLI 2.1.319: 339 tools and 36.8k input tokens without them,
// 1 tool and 3.6k with them. Not `--bare`, which ignores the subscription login.
const ISOLATION = ['--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--setting-sources', '']

const defaultExec: Exec = (file, args, options) => {
  // SIGKILL, so that a child that ignores SIGTERM cannot outlive the deadline.
  const call = execFileAsync(file, args, { ...options, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024 })
  call.child.stdin?.end() // otherwise `claude -p` waits for piped input
  return call
}

interface Envelope {
  is_error?: boolean
  subtype?: string
  api_error_status?: number | null
  result?: string
  structured_output?: unknown
}

// Checked before the limit pattern: an expired login says it "reached its time limit".
const AUTH = /failed to authenticate|not logged in|invalid api key|please run \/login/i
const LIMIT = /\b(rate|limit(s|ed)?)\b|rate_limit/i

function failure(envelope: Envelope | undefined, stderr: string): Error {
  const detail = [envelope?.result, envelope?.subtype, stderr].filter(Boolean).join('\n')
  const message = `claude failed: ${detail.slice(0, 500)}`

  if (envelope?.subtype === 'error_max_structured_output_retries') return new LlmOutputError(message)
  if (AUTH.test(detail)) return new LlmUnavailableError(message)
  if (envelope?.api_error_status === 429 || LIMIT.test(detail)) return new LlmLimitError('claude', message)
  return new Error(message)
}

function readEnvelope(stdout: string): Envelope | undefined {
  try {
    return JSON.parse(stdout) ?? undefined
  } catch {
    return undefined
  }
}

export async function callClaude(
  request: { prompt: string; jsonSchema: object; tools?: string[] },
  exec: Exec = defaultExec,
): Promise<unknown> {
  const { prompt, jsonSchema, tools } = request
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(jsonSchema),
    '--model',
    config.llm.claudeModel,
    ...ISOLATION,
    '--tools',
    tools?.join(',') ?? '', // '' disables every built-in tool
    ...(tools ? ['--allowedTools', tools.join(',')] : []),
  ]

  // Each would take the call off the subscription: an API key or token bills an API account, and the
  // others send it to Bedrock, Vertex or another endpoint.
  const {
    ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN,
    CLAUDE_CODE_USE_BEDROCK,
    CLAUDE_CODE_USE_VERTEX,
    ANTHROPIC_BASE_URL,
    ...env
  } = process.env
  const timeout = config.llm.timeoutMs.claude

  let stdout: string
  try {
    ;({ stdout } = await exec('claude', args, { env, timeout }))
  } catch (error) {
    // `error.message` repeats the whole command line, prompt included: never match on it.
    const { code, killed, stdout = '', stderr = '' } = error as {
      code?: unknown
      killed?: boolean
      stdout?: string
      stderr?: string
    }
    if (code === 'ENOENT') throw new LlmUnavailableError('claude CLI not found in PATH')
    if (killed) throw timeoutError('claude', timeout)
    throw failure(readEnvelope(stdout), stderr || `exit code ${code}`)
  }

  const envelope = parseOutput('claude', stdout) as Envelope
  if (envelope.is_error) throw failure(envelope, '')
  if (envelope.structured_output === undefined) {
    throw new LlmOutputError(`claude returned no structured_output: ${String(envelope.result).slice(0, 200)}`)
  }
  return envelope.structured_output
}
