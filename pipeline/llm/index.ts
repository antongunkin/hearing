import { z, type ZodType } from 'zod'
import { config } from '@/pipeline/config'
import { writeJson } from '@/src/lib/data/write'
import { cachePath, readCache } from './cache'
import { callClaude, type Exec } from './claude-cli'
import { LlmOutputError } from './errors'
import { callGemini, type GeminiClient } from './gemini'
import { callOllama } from './ollama'

export { LlmLimitError, LlmOutputError, LlmUnavailableError } from './errors'

export interface LlmOptions<T> {
  prompt: string
  schema: ZodType<T>
  provider: 'claude' | 'ollama' | 'gemini'
  /** Claude only. */
  tools?: ['WebSearch']
  /** Gemini only. */
  youtubeUrl?: string
}

/** Replacements for tests. */
export interface LlmDeps {
  exec?: Exec
  fetch?: typeof fetch
  gemini?: GeminiClient
  cacheDir?: string
}

const ATTEMPTS = 2

export async function llm<T>(options: LlmOptions<T>, deps: LlmDeps = {}): Promise<T> {
  const { prompt, schema, provider, tools, youtubeUrl } = options
  const model = config.llm[`${provider}Model`]
  // The Claude CLI validator accepts draft-07 only (see claude-cli.ts).
  const jsonSchema = z.toJSONSchema(schema, { target: provider === 'claude' ? 'draft-7' : 'draft-2020-12' })

  const path = cachePath(deps.cacheDir ?? '.cache/llm', [provider, model, prompt, jsonSchema, youtubeUrl, tools])
  const hit = await readCache(path)
  if (hit !== undefined) {
    const parsed = schema.safeParse(hit)
    if (parsed.success) return parsed.data
  }

  const call = () => {
    switch (provider) {
      case 'claude':
        return callClaude({ prompt, jsonSchema, tools }, deps.exec)
      case 'ollama':
        return callOllama({ prompt, jsonSchema }, deps.fetch)
      case 'gemini':
        return callGemini({ prompt, jsonSchema, youtubeUrl }, deps.gemini)
    }
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const raw = await call()
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        throw new LlmOutputError(`${provider} output does not match the schema:\n${z.prettifyError(parsed.error)}`)
      }
      // The raw answer is cached, so that reading it back parses the same input again.
      await writeJson(path, raw)
      return parsed.data
    } catch (error) {
      if (!(error instanceof LlmOutputError) || attempt === ATTEMPTS) throw error
    }
  }
}
