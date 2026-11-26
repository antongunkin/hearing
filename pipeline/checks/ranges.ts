import type { CheckResult } from '@/src/lib/schema/pending'

interface Range {
  min: number
  max: number
}

const WEIGHT_G: Range = { min: 0.5, max: 10 }
const DIMENSION_MM: Range = { min: 3, max: 60 }
const BATTERY_HOURS: Range = { min: 1, max: 200 }
const OTC_PRICE_USD: Range = { min: 50, max: 5000 }
const RX_PRICE_USD: Range = { min: 500, max: 10000 }

const RULE_KEYS = new Set(['weightG', 'dimensionsMm', 'batteryHours', 'priceUsd'])

function outside(value: unknown, { min, max }: Range): boolean {
  return typeof value !== 'number' || !(value >= min && value <= max)
}

/** Returns a violation message, or undefined when the value passes the rule for `key`. */
function violation(key: string, value: unknown): string | undefined {
  switch (key) {
    case 'weightG':
      return outside(value, WEIGHT_G) ? `weightG ${JSON.stringify(value)} outside 0.5–10 g` : undefined
    case 'dimensionsMm': {
      const dims = typeof value === 'object' && value !== null ? Object.values(value) : [value]
      return dims.length === 0 || dims.some((dim) => outside(dim, DIMENSION_MM))
        ? `dimensionsMm ${JSON.stringify(value)} has a value outside 3–60 mm`
        : undefined
    }
    case 'batteryHours':
      return outside(value, BATTERY_HOURS) ? `batteryHours ${JSON.stringify(value)} outside 1–200 h` : undefined
    case 'priceUsd': {
      if (typeof value === 'number') {
        return outside(value, OTC_PRICE_USD) ? `priceUsd ${value} outside 50–5000 USD` : undefined
      }
      if (typeof value === 'object' && value !== null) {
        const { min, max } = value as { min?: unknown; max?: unknown }
        const bad = outside(min, RX_PRICE_USD) || outside(max, RX_PRICE_USD) || (min as number) > (max as number)
        return bad ? `priceUsd ${JSON.stringify(value)} is not a valid Rx pair (500–10000, min ≤ max)` : undefined
      }
      return `priceUsd ${JSON.stringify(value)} has an unsupported shape`
    }
    default:
      return undefined
  }
}

/**
 * Plausibility bounds for known spec fields. The rule comes from the last path segment that names a
 * known field, so `variants.0.dimensionsMm.l` is checked against the dimension bounds. An object value
 * such as a power block is checked for the known fields it holds. Paths without a rule pass.
 */
export function rangeCheck(path: string, value: unknown): CheckResult {
  const key = path.split('.').findLast((segment) => RULE_KEYS.has(segment))
  const problems: string[] = []

  if (key !== undefined) {
    const problem = violation(key, value)
    if (problem) problems.push(problem)
  } else if (typeof value === 'object' && value !== null) {
    for (const [childKey, child] of Object.entries(value)) {
      if (!RULE_KEYS.has(childKey)) continue
      const problem = violation(childKey, child)
      if (problem) problems.push(problem)
    }
  }

  return problems.length === 0
    ? { name: 'range', ok: true }
    : { name: 'range', ok: false, detail: problems.join('; ') }
}
