// Which models are compared: each model's closest competitors. Client-safe: the compare tool names pairs too.
import { SLUG_PATTERN } from '@/src/lib/schema/slug-pattern'
import type { CatalogItem } from './catalog-index'

const SEPARATOR = '-vs-'

/** Slugs sort by code units everywhere here, so that a pair has one order. */
const bySlug = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Calendar months since year 0 of `YYYY-MM` or `YYYY-MM-DD`; undefined for any other text. */
function month(date: string | undefined): number | undefined {
  const match = /^(\d{4})-(\d{2})(?:-|$)/.exec(date ?? '')
  return match ? Number(match[1]) * 12 + Number(match[2]) : undefined
}

/** How close two models are. A value that either of them lacks scores nothing. */
function closeness(a: CatalogItem, b: CatalogItem): number {
  let score = 0
  if (a.type === b.type) score += 3
  if (a.formFactors.some((formFactor) => b.formFactors.includes(formFactor))) score += 2
  // Within 30% of the lower price; in whole numbers, so that exactly 30% counts.
  if (a.priceMin !== undefined && b.priceMin !== undefined) {
    if (Math.abs(a.priceMin - b.priceMin) * 10 <= Math.min(a.priceMin, b.priceMin) * 3) score += 1
  }
  const [released, other] = [month(a.releaseDate), month(b.releaseDate)]
  if (released !== undefined && other !== undefined && Math.abs(released - other) <= 12) score += 1
  return score
}

/** The slugs of the `k` models closest to `slug`, closest first; of equally close ones, by slug. */
export function competitorsOf(slug: string, items: CatalogItem[], k = 10): string[] {
  const model = items.find((item) => item.slug === slug)
  if (!model) return []
  return items
    .filter((item) => item.slug !== slug)
    .map((item) => ({ slug: item.slug, score: closeness(model, item) }))
    .sort((a, b) => b.score - a.score || bySlug(a.slug, b.slug))
    .slice(0, k)
    .map((competitor) => competitor.slug)
}

/** The two slugs of the comparison page of `a` and `b`, in either order. */
export function pairSlug(a: string, b: string): string {
  return [a, b].sort(bySlug).join(SEPARATOR)
}

/** The two models of a canonical pair slug: two different slugs in alphabetical order. Null otherwise. */
export function parsePairSlug(pair: string): [string, string] | null {
  const at = pair.indexOf(SEPARATOR)
  if (at === -1 || at !== pair.lastIndexOf(SEPARATOR)) return null
  const a = pair.slice(0, at)
  const b = pair.slice(at + SEPARATOR.length)
  return SLUG_PATTERN.test(a) && SLUG_PATTERN.test(b) && a < b ? [a, b] : null
}

/** The pairs that get a page: every model with each of its closest competitors, once each. */
export function selectCuratedPairs(items: CatalogItem[], k = 10): [string, string][] {
  const pairs = new Map<string, [string, string]>()
  for (const { slug } of items) {
    for (const other of competitorsOf(slug, items, k)) {
      pairs.set(pairSlug(slug, other), slug < other ? [slug, other] : [other, slug])
    }
  }
  return [...pairs.keys()].sort(bySlug).map((key) => pairs.get(key)!)
}
