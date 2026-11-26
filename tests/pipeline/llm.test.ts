// @vitest-environment node
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError } from '@google/genai'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { config } from '@/pipeline/config'
import { llm, LlmLimitError, LlmOutputError, LlmUnavailableError, type LlmDeps } from '@/pipeline/llm'

const schema = z.strictObject({ ok: z.boolean() })

let cacheDir: string
beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'llm-cache-'))
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(cacheDir, { recursive: true, force: true })
})

const cached = () => readdir(cacheDir)

// Trimmed from real `claude -p --output-format json --json-schema` envelopes (CLI 2.1.319).
// A success adds `structured_output`.
function envelope(extra: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    api_error_status: null,
    stop_reason: 'tool_use',
    terminal_reason: 'completed',
    num_turns: 2,
    result: '{"ok":true}',
    total_cost_usd: 0.01,
    ...extra,
  })
}

const stubExec = (stdout: string) => vi.fn(async () => ({ stdout, stderr: '' }))

/** Rejects the way a promisified execFile does: message holds the whole command line. */
const stubExecFail = (stderr: string, extra: { stdout?: string; code?: number | string } = {}) =>
  vi.fn(async (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    throw Object.assign(new Error(`Command failed: ${file} ${args.join(' ')}\n${stderr}`), {
      code: 1,
      stdout: '',
      stderr,
      ...extra,
    })
  })

const run = (deps: LlmDeps, opts: Partial<Parameters<typeof llm>[0]> = {}) =>
  llm({ prompt: 'Return ok=true', schema, provider: 'claude', ...opts }, { cacheDir, ...deps })

