import { z } from 'zod'
import { config } from '@/pipeline/config'
import { llm, LlmOutputError, LlmUnavailableError } from '@/pipeline/llm'
import type { CheckResult } from '@/src/lib/schema/pending'

/**
 * Fields a second, independent model reads again before a change is trusted. `*.` is any prefix.
 * `tinnitus` is here (Ruling T) because it is a boolean, which the literal check cannot verify. The model
 * type is not: it is checked against the brand's default type (see extractModel).
 */
export const RISKY_PATHS = ['*.weightG', '*.dimensionsMm', '*.ipRating', '*.power', 'connectivity', 'tinnitus'] as const

export function isRisky(path: string): boolean {
  return RISKY_PATHS.some((pattern) => (pattern.startsWith('*.') ? path.endsWith(pattern.slice(1)) : path === pattern))
}

/** What the re-read value must look like, by the last segment of the path. */
const HINTS: Record<string, string> = {
  weightG: 'the weight of ONE hearing aid in grams (convert from other units; halve the weight of a pair)',
  dimensionsMm: 'length l, width w and height h in millimetres (convert from other units)',
  ipRating: 'the IP rating code, such as "IP68"',
  power: 'type is one of "rechargeable", "10", "312", "13", "675" (battery size); batteryHours is hours per charge; chargingCase is whether a charging case comes with it',
  connectivity: 'mfi = Made for iPhone, asha = Audio Streaming for Hearing Aids, leAudio = Bluetooth LE Audio, auracast = Auracast',
  tinnitus: 'true if the hearing aid has a tinnitus feature such as a sound generator',
}

/** The JSON shape of `value` with its values replaced by type names, so the reader is not told the answer. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return [value.length > 0 ? shapeOf(value[0]) : 'string']
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shapeOf(child)]))
  }
  return typeof value
}

const TOLERANCE = 0.02

function agrees(expected: unknown, actual: unknown): boolean {
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Math.abs(expected - actual) <= TOLERANCE * Math.max(Math.abs(expected), Math.abs(actual))
  }
  if (typeof expected === 'string') {
    return typeof actual === 'string' && expected.trim().toLowerCase() === actual.trim().toLowerCase()
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length && expected.every((item, i) => agrees(item, actual[i]))
  }
  if (typeof expected === 'object' && expected !== null) {
    // Only what the value claims is compared: a key the reader adds is not a contradiction.
    if (typeof actual !== 'object' || actual === null) return false
    return Object.entries(expected).every(([key, child]) => agrees(child, (actual as Record<string, unknown>)[key]))
  }
  return expected === actual
}

const Reread = z.strictObject({ value: z.unknown() })

/** Sonnet reads the value again from the quote alone (extraction runs on Haiku); numbers may differ by 2%. */
export async function crossCheck(path: string, quote: string, value: unknown): Promise<CheckResult> {
  const field = path.split('.').at(-1) ?? path
  const prompt = [
    `Read the value of the hearing aid spec field "${field}" from the quote below. Use only the quote.`,
    HINTS[field] ? `Meaning: ${HINTS[field]}.` : '',
    `Put what you read in the "value" field of your answer. It has this shape: ${JSON.stringify(shapeOf(value))}.`,
    'Leave out object keys the quote does not state. If the quote does not state the value at all, set "value" to null.',
    '',
    `Quote: """${quote}"""`,
  ].join('\n')

  let reread: unknown
  try {
    ;({ value: reread } = await llm({ prompt, schema: Reread, provider: 'claude', model: config.llm.crossCheckModel }))
  } catch (error) {
    if (error instanceof LlmUnavailableError) return { name: 'crosscheck', ok: false, detail: 'crosscheck-unavailable' }
    if (error instanceof LlmOutputError) return { name: 'crosscheck', ok: false, detail: 'crosscheck-output-invalid' }
    throw error
  }

  return agrees(value, reread)
    ? { name: 'crosscheck', ok: true }
    : { name: 'crosscheck', ok: false, detail: `sonnet read ${JSON.stringify(reread ?? null)}` }
}
