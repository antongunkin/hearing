import type { CheckResult } from '@/src/lib/schema/pending'
import type { Sourced } from '@/src/lib/schema/field'

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

// Accepted written forms of each unit, all lowercase. An unlisted unit must appear in the quote as written.
const UNIT_FORMS = new Map<string, string[]>([
  ['g', ['g', 'gram', 'grams']],
  ['mg', ['mg']],
  ['oz', ['oz', 'ounce', 'ounces']],
  ['mm', ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']],
  ['cm', ['cm']],
  ['in', ['in', 'inch', 'inches', '"']],
  ['h', ['h', 'hr', 'hour', 'hours']],
])

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

interface QuotedNumber {
  value: number
  /** Index in the quote just after the number. */
  end: number
}

function quotedNumbers(quote: string): QuotedNumber[] {
  return [...quote.matchAll(NUMBER)].map((match) => ({
    value: Number(match[0].replaceAll(',', '')),
    end: match.index + match[0].length,
  }))
}

/** Numbers and strings nested anywhere in the value, e.g. the bounds of an Rx price pair. */
function leaves(value: unknown): unknown[] {
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(leaves)
  return [value]
}

/** Booleans and null are interpretations rather than quotable text, so they are not checked. */
function isQuoted(leaf: unknown, quote: string, numbers: QuotedNumber[]): boolean {
  if (typeof leaf === 'number') return numbers.some((n) => n.value === leaf)
  if (typeof leaf === 'string') return normalize(leaf) !== '' && quote.includes(normalize(leaf))
  return true
}

/** Matches the unit as the text directly after a number: optional whitespace, then a whole unit word. */
function unitAfterNumberPattern(unit: string): RegExp {
  const forms = UNIT_FORMS.get(unit) ?? [unit]
  return new RegExp(`^\\s*(?:${forms.map(escapeRegExp).join('|')})(?![a-z])`)
}

/** Verifies that a sourced value is literally supported by the page text it cites. */
export function literalCheck(field: Sourced<unknown>, sourceText: string): CheckResult {
  const quote = normalize(field.quote)
  if (quote === '' || !normalize(sourceText).includes(quote)) {
    return { name: 'literal', ok: false, detail: 'quote not found in source text' }
  }

  if (field.sourceType === 'derived') {
    const input = field.derivation ? normalize(field.derivation.input) : ''
    if (input === '' || !quote.includes(input)) {
      return { name: 'literal', ok: false, detail: `quote lacks derivation input "${field.derivation?.input ?? ''}"` }
    }
    return { name: 'literal', ok: true }
  }

  const numbers = quotedNumbers(quote)
  const valueLeaves = leaves(field.value)
  const missing = valueLeaves.filter((leaf) => !isQuoted(leaf, quote, numbers))
  if (missing.length > 0) {
    return { name: 'literal', ok: false, detail: `value not in quote: ${JSON.stringify(missing)}` }
  }

  if (field.unit !== undefined) {
    const unit = normalize(field.unit)
    if (unit === '') return { name: 'literal', ok: false, detail: 'unit is empty' }

    const numberLeaves = valueLeaves.filter((leaf): leaf is number => typeof leaf === 'number')
    if (numberLeaves.length === 0) {
      return { name: 'literal', ok: false, detail: `unit "${unit}" given but value has no number` }
    }

    const unitPattern = unitAfterNumberPattern(unit)
    const unitless = numberLeaves.filter(
      (leaf) => !numbers.some((n) => n.value === leaf && unitPattern.test(quote.slice(n.end))),
    )
    if (unitless.length > 0) {
      return { name: 'literal', ok: false, detail: `unit "${unit}" not found right after ${JSON.stringify(unitless)} in quote` }
    }
  }

  return { name: 'literal', ok: true }
}
