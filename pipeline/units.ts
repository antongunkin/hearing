// Spec values are reported in US units; the site stores metric. Conversions are pure.
// One number grammar and one unit table, shared by parsing (here) and literal verification (checks/literal.ts).

// Measurement units with their accepted written forms (lowercase). Other units are not measurements.
const UNIT_FORMS: ReadonlyArray<readonly [unit: string, forms: readonly string[]]> = [
  ['g', ['g', 'gram', 'grams']],
  ['mg', ['mg']],
  ['oz', ['oz', 'ounce', 'ounces']],
  ['mm', ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']],
  ['cm', ['cm']],
  ['in', ['in', 'inch', 'inches', '"']],
  ['h', ['h', 'hr', 'hour', 'hours']],
]

const FORM_TO_UNIT = new Map<string, string>(
  UNIT_FORMS.flatMap(([unit, forms]) => forms.map((form): [string, string] => [form, unit])),
)

// Thousands-separated numbers first, then plain and leading-dot decimals.
const NUMBER_SOURCE = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`

// Longest forms first, so a form is never matched as a prefix of a longer one.
const FORMS_BY_LENGTH = [...FORM_TO_UNIT.keys()].sort((a, b) => b.length - a.length)
const UNIT_ALTERNATION = FORMS_BY_LENGTH.map(escapeRegExp).join('|')

// A number, optional hyphen, then a whole unit word.
const MEASUREMENT = new RegExp(String.raw`(${NUMBER_SOURCE})\s*-?\s*(${UNIT_ALTERNATION})(?![a-z])`, 'i')

// Dimension chains such as "27 x 8 x 12 mm": the unit after the last number covers the whole chain.
const CHAIN = String.raw`(?:\s*(?:x|×|by)\s*(?:${NUMBER_SOURCE}))*`
const UNIT_AFTER_NUMBER = new Map<string, RegExp>(
  UNIT_FORMS.map(([unit, forms]) => [
    unit,
    new RegExp(String.raw`^${CHAIN}\s*-?\s*(?:${forms.map(escapeRegExp).join('|')})(?![a-z])`, 'i'),
  ]),
)

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Canonical measurement unit for a written unit or synonym ("grams" → "g"), or undefined if it is not a measurement. */
export function canonicalUnit(word: string): string | undefined {
  return FORM_TO_UNIT.get(word.trim().toLowerCase())
}

/** Every number in the text, with the index just after it. Grammar: `1,200`, `2.1`, `.07`. */
export function findNumbers(text: string): { value: number; end: number }[] {
  return [...text.matchAll(new RegExp(NUMBER_SOURCE, 'g'))].map((match) => ({
    value: Number(match[0].replaceAll(',', '')),
    end: match.index + match[0].length,
  }))
}

/** True when `unit` (a measurement unit or synonym) follows the number that ends at `end` in `text`. */
export function unitFollows(text: string, end: number, unit: string): boolean {
  const canonical = canonicalUnit(unit)
  const pattern = canonical === undefined ? undefined : UNIT_AFTER_NUMBER.get(canonical)
  if (pattern === undefined) throw new Error(`not a measurement unit: ${unit}`)
  return pattern.test(text.slice(end))
}

/** First number + unit in the text, with the unit canonical ("Inches" → "in", "grams" → "g"). */
export function parseMeasurement(text: string): { value: number; unit: string } | null {
  const match = MEASUREMENT.exec(text)
  if (!match) return null
  const unit = canonicalUnit(match[2])
  if (unit === undefined) return null
  return { value: Number(match[1].replaceAll(',', '')), unit }
}

const GRAMS_PER_UNIT = new Map<string, number>([
  ['g', 1],
  ['mg', 0.001],
  ['oz', 28.349523125],
])

const MM_PER_UNIT = new Map<string, number>([
  ['mm', 1],
  ['cm', 10],
  ['in', 25.4],
])

export function toGrams(value: number, unit: string): number {
  const factor = GRAMS_PER_UNIT.get(canonicalUnit(unit) ?? '')
  if (factor === undefined) throw new Error(`not a mass unit: ${unit}`)
  return value * factor
}

export function toMm(value: number, unit: string): number {
  const factor = MM_PER_UNIT.get(canonicalUnit(unit) ?? '')
  if (factor === undefined) throw new Error(`not a length unit: ${unit}`)
  return value * factor
}
