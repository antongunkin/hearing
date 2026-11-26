import { config } from '@/pipeline/config'
import { LlmUnavailableError, parseOutput } from './errors'

export async function callOllama(
  request: { prompt: string; jsonSchema: object },
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const { ollamaUrl, ollamaModel } = config.llm

  let response: Response
  try {
    response = await fetchImpl(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [{ role: 'user', content: request.prompt }],
        format: request.jsonSchema,
        stream: false,
      }),
    })
  } catch (cause) {
    if ((cause as { cause?: { code?: string } }).cause?.code !== 'ECONNREFUSED') throw cause
    throw new LlmUnavailableError(`Ollama is not running at ${ollamaUrl}`, { cause })
  }

  if (!response.ok) {
    const message = `Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`
    // 404 means the model has not been pulled.
    throw response.status === 404 ? new LlmUnavailableError(message) : new Error(message)
  }

  const body = (await response.json()) as { message?: { content?: string } }
  return parseOutput('Ollama', body.message?.content ?? '')
}
