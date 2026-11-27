// Models of a gone brand (or an active brand's earlier line-up) found in Web Archive copies: catalog copies list the
// model pages, the latest copy of each page is read, and what is not on sale any more becomes a discontinued card.
// Every request goes to web.archive.org: a URL on the brand's own site is turned into a copy's URL or dropped.
import { config } from '@/pipeline/config'
import { archiveDateCheck } from '@/pipeline/checks/archive-date'
import { diffModel, sourcedLeaves } from '@/pipeline/apply'
import { checkDocument, type OnSkip } from '@/pipeline/archive/documents'
import { isInScope, lifecycleOf, listingIn, type Listing } from '@/pipeline/archive/lifecycle'
import type { OkPage } from '@/pipeline/atlas/facts'
import { fetchPage } from '@/pipeline/fetch/fetcher'
import { linksIn } from '@/pipeline/fetch/html'
import { LlmLimitError } from '@/pipeline/llm'
import { extractModel, linkDocuments, matchExistingModel, mergeCandidates, sameModelName, type ModelCandidate } from '@/pipeline/sources/brand-site'
import { earliestCopy, latestCopy, pdfCopies, pdfTarget, WaybackError, yearlyCopies } from '@/pipeline/sources/wayback'
import { archiveMonth, archiveUrl, citableArchiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import type { Brand } from '@/src/lib/schema/brand'
import type { Sourced } from '@/src/lib/schema/field'
import type { Model } from '@/src/lib/schema/model'
import type { CandidateChange, CheckResult } from '@/src/lib/schema/pending'

/** A Web Archive copy that was read: `timestamp` and `original` are those of the copy actually served. */
type Copy = { page: OkPage; timestamp: string; original: string }

export type ArchiveOpts = {
  /** At most this many model pages are read. */
  limit: number
  /** Asked again of the CDX index; archive copies themselves are never read again. */
  refresh: boolean
  /** Model pages that a live catalog lists: `update` handles those. */
  liveModelUrls: Set<string>
  /** Told of every fetch that was skipped; a 429 or a bot wall stops the run through a `WaybackError`. */
  onSkip?: OnSkip
  /** Given the catalog copies that were read (as the archive served them), for whoever needs them as scope evidence. */
  onCatalogs?: (copies: OkPage[]) => void
  /** Told of a model that failed (an unreadable page, a bad extraction); the others go on. */
  onFail?: (label: string, error: unknown) => void
}

/** The `onSkip` reason of a model page whose copy holds no usable text. */
export const NO_PAGE_TEXT = 'no-page-text'
/** A page with less text than this (characters) is empty for extraction. */
const MIN_PAGE_TEXT = 5

const originalOf = (url: string): string => parseArchiveUrl(url)?.original ?? url

/** A URL as a key: scheme, `www.`, fragment, trailing slash and case of the host ignored. */
function keyOf(url: string): string {
  const parsed = URL.parse(originalOf(url))
  if (parsed === null) return url
  return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`
}


/**
 * The stored model of the brand that the candidate is, by its page's original URL or by name; null when none
 * or when more than one qualifies (then a model is not merged into a guess). An exact name wins over a looser one.
 */
export function findStored(brand: Brand, models: Model[], candidate: Model, originals: string[]): Model | null {
  const own = models.filter((m) => m.brand === brand.slug)
  const exact = matchExistingModel(candidate, own)
  if (exact !== null) return exact
  const urls = new Set(originals.map(keyOf))
  const qualifying = own.filter(
    (stored) =>
      [stored.name, ...stored.aliases].some((name) => sameModelName(brand.slug, name, candidate.name)) ||
      sourcedLeaves(stored).some(([, field]) => urls.has(keyOf(field.sourceUrl))),
  )
  return qualifying.length === 1 ? qualifying[0] : null
}

export async function archiveCandidates(brand: Brand, models: Model[], opts: ArchiveOpts): Promise<CandidateChange[]> {
  const gone = brand.status === 'gone'
  // A brand without `archive.catalogUrls` (gone or active) is read through its live catalog URLs, which are the originals the archive knows.
  const catalogUrls = brand.archive?.catalogUrls ?? brand.scraper.catalogUrls
  if (catalogUrls.length === 0) return []
  const cdxOpts = opts.refresh ? { refresh: true } : {}

  const stopping = new Set(['rate-limited', 'bot-protection'])
  /** A refusal by the archive that stops the run is thrown; any other skip is reported and the source left out. */
  const onSkip: OnSkip = (url, reason, detail) => {
    if (stopping.has(reason)) throw new WaybackError(reason, detail)
    opts.onSkip?.(url, reason, detail)
  }
  /** `work`, with an `archive-excluded` answer (the archive does not serve the site) reported and turned into null. */
  const tolerant = async <T>(url: string, work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work()
    } catch (error) {
      if (!(error instanceof WaybackError) || error.reason !== 'archive-excluded') throw error
      onSkip(url, error.reason, error.detail)
      return null
    }
  }
  /** The copy of `original` taken at `timestamp`, read raw; what it says is dated by the copy the archive served. */
  const read = async (timestamp: string, original: string): Promise<Copy | null> => {
    const url = archiveUrl(timestamp, original, { raw: true })
    const result = await fetchPage(url)
    if (result.status === 'skipped') {
      onSkip(url, result.reason, result.detail)
      return null
    }
    const served = parseArchiveUrl(result.url) ?? parseArchiveUrl(url)!
    const citable = citableArchiveUrl(parseArchiveUrl(result.url) ? result.url : url)
    return { page: { ...result, url: citable }, timestamp: served.timestamp, original: served.original }
  }
  const failed = (label: string, error: unknown): void => {
    if (error instanceof WaybackError || error instanceof LlmLimitError) throw error
    if (opts.onFail) opts.onFail(label, error)
    else console.warn(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 1. The catalog copies: the latest of each year since 2018, of each catalog URL as the brand's own site knew it.
  const catalogs: Copy[] = []
  const modelUrls = new Map<string, string>()
  const modelPattern = brand.archive?.modelUrlPattern ?? brand.scraper.modelUrlPattern
  const isModel = new RegExp(modelPattern)
  const live = new Set([...opts.liveModelUrls].map(keyOf))
  let modelLinks = 0
  for (const catalogUrl of new Set(catalogUrls.map(originalOf))) {
    for (const row of (await tolerant(catalogUrl, () => yearlyCopies(catalogUrl, cdxOpts))) ?? []) {
      const copy = await read(row.timestamp, row.original)
      if (copy === null) continue
      catalogs.push(copy)
      // 2. The model pages the copy links, as the brand's own URLs.
      for (const link of copy.page.html === undefined ? [] : linksIn(copy.page.html, copy.original)) {
        const original = originalOf(link)
        if (!isModel.test(original)) continue
        modelLinks++
        if (!live.has(keyOf(original)) && !modelUrls.has(keyOf(original))) modelUrls.set(keyOf(original), original)
      }
    }
  }
  opts.onCatalogs?.(catalogs.map((copy) => copy.page))
  // Nothing found is more often a pattern that does not fit the old links (http, no www.) than an empty catalog.
  if (modelLinks === 0) console.log(`${brand.slug}: no model page link matches ${modelPattern} in ${catalogs.length} catalog copies, check catalogUrls and modelUrlPattern`)
  const listingsOf = (...named: Pick<Model, 'brand' | 'name' | 'aliases'>[]): Listing[] =>
    catalogs.flatMap((copy) => named.flatMap((model) => listingIn(model, copy.page) ?? []))

  // 3. Each model page: its latest copy.
  const candidates: ModelCandidate[] = []
  const pagesOf = new Map<string, OkPage[]>()
  const originalsOf = new Map<string, string[]>()
  for (const original of [...modelUrls.values()].slice(0, opts.limit)) {
    try {
      const row = await tolerant(original, () => latestCopy(original, cdxOpts))
      if (row === null) continue
      const copy = await read(row.timestamp, row.original)
      if (copy === null) continue
      // A script-built shop page (a JS shell) has no text in its copy: nothing to extract, and nothing to ask the model.
      if (copy.page.text.trim().length < MIN_PAGE_TEXT) {
        opts.onSkip?.(original, NO_PAGE_TEXT)
        continue
      }
      const candidate = await extractModel(brand, [copy.page])
      const slug = candidate.model.slug
      candidates.push(candidate)
      pagesOf.set(slug, [...(pagesOf.get(slug) ?? []), copy.page])
      originalsOf.set(slug, [...(originalsOf.get(slug) ?? []), original])
    } catch (error) {
      failed(original, error)
    }
  }

  // 7. Archived PDFs of the brand's site, given to the model page they name.
  const documentsOf = new Map<string, string[]>()
  const pattern = brand.scraper.documentUrlPattern
  if (pattern !== undefined && candidates.length > 0) {
    const target = pdfTarget(brand.website, pattern)
    const rows = await (async () => {
      try {
        return (await tolerant(brand.website, () => pdfCopies(target, cdxOpts))) ?? []
      } catch (error) {
        // A listing the archive timed out on twice is this brand's loss only; the run goes on.
        if (!(error instanceof WaybackError) || error.reason !== 'listing-timeout') throw error
        console.log(`Web Archive could not list ${target.url} (${error.detail}), documents from the archive skipped`)
        return []
      }
    })()
    const isDocument = new RegExp(pattern)
    const copies = new Map(rows.filter((r) => isDocument.test(r.original)).map((r) => [r.original, r]))
    const slugOf = new Map([...originalsOf].flatMap(([slug, urls]) => urls.map((url) => [url, slug] as const)))
    const { sources } = linkDocuments(brand, [...slugOf.keys()], [...copies.keys()], new Set())
    for (const { modelUrl, documentUrls } of sources) {
      const slug = slugOf.get(modelUrl)!
      const urls = documentUrls.map((url) => archiveUrl(copies.get(url)!.timestamp, url))
      documentsOf.set(slug, [...(documentsOf.get(slug) ?? []), ...urls])
    }
  }

  const changes: CandidateChange[] = []
  for (const candidate of mergeCandidates(candidates)) {
    const { slug } = candidate.model
    try {
      changes.push(...(await changesOf(candidate, pagesOf.get(slug) ?? [], originalsOf.get(slug) ?? [], documentsOf.get(slug) ?? [])))
    } catch (error) {
      failed(slug, error)
    }
  }
  return changes

  /** What the archive says about one model that was read. */
  async function changesOf(candidate: ModelCandidate, pages: OkPage[], originals: string[], documentUrls: string[]): Promise<CandidateChange[]> {
    const { slug } = candidate.model
    const existing = findStored(brand, models, candidate.model, originals)

    // A new model must have been on sale since 2018; asked before any PDF is fetched.
    if (existing === null && !isInScope(candidate.model, { archiveListings: listingsOf(candidate.model) })) {
      console.log(`${slug}: not listed or officially released since ${config.onSaleSince.slice(0, 4)}, left out`)
      return []
    }
    // Where the model was last listed, else a page that names it; a model nothing names is not proposed as discontinued.
    const lifecycle = lifecycleOf(candidate.model, { inLiveCatalog: false, listings: listingsOf(candidate.model, ...(existing === null ? [] : [existing])), namingPage: pages[0] })
    const discontinued = lifecycle?.kind === 'discontinued' ? { ...(lifecycle.lastListed !== undefined && { lastListed: lifecycle.lastListed }), source: lifecycle.source } : undefined
    if (existing === null && discontinued === undefined) {
      console.log(`${slug}: no archived page or catalog copy names it, not proposed`)
      return []
    }

    // Documents that pass the three checks, with their checks under `documents.<i>`.
    const stored = new Set((existing?.documents ?? []).map((d) => originalOf(d.url)))
    const fieldChecks: Record<string, CheckResult[]> = Object.fromEntries(Object.entries(candidate.fieldChecks).filter(([path]) => !path.startsWith('documents.')))
    const documents: Model['documents'] = []
    for (const url of documentUrls) {
      if (stored.has(originalOf(url))) continue
      const checked = await tolerant(url, () => checkDocument(brand, candidate.model, url, { onSkip, ...(existing !== null && { stored: existing }) }))
      if (checked === null) continue
      fieldChecks[`documents.${documents.length}`] = checked.checks
      documents.push(checked.document)
    }
    let model: Model = { ...candidate.model, documents }

    // 6. No official date: the month of the earliest copy of the model page that names the model.
    const wantsDate = (existing === null ? model.releaseDate : (existing.releaseDate ?? model.releaseDate)) === undefined
    if (wantsDate && (existing === null ? isInScope(model, { archiveListings: listingsOf(model) }) : true)) {
      const derived = await derivedRelease(model, originals)
      if (derived !== undefined) {
        model = { ...model, releaseDate: derived.field }
        fieldChecks.releaseDate = [derived.check]
      }
    }

    if (existing !== null) {
      const proposed = diffModel(existing, { model, fieldChecks }).filter(
        (change) => change.kind === 'document' || (change.path === 'releaseDate' && existing.releaseDate === undefined),
      )
      if (gone && existing.discontinued === undefined) {
        if (discontinued === undefined) console.log(`${existing.slug}: no archived page or catalog copy names it, discontinued not proposed`)
        else proposed.push({ kind: 'discontinued', modelSlug: existing.slug, path: 'discontinued', after: discontinued, checks: { discontinued: [] } })
      }
      return proposed
    }

    return diffModel(null, { model: { ...model, discontinued }, fieldChecks })
  }

  /** An "on sale by" month from the earliest archive copy of the model's page, when that copy names the model. */
  async function derivedRelease(model: Model, originals: string[]): Promise<{ field: Sourced<string>; check: CheckResult } | undefined> {
    for (const original of originals) {
      const row = await tolerant(original, () => earliestCopy(original, cdxOpts))
      if (row === null) continue
      const copy = await read(row.timestamp, row.original)
      if (copy === null) continue
      const listing = listingIn(model, copy.page)
      if (listing === null) continue
      const field: Sourced<string> = {
        value: archiveMonth(copy.timestamp),
        quote: listing.quote,
        sourceUrl: listing.sourceUrl,
        fetchedAt: listing.fetchedAt,
        sourceType: 'derived',
        derivation: { op: 'earliest-archive-copy', input: copy.timestamp },
      }
      return { field, check: archiveDateCheck(field, copy.page.text) }
    }
    return undefined
  }
}
