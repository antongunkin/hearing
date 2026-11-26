// Spec values are reported in US units; the site stores metric. Conversions are pure.

const UNIT_ALIASES = new Map<string, string>([
  ['g', 'g'],
  ['mg', 'mg'],
  ['oz', 'oz'],
  ['mm', 'mm'],
  ['cm', 'cm'],
  ['in', 'in'],
  ['inch', 'in'],
  ['inches', 'in'],
])

// Longer alternatives first so "mg" is not read as "g" and "inches" as "in".
const MEASUREMENT = /(\d+(?:\.\d+)?)\s*(mg|g|oz|mm|cm|inches|inch|in)\b/i

/** First number + unit in the text, with the unit normalised ("Inches" → "in"). */
export function parseMeasurement(text: string): { value: number; unit: string } | null {
  const match = MEASUREMENT.exec(text)
  if (!match) return null
  const unit = UNIT_ALIASES.get(match[2].toLowerCase())
  if (unit === undefined) return null
  return { value: Number(match[1]), unit }
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
  const factor = GRAMS_PER_UNIT.get(unit)
  if (factor === undefined) throw new Error(`not a mass unit: ${unit}`)
  return value * factor
}

export function toMm(value: number, unit: string): number {
  const factor = MM_PER_UNIT.get(unit)
  if (factor === undefined) throw new Error(`not a length unit: ${unit}`)
  return value * factor
}
