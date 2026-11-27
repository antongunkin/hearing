// When a model was on sale: the rules that decide whether it belongs in the archive and what its lifecycle is.
// Pure functions over pages the caller has already fetched.
import { config } from '@/pipeline/config'
import type { FetchResult } from '@/pipeline/fetch/fetcher'
import { archiveMonth, citableArchiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import type { Sourced } from '@/src/lib/schema/field'
import type { Model } from '@/src/lib/schema/model'

type OkPage = Extract<FetchResult, { status: 'ok' }>
type Named = Pick<Model, 'brand' | 'name' | 'aliases'>

const QUOTE_LIMIT = 300

export type Listing = { month: string; sourceUrl: string; fetchedAt: string; quote: string }

/** Lowercase, accents removed, runs of space collapsed: "Audéo  Paradise" and "audeo paradise" compare equal. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function hasWhole(text: string, part: string): boolean {
  if (part === '') return false
  const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text)
}

/**
 * True when `line` names the model: its name or an alias stands in the line as whole words, and the brand
 * is somewhere in `context` (the line itself unless the caller gives the page). Brand words and sub-line words
 * may sit between the brand and the name ("Phonak Audéo Paradise" names "Paradise"). A name that already
 * starts with the brand needs no brand elsewhere; a short bare name such as "Paradise" does.
 */
export function namesModel(model: Named, line: string, context: string = line): boolean {
  const text = fold(line)
  const brand = fold(model.brand.replace(/-/g, ' '))
  return [model.name, ...model.aliases].some((name) => {
    const folded = fold(name)
    if (!hasWhole(text, folded)) return false
    return folded.startsWith(brand) || hasWhole(fold(context), brand)
  })
}

const monthOf = (page: OkPage): string => {
  const archived = parseArchiveUrl(page.url)
  return archived ? archiveMonth(archived.timestamp) : page.fetchedAt.slice(0, 7)
}

/** The first line of the page that names the model, quoted as the model's listing in that month. */
export function listingIn(model: Named, page: OkPage): Listing | null {
  const line = page.text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && namesModel(model, l, page.text))
  if (line === undefined) return null
  return { month: monthOf(page), sourceUrl: citableArchiveUrl(page.url), fetchedAt: page.fetchedAt, quote: line.slice(0, QUOTE_LIMIT) }
}

export type ScopeEvidence = { inLiveCatalog?: boolean; archiveListings?: Listing[] }

/** In scope: on sale now, listed in the archive since `config.onSaleSince`, or officially released since then. */
export function isInScope(model: Model, evidence: ScopeEvidence = {}): boolean {
  if (evidence.inLiveCatalog) return true
  const since = config.onSaleSince.slice(0, 7)
  if (evidence.archiveListings?.some((l) => l.month >= since)) return true
  const release = model.releaseDate
  if (release?.sourceType === 'official') return release.value >= config.onSaleSince.slice(0, release.value.length)
  return false
}

export type Lifecycle =
  | { kind: 'on-sale' }
  | { kind: 'discontinued'; lastListed?: string; source: Sourced<string> }
  | { kind: 'orphan'; source: Sourced<string> }

function sourceFrom(model: Named, page: OkPage, quote: string): Sourced<string> {
  return { value: model.name, quote, sourceUrl: citableArchiveUrl(page.url), fetchedAt: page.fetchedAt, sourceType: 'official' }
}

const firstLine = (page: OkPage): string =>
  (page.text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '').slice(0, QUOTE_LIMIT)

/** On sale if in the live catalog; an orphan if only a live product page exists; else discontinued by the latest listing or a naming page. */
export function lifecycleOf(
  model: Named,
  e: { inLiveCatalog: boolean; listings: Listing[]; liveProductPage?: OkPage; namingPage?: OkPage },
): Lifecycle | null {
  if (e.inLiveCatalog) return { kind: 'on-sale' }
  if (e.liveProductPage) {
    const quote = listingIn(model, e.liveProductPage)?.quote ?? firstLine(e.liveProductPage)
    return { kind: 'orphan', source: sourceFrom(model, e.liveProductPage, quote) }
  }
  if (e.listings.length > 0) {
    const latest = e.listings.reduce((a, b) => (b.month > a.month ? b : a))
    const source: Sourced<string> = { value: model.name, quote: latest.quote, sourceUrl: latest.sourceUrl, fetchedAt: latest.fetchedAt, sourceType: 'official' }
    return { kind: 'discontinued', lastListed: latest.month, source }
  }
  if (e.namingPage) {
    const quote = listingIn(model, e.namingPage)?.quote ?? firstLine(e.namingPage)
    return { kind: 'discontinued', source: sourceFrom(model, e.namingPage, quote) }
  }
  return null
}
