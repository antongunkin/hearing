import type { CheckResult } from '@/src/lib/schema/pending'

const AMOUNT = /\$\s?\d[\d,]*(?:\.\d+)?/g
const SALE_WORDS = /\b(?:sale|save|was|reg(?:ular)?|off|deal|discount|limited|holiday|black friday|promo)\b/i

/**
 * Fails when a price quote may not state the regular price: it holds two or more amounts (a sale price next
 * to a list price, a per-device next to a per-pair price) or a sale word. The change then waits for a person.
 */
export function priceBasisCheck(quote: string): CheckResult {
  const amounts = quote.match(AMOUNT) ?? []
  if (amounts.length >= 2) return { name: 'price-basis', ok: false, detail: `the quote holds ${amounts.length} amounts: ${amounts.join(', ')}` }
  const sale = SALE_WORDS.exec(quote)
  if (sale) return { name: 'price-basis', ok: false, detail: `the quote says "${sale[0]}": may be a sale price` }
  return { name: 'price-basis', ok: true }
}
