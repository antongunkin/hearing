import type { CheckResult } from '@/src/lib/schema/pending'
import type { Sourced } from '@/src/lib/schema/field'
import { canonicalUnit, escapeRegExp, findNumbers, unitFollows } from '@/pipeline/units'

const ISO_DATE = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/

const MONTH_ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
// Full names before abbreviations, so "march" is not read as "mar" followed by "ch".
const MONTH = String.raw`(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?`
const NAMED_MONTH_DAY_YEAR = new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`, 'g')
const DAY_NAMED_MONTH_YEAR = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH}\s*,?\s+(\d{4})\b`, 'g')
const NAMED_MONTH_YEAR = new RegExp(String.raw`\b${MONTH}\s*,?\s+(\d{4})\b`, 'g')
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g
const ISO_IN_TEXT = /\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/g

interface CalendarDate {
  year: number
  month: number
  day?: number
}

function monthNumber(name: string): number {
  return MONTH_ABBREVIATIONS.indexOf(name.slice(0, 3)) + 1
}

/** Dates written in the text, in natural forms and as ISO. Expects lowercase text. */
function datesIn(text: string): CalendarDate[] {
  return [
    ...[...text.matchAll(NAMED_MONTH_DAY_YEAR)].map((m) => ({ year: Number(m[3]), month: monthNumber(m[1]), day: Number(m[2]) })),
    ...[...text.matchAll(DAY_NAMED_MONTH_YEAR)].map((m) => ({ year: Number(m[3]), month: monthNumber(m[2]), day: Number(m[1]) })),
    ...[...text.matchAll(NAMED_MONTH_YEAR)].map((m) => ({ year: Number(m[2]), month: monthNumber(m[1]) })),
    ...[...text.matchAll(SLASH_DATE)].map((m) => ({ year: Number(m[3]), month: Number(m[1]), day: Number(m[2]) })),
    ...[...text.matchAll(ISO_IN_TEXT)].map((m) => ({
      year: Number(m[1]),
      month: Number(m[2]),
      day: m[3] === undefined ? undefined : Number(m[3]),
    })),
  ]
}

/** An ISO value is supported when the quote gives the same day (or month, if the value has no day). */
function isoDateQuoted(value: string, quote: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [, year, month, day] = match
  return datesIn(quote).some(
    (date) => date.year === Number(year) && date.month === Number(month) && (day === undefined || date.day === Number(day)),
  )
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Numbers and strings nested anywhere in the value, e.g. the bounds of an Rx price pair. */
function leaves(value: unknown): unknown[] {
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(leaves)
  return [value]
}

/** Booleans and null are interpretations rather than quotable text, so they are not checked. */
function isQuoted(leaf: unknown, quote: string, numbers: { value: number }[]): boolean {
  if (typeof leaf === 'number') return numbers.some((n) => n.value === leaf)
  if (typeof leaf === 'string') {
    const text = normalize(leaf)
    if (text === '') return false
    if (ISO_DATE.test(text)) return isoDateQuoted(text, quote)
    return quote.includes(text)
  }
  return true
}

/**
 * True when `part` stands in `text` as a whole: not glued to a letter or digit, and not the tail or head
 * of a longer number ("1 g" is not in "2.1 g", "250 mg" is not in "1,250 mg", "2.1 g" is not in "2.1 grams").
 * Both are expected normalized.
 */
function containsWhole(text: string, part: string): boolean {
  return new RegExp(String.raw`(?<![a-z0-9])(?<!\d[.,])${escapeRegExp(part)}(?![a-z0-9])(?![.,]\d)`).test(text)
}

/** Verifies that a sourced value is literally supported by the page text it cites. */
export function literalCheck(field: Sourced<unknown>, sourceText: string): CheckResult {
  const quote = normalize(field.quote)
  if (quote === '' || !normalize(sourceText).includes(quote)) {
    return { name: 'literal', ok: false, detail: 'quote not found in source text' }
  }

  if (field.sourceType === 'derived') {
    const input = field.derivation ? normalize(field.derivation.input) : ''
    if (input === '' || !containsWhole(quote, input)) {
      return {
        name: 'literal',
        ok: false,
        detail: `quote lacks derivation input "${field.derivation?.input ?? ''}" as a whole measurement`,
      }
    }
    // Halving is right only when the source says the figure is for a pair.
    if (field.derivation?.op === 'pair-to-unit' && !/\bpairs?\b/.test(quote)) {
      return { name: 'literal', ok: false, detail: 'pair-to-unit, but the quote does not say "pair"' }
    }
    return { name: 'literal', ok: true }
  }

  const numbers = findNumbers(quote)
  const valueLeaves = leaves(field.value)
  const missing = valueLeaves.filter((leaf) => !isQuoted(leaf, quote, numbers))
  if (missing.length > 0) {
    return { name: 'literal', ok: false, detail: `value not in quote: ${JSON.stringify(missing)}` }
  }

  if (field.unit !== undefined) {
    const unit = normalize(field.unit)
    if (unit === '') return { name: 'literal', ok: false, detail: 'unit is empty' }

    // Only measurement units are checked against the text; any other unit checks the number alone.
    const canonical = canonicalUnit(unit)
    if (canonical !== undefined) {
      const numberLeaves = valueLeaves.filter((leaf): leaf is number => typeof leaf === 'number')
      if (numberLeaves.length === 0) {
        return { name: 'literal', ok: false, detail: `unit "${unit}" given but value has no number` }
      }

      const unitless = numberLeaves.filter(
        (leaf) => !numbers.some((n) => n.value === leaf && unitFollows(quote, n.end, canonical)),
      )
      if (unitless.length > 0) {
        return { name: 'literal', ok: false, detail: `unit "${unit}" not found right after ${JSON.stringify(unitless)} in quote` }
      }
    }
  }

  return { name: 'literal', ok: true }
}
