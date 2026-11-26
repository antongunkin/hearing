import type { CheckResult } from '@/src/lib/schema/pending'
import type { Sourced } from '@/src/lib/schema/field'

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function quotedNumbers(quote: string): number[] {
  return [...quote.matchAll(NUMBER)].map(([digits]) => Number(digits.replaceAll(',', '')))
}

/** Numbers and strings nested anywhere in the value, e.g. the bounds of an Rx price pair. */
function leaves(value: unknown): unknown[] {
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(leaves)
  return [value]
}

/** Booleans and null are interpretations rather than quotable text, so they are not checked. */
function isQuoted(leaf: unknown, quote: string, numbers: number[]): boolean {
  if (typeof leaf === 'number') return numbers.includes(leaf)
  if (typeof leaf === 'string') return normalize(leaf) !== '' && quote.includes(normalize(leaf))
  return true
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
  const missing = leaves(field.value).filter((leaf) => !isQuoted(leaf, quote, numbers))
  if (missing.length > 0) {
    return { name: 'literal', ok: false, detail: `value not in quote: ${JSON.stringify(missing)}` }
  }
  return { name: 'literal', ok: true }
}
