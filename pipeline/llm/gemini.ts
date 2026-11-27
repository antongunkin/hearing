import { ApiError, GoogleGenAI, MediaResolution, type GenerateContentParameters } from '@google/genai'
import { config } from '@/pipeline/config'
import { LlmLimitError, LlmUnavailableError, parseOutput, timeoutError } from './errors'

/** The part of `new GoogleGenAI(…).models` used here. */
export interface GeminiClient {
  generateContent(params: GenerateContentParameters): Promise<{ text?: string }>
}

function defaultClient(): GeminiClient {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new LlmUnavailableError('GEMINI_API_KEY is not set')
  return new GoogleGenAI({ apiKey }).models
}

export async function callGemini(
  request: { prompt: string; jsonSchema: object; youtubeUrl?: string },
  client: GeminiClient = defaultClient(),
): Promise<unknown> {
  const { prompt, jsonSchema, youtubeUrl } = request
  const video = youtubeUrl ? [{ fileData: { fileUri: youtubeUrl } }] : []

  const timeout = config.llm.timeoutMs.gemini
  const abortSignal = AbortSignal.timeout(timeout)

  let text: string | undefined
  try {
    ;({ text } = await client.generateContent({
      model: config.llm.geminiModel,
      contents: [{ role: 'user', parts: [...video, { text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
        abortSignal,
      },
    }))
  } catch (cause) {
    if (abortSignal.aborted) throw timeoutError('Gemini', timeout, { cause })
    if (!(cause instanceof ApiError && cause.status === 429)) throw cause
    throw new LlmLimitError('gemini', `Gemini rate limit: ${cause.message.slice(0, 500)}`, { cause })
  }

  return parseOutput('Gemini', text ?? '')
}
