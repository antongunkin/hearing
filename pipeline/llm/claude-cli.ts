// `claude -p … --output-format json` prints one JSON envelope. With `--json-schema`, the
// structured result is the parsed object in its `structured_output` field (`result` carried
// the same JSON as a string; it is not used).
// Failures set `is_error: true` with the message in `result`, on stdout, with exit code 1.
// Observed with CLI 2.1.319 on 2026-11-26, both success and authentication failure.
// The validator rejects the draft-2020-12 `$schema` that Zod emits by default: pass draft-07.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '@/pipeline/config'
import { LlmLimitError, LlmOutputError, LlmUnavailableError, parseOutput } from './errors'

export type Exec = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

const execFileAsync = promisify(execFile)

const defaultExec: Exec = (file, args) => {
  const call = execFileAsync(file, args, { maxBuffer: 10 * 1024 * 1024 })
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
  if (envelope?.api_error_status === 429 || LIMIT.test(detail)) return new LlmLimitError(message)
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
    ...(tools ? ['--allowedTools', tools.join(',')] : []),
  ]

  let stdout: string
  try {
    ;({ stdout } = await exec('claude', args))
  } catch (error) {
    // `error.message` repeats the whole command line, prompt included: never match on it.
    const { code, stdout = '', stderr = '' } = error as { code?: unknown; stdout?: string; stderr?: string }
    if (code === 'ENOENT') throw new LlmUnavailableError('claude CLI not found in PATH')
    throw failure(readEnvelope(stdout), stderr || `exit code ${code}`)
  }

  const envelope = parseOutput('claude', stdout) as Envelope
  if (envelope.is_error) throw failure(envelope, '')
  if (envelope.structured_output === undefined) {
    throw new LlmOutputError(`claude returned no structured_output: ${String(envelope.result).slice(0, 200)}`)
  }
  return envelope.structured_output
}
