/** The provider cannot be used at all: not installed, not running, not signed in. */
export class LlmUnavailableError extends Error {
  override name = 'LlmUnavailableError'
}

/** Quota or rate limit: stop and try again later. */
export class LlmLimitError extends Error {
  override name = 'LlmLimitError'
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
