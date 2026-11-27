/** The provider cannot be used at all: not installed, not running, not signed in. */
export class LlmUnavailableError extends Error {
  override name = 'LlmUnavailableError'
  /** Set when the provider did not answer by the deadline. */
  detail?: 'timeout'
}

export function timeoutError(provider: string, ms: number, options?: ErrorOptions): LlmUnavailableError {
  const error = new LlmUnavailableError(`${provider} timeout: no answer within ${ms / 1000} s`, options)
  error.detail = 'timeout'
  return error
}

/** Quota or rate limit of `provider`: stop using it and try again later. */
export class LlmLimitError extends Error {
  override name = 'LlmLimitError'
  constructor(
    readonly provider: 'claude' | 'ollama' | 'gemini',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/** The model answered, but not with JSON that fits the schema. */
export class LlmOutputError extends Error {
  override name = 'LlmOutputError'
}

export function parseOutput(provider: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new LlmOutputError(`${provider} returned invalid JSON: ${text.slice(0, 200)}`, { cause })
  }
}
