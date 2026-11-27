// Models of a gone brand (or an active brand's earlier line-up) found in Web Archive copies: catalog copies list the
// model pages, the latest copy of each page is read, and what is not on sale any more becomes a discontinued card.
// Every request goes to web.archive.org: a URL on the brand's own site is turned into a copy's URL or dropped.
import { config } from '@/pipeline/config'
import { archiveDateCheck } from '@/pipeline/checks/archive-date'
import { diffModel, sourcedLeaves } from '@/pipeline/apply'
import { checkDocument, type OnSkip } from '@/pipeline/archive/documents'
import { isInScope, lifecycleOf, listingIn, namesModel, type Listing } from '@/pipeline/archive/lifecycle'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { linksIn } from '@/pipeline/fetch/html'
import { LlmLimitError } from '@/pipeline/llm'
import { extractModel, linkDocuments, matchExistingModel, mergeCandidates, type ModelCandidate } from '@/pipeline/sources/brand-site'
import { earliestCopy, latestCopy, pdfCopies, WaybackError, yearlyCopies } from '@/pipeline/sources/wayback'
import { archiveMonth, archiveUrl, citableArchiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import type { Brand } from '@/src/lib/schema/brand'
import type { Sourced } from '@/src/lib/schema/field'
import type { Model } from '@/src/lib/schema/model'
import type { CandidateChange, CheckResult } from '@/src/lib/schema/pending'

type OkPage = Extract<FetchResult, { status: 'ok' }>
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
  /** Told of a model that failed (an unreadable page, a bad extraction); the others go on. */
  onFail?: (label: string, error: unknown) => void
}

const originalOf = (url: string): string => parseArchiveUrl(url)?.original ?? url

/** A URL as a key: scheme, `www.`, fragment, trailing slash and case of the host ignored. */
function keyOf(url: string): string {
  const parsed = URL.parse(originalOf(url))
  if (parsed === null) return url
  return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`
}

const bareHost = (url: string): string => new URL(url).hostname.replace(/^www\./, '')

/** The family's name matches a stored model: a name, or an alias, written differently ("Audéo Paradise" and "Paradise"). */
function sameModelName(brand: Brand, stored: Model, candidate: Model): boolean {
  if (matchExistingModel(candidate, [stored]) !== null) return true
  return namesModel(stored, `${brand.name} ${candidate.name}`) || namesModel(candidate, `${brand.name} ${stored.name}`)
}

/**
 * The stored model of the brand that the candidate is, by its page's original URL or by name; null when none
 * or when more than one qualifies (then a model is not merged into a guess). An exact name wins over a looser one.
 */
function findStored(brand: Brand, models: Model[], candidate: Model, originals: string[]): Model | null {
  const own = models.filter((m) => m.brand === brand.slug)
  const exact = matchExistingModel(candidate, own)
  if (exact !== null) return exact
  const urls = new Set(originals.map(keyOf))
  const qualifying = own.filter(
    (stored) => sameModelName(brand, stored, candidate) || sourcedLeaves(stored).some(([, field]) => urls.has(keyOf(field.sourceUrl))),
  )
  return qualifying.length === 1 ? qualifying[0] : null
}

const firstLine = (page: OkPage): string | undefined =>
  page.text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '')
    ?.slice(0, 300)

export async function archiveCandidates(brand: Brand, models: Model[], opts: ArchiveOpts): Promise<CandidateChange[]> {
  const gone = brand.status === 'gone'
  const catalogUrls = brand.archive?.catalogUrls ?? (gone ? brand.scraper.catalogUrls : [])
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
  const isModel = new RegExp(brand.archive?.modelUrlPattern ?? brand.scraper.modelUrlPattern)
  const live = new Set([...opts.liveModelUrls].map(keyOf))
  for (const catalogUrl of new Set(catalogUrls.map(originalOf))) {
    for (const row of await yearlyCopies(catalogUrl, cdxOpts)) {
      const copy = await read(row.timestamp, row.original)
      if (copy === null) continue
      catalogs.push(copy)
      // 2. The model pages the copy links, as the brand's own URLs.
      for (const link of copy.page.html === undefined ? [] : linksIn(copy.page.html, copy.original)) {
        const original = originalOf(link)
        if (isModel.test(original) && !live.has(keyOf(original)) && !modelUrls.has(keyOf(original))) modelUrls.set(keyOf(original), original)
      }
    }
  }
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
    const rows = (await tolerant(brand.website, () => pdfCopies(bareHost(brand.website), cdxOpts))) ?? []
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

    // Documents that pass the three checks, with their checks under `documents.<i>`.
    const stored = new Set((existing?.documents ?? []).map((d) => originalOf(d.url)))
    const fieldChecks: Record<string, CheckResult[]> = Object.fromEntries(Object.entries(candidate.fieldChecks).filter(([path]) => !path.startsWith('documents.')))
    const documents: Model['documents'] = []
    for (const url of documentUrls) {
      if (stored.has(originalOf(url))) continue
      const checked = await tolerant(url, () => checkDocument(brand, candidate.model, url, { onSkip }))
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

    // Where the model was last listed, else the archived page itself names it: never "on sale".
    const listings = listingsOf(model, ...(existing === null ? [] : [existing]))
    const naming = pages[0]
    const lifecycle = lifecycleOf(model, { inLiveCatalog: false, listings, namingPage: naming })
    const discontinued = (): { value: NonNullable<Model['discontinued']>; checks: CheckResult[] } => {
      if (lifecycle?.kind === 'discontinued') {
        return { value: { ...(lifecycle.lastListed !== undefined && { lastListed: lifecycle.lastListed }), source: lifecycle.source }, checks: [] }
      }
      const quote = firstLine(naming)!
      const source: Sourced<string> = { value: model.name, quote, sourceUrl: naming.url, fetchedAt: naming.fetchedAt, sourceType: 'official' }
      return { value: { source }, checks: [{ name: 'lifecycle', ok: false, detail: 'the archived model page does not name the model' }] }
    }

    if (existing !== null) {
      const proposed = diffModel(existing, { model, fieldChecks }).filter(
        (change) => change.kind === 'document' || (change.path === 'releaseDate' && existing.releaseDate === undefined),
      )
      if (gone && existing.discontinued === undefined) {
        const { value, checks } = discontinued()
        proposed.push({ kind: 'discontinued', modelSlug: existing.slug, path: 'discontinued', after: value, checks: { discontinued: checks } })
      }
      return proposed
    }

    // 5. A new model must have been on sale since 2018.
    if (!isInScope(candidate.model, { archiveListings: listingsOf(candidate.model) })) {
      console.log(`${slug}: not listed or officially released since ${config.onSaleSince.slice(0, 4)}, left out`)
      return []
    }
    const { value, checks } = discontinued()
    return diffModel(null, {
      model: { ...model, discontinued: value },
      fieldChecks: { ...fieldChecks, ...(checks.length > 0 && { discontinued: checks }) },
    })
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