describe('claude', () => {
  test('result is parsed and cached', async () => {
    const exec = stubExec(envelope({ structured_output: { ok: true } }))

    await expect(run({ exec })).resolves.toEqual({ ok: true })
    await expect(run({ exec })).resolves.toEqual({ ok: true })

    expect(exec).toHaveBeenCalledTimes(1)
    expect(await cached()).toEqual([expect.stringMatching(/^[0-9a-f]{64}\.json$/)])
  })

  test('passes the prompt, a draft-07 schema, the model and allowed tools', async () => {
    const exec = stubExec(envelope({ structured_output: { ok: true } }))

    await run({ exec }, { tools: ['WebSearch'] })

    expect(exec).toHaveBeenCalledWith('claude', [
      '-p',
      'Return ok=true',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(z.toJSONSchema(schema, { target: 'draft-7' })),
      '--model',
      config.llm.claudeModel,
      '--safe-mode',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--setting-sources',
      '',
      '--tools',
      'WebSearch',
      '--allowedTools',
      'WebSearch',
    ])
  })

  test('without tools, offers none and loads nothing from the owner setup', async () => {
    const exec = vi.fn<NonNullable<LlmDeps['exec']>>(async () => ({
      stdout: envelope({ structured_output: { ok: true } }),
      stderr: '',
    }))

    await run({ exec })

    const [, args] = exec.mock.calls[0]
    expect(args.slice(args.indexOf(config.llm.claudeModel) + 1)).toEqual([
      '--safe-mode',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--setting-sources',
      '',
      '--tools',
      '',
    ])
  })

  test('different tools do not share a cache entry', async () => {
    const exec = stubExec(envelope({ structured_output: { ok: true } }))

    await run({ exec })
    await run({ exec }, { tools: ['WebSearch'] })

    expect(exec).toHaveBeenCalledTimes(2)
  })

  test('cached value that no longer passes the schema is fetched again', async () => {
    const exec = stubExec(envelope({ structured_output: { ok: true } }))
    await run({ exec })
    const [file] = await cached()
    await writeFile(join(cacheDir, file), '{"ok":"stale"}')

    await expect(run({ exec })).resolves.toEqual({ ok: true })
    expect(exec).toHaveBeenCalledTimes(2)
  })

  test('missing binary → LlmUnavailableError', async () => {
    const exec = stubExecFail('', { code: 'ENOENT' })

    await expect(run({ exec })).rejects.toBeInstanceOf(LlmUnavailableError)
  })

  test('expired login → LlmUnavailableError, although the message mentions a limit', async () => {
    const result =
      'Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again'
    const exec = stubExecFail('', { stdout: envelope({ is_error: true, result }) })

    await expect(run({ exec })).rejects.toBeInstanceOf(LlmUnavailableError)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  test('usage-limit stderr → LlmLimitError without a retry', async () => {
    const exec = stubExecFail('Usage limit reached')

    await expect(run({ exec })).rejects.toBeInstanceOf(LlmLimitError)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  test.each([
    { result: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}' },
    { result: 'Request rejected', api_error_status: 429 },
  ])('error envelope $result → LlmLimitError', async (extra) => {
    const exec = stubExec(envelope({ is_error: true, ...extra }))

    await expect(run({ exec })).rejects.toBeInstanceOf(LlmLimitError)
  })

  test('other failures are not reported as limits, even if the prompt says "limit"', async () => {
    const exec = stubExecFail('Could not generate an accurate response')

    const error = await run({ exec }, { prompt: 'What is the output limit?' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(LlmLimitError)
    expect((error as Error).message).toContain('Could not generate')
    expect((error as Error).message).not.toContain('output limit')
  })

  test('invalid JSON twice → LlmOutputError, nothing cached', async () => {
    const exec = stubExec('not json {')

    await expect(run({ exec })).rejects.toBeInstanceOf(LlmOutputError)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(await cached()).toEqual([])
  })

  test('schema violation twice → LlmOutputError, nothing cached', async () => {
    const exec = stubExec(envelope({ structured_output: { ok: 'yes' } }))

    await expect(run({ exec })).rejects.toBeInstanceOf(LlmOutputError)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(await cached()).toEqual([])
  })

  test.each([
    envelope({ result: '{"ok":true}' }),
    envelope({ is_error: true, subtype: 'error_max_structured_output_retries' }),
  ])('envelope without structured output → LlmOutputError', async (stdout) => {
    await expect(run({ exec: stubExec(stdout) })).rejects.toBeInstanceOf(LlmOutputError)
  })

  test('one bad answer is retried', async () => {
    const exec = vi
      .fn<NonNullable<LlmDeps['exec']>>()
      .mockResolvedValueOnce({ stdout: 'oops', stderr: '' })
      .mockResolvedValueOnce({ stdout: envelope({ structured_output: { ok: true } }), stderr: '' })

    await expect(run({ exec })).resolves.toEqual({ ok: true })
    expect(exec).toHaveBeenCalledTimes(2)
  })
})

describe('ollama', () => {
  const reply = (content: string) => vi.fn<typeof fetch>(async () => Response.json({ message: { content } }))
  const ollama = (deps: LlmDeps) => run(deps, { provider: 'ollama' })

  test('posts the chat request with the schema as format', async () => {
    const fetch = reply('{"ok":true}')

    await expect(ollama({ fetch })).resolves.toEqual({ ok: true })

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${config.llm.ollamaUrl}/api/chat`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      model: config.llm.ollamaModel,
      messages: [{ role: 'user', content: 'Return ok=true' }],
      format: z.toJSONSchema(schema),
      stream: false,
    })
  })

  test('ECONNREFUSED → LlmUnavailableError', async () => {
    const fetch = vi.fn(async (): Promise<Response> => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ECONNREFUSED' }) })
    })

    await expect(ollama({ fetch })).rejects.toBeInstanceOf(LlmUnavailableError)
  })

  test('model not pulled (404) → LlmUnavailableError', async () => {
    const fetch = vi.fn(async () => Response.json({ error: 'model not found' }, { status: 404 }))

    await expect(ollama({ fetch })).rejects.toBeInstanceOf(LlmUnavailableError)
  })

  test('invalid JSON content → LlmOutputError', async () => {
    const fetch = reply('sure! ok=true')

    await expect(ollama({ fetch })).rejects.toBeInstanceOf(LlmOutputError)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('gemini', () => {
  const youtubeUrl = 'https://www.youtube.com/watch?v=9hE5-98ZeCg'
  const stubGemini = (text: string) => ({ generateContent: vi.fn(async () => ({ text })) })
  const gemini = (deps: LlmDeps, url?: string) => run(deps, { provider: 'gemini', youtubeUrl: url })

  test('sends the video, the prompt and a low media resolution', async () => {
    const client = stubGemini('{"ok":true}')

    await expect(gemini({ gemini: client }, youtubeUrl)).resolves.toEqual({ ok: true })

    expect(client.generateContent).toHaveBeenCalledWith({
      model: config.llm.geminiModel,
      contents: [{ role: 'user', parts: [{ fileData: { fileUri: youtubeUrl } }, { text: 'Return ok=true' }] }],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: z.toJSONSchema(schema),
        mediaResolution: 'MEDIA_RESOLUTION_LOW',
      },
    })
  })

  test('each video has its own cache entry', async () => {
    const client = stubGemini('{"ok":true}')

    await gemini({ gemini: client }, youtubeUrl)
    await gemini({ gemini: client }, 'https://www.youtube.com/watch?v=other')
    await gemini({ gemini: client })

    expect(client.generateContent).toHaveBeenCalledTimes(3)
    expect(await cached()).toHaveLength(3)
  })

  test('HTTP 429 → LlmLimitError', async () => {
    const client = {
      generateContent: vi.fn(async (): Promise<{ text: string }> => {
        throw new ApiError({ status: 429, message: 'RESOURCE_EXHAUSTED' })
      }),
    }

    await expect(gemini({ gemini: client })).rejects.toBeInstanceOf(LlmLimitError)
    expect(client.generateContent).toHaveBeenCalledTimes(1)
  })

  test('empty response → LlmOutputError', async () => {
    const client = { generateContent: vi.fn(async () => ({ text: undefined })) }

    await expect(gemini({ gemini: client })).rejects.toBeInstanceOf(LlmOutputError)
  })

  test('no GEMINI_API_KEY → LlmUnavailableError', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')

    await expect(gemini({})).rejects.toBeInstanceOf(LlmUnavailableError)
  })
})
