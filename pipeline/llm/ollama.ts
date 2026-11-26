import { Agent, fetch as undiciFetch } from 'undici'
import { config } from '@/pipeline/config'
import { LlmUnavailableError, parseOutput, timeoutError } from './errors'

// Without streaming, Ollama sends no headers until generation ends, and Node's own `fetch`
// gives up after 300 s. Turn those limits off: the request signal is the only deadline.
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })

// The cast: undici's `fetch` types differ from the DOM ones in details this file never uses.
const longFetch = ((url: string, init: object) => undiciFetch(url, { ...init, dispatcher })) as unknown as typeof fetch

export async function callOllama(
  request: { prompt: string; jsonSchema: object },
  fetchImpl: typeof fetch = longFetch,
): Promise<unknown> {
  const { ollamaUrl, ollamaModel, ollamaNumCtx } = config.llm
  const timeout = config.llm.timeoutMs.ollama
  const signal = AbortSignal.timeout(timeout)

  let response: Response
  let text: string
  try {
    response = await fetchImpl(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [{ role: 'user', content: request.prompt }],
        format: request.jsonSchema,
        stream: false,
        options: { num_ctx: ollamaNumCtx },
      }),
      signal,
    })
    text = await response.text()
  } catch (cause) {
    if (signal.aborted) throw timeoutError('Ollama', timeout, { cause })
    if ((cause as { cause?: { code?: string } }).cause?.code !== 'ECONNREFUSED') throw cause
    throw new LlmUnavailableError(`Ollama is not running at ${ollamaUrl}`, { cause })
  }

  if (!response.ok) {
    const message = `Ollama HTTP ${response.status}: ${text.slice(0, 200)}`
    // 404 means the model has not been pulled.
    throw response.status === 404 ? new LlmUnavailableError(message) : new Error(message)
  }

  const body = parseOutput('Ollama', text) as { message?: { content?: string } }
  return parseOutput('Ollama', body.message?.content ?? '')
}
