// `npm run update`: every source in turn, each change dropped, applied or queued for review. A run stopped by
// the Claude usage limit goes on with `--resume` (the message prints the command). `scrape`, `fda`, `apps`,
// `reviews` and `youtube` run one step.
// `update` ends by recording the comparison pairs; `pairs` does only that.
// `archive` is its own command: models sold since 2018 that the live catalog no longer lists, from support pages and
// the Web Archive. Every change it makes has `origin: 'archive'` and so never becomes a feed event.
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { applyAuto, diffModel, enqueue, pendingId, route, sourcedLeaves, withCrossChecks } from '@/pipeline/apply'
import { config } from '@/pipeline/config'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { LlmLimitError, LlmUnavailableError } from '@/pipeline/llm'
import { readCache } from '@/pipeline/llm/cache'
import { Progress } from '@/pipeline/progress'
import { priorCatalogCopies } from '@/pipeline/archive/catalog-history'
import { checkDocument, replaceDeadDocuments, type OnSkip } from '@/pipeline/archive/documents'
import { AppLookupSkipped, appStatus, draftHistory, ownHosts, readHistorySources } from '@/pipeline/archive/history'
import { isInScope, lifecycleOf, listingIn } from '@/pipeline/archive/lifecycle'
import { queueRelation } from '@/pipeline/atlas/relation'
import { archiveCandidates } from '@/pipeline/archive/wayback-models'
import { WaybackError } from '@/pipeline/sources/wayback'
import { discoverModelUrls, extractModel, matchExistingModel, mergeCandidates, type ModelCandidate } from '@/pipeline/sources/brand-site'
import { fetchIosVersion, lookupApp, type AppRecord } from '@/pipeline/sources/itunes'
import { fetchClearances, fetchFdaEvents, matchModel, type Clearance510k } from '@/pipeline/sources/openfda'
import { findInLog, readBody, readLog, type FetchLogEntry, type LogRef } from '@/pipeline/fetch/raw-store'
import { extractExpertProsCons, synthesizeProsCons } from '@/pipeline/sources/pros-cons'
import { OnceLedger } from '@/pipeline/once'
import { complaintThemes, currentMonth, discoverReviewSources, extractRetailReviews } from '@/pipeline/sources/reviews'
import { discoverThirdPartyFacts } from '@/pipeline/sources/third-party-facts'
import { analyzeVideo, searchVideos, YouTubeError } from '@/pipeline/sources/youtube'
import { parseArchiveUrl } from '@/src/lib/archive-url'
import { loadDataset, type Dataset } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'
import { ComparePairs } from '@/src/lib/schema/compare-pairs'
import type { Brand } from '@/src/lib/schema/brand'
import type { Sourced } from '@/src/lib/schema/field'
import type { Model } from '@/src/lib/schema/model'
import type { CandidateChange, CheckResult } from '@/src/lib/schema/pending'
import type { Reviews } from '@/src/lib/schema/reviews'
import { buildCatalogIndex } from '@/src/lib/site/catalog-index'
import { pairSlug, selectCuratedPairs } from '@/src/lib/site/pairs'

type Page = Extract<FetchResult, { status: 'ok' }>

const PROVIDER_NAMES = { claude: 'Claude', gemini: 'Gemini', ollama: 'Ollama' } as const

const STEPS = ['scrape', 'fda', 'apps', 'reviews', 'youtube'] as const
type Step = (typeof STEPS)[number]

type Run = {
  dataset: Dataset
  dataDir: string
  prosConsDir: string
  brands: Brand[]
  limit: number
  refresh: boolean
  asOf: string
  /** When the run began: catalog copies fetched since are this run's, not history. */
  startedAt: string
  /** The filters of the run (`--brand`, `--limit`): work done under other filters is not this run's. */
  scope: string
  progress: Progress
  /** `archive`: stamped on every change the run makes. */
  origin?: 'archive'
  /** `archive`: brands whose own site refused, in this run or an earlier one that this run resumes. */
  refused: string[]
  /** Lookups of discontinued models done once (`reviews`, `youtube`, hardware twins): see `pipeline/once.ts`. */
  once: OnceLedger
  /** Pending ids written by this run: a second proposal under one id replaces the first, which is reported. */
  queued: Set<string>
  tally: { auto: number; pending: number; dropped: number; skipped: number; failed: number }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Runs `work`; any failure but the usage limit (and those `passes` lets through) is counted and logged, and the run goes on. */
async function guard(run: Run, label: string, work: () => Promise<void>, passes = (_: unknown) => false): Promise<boolean> {
  try {
    await work()
    return true
  } catch (error) {
    if (error instanceof LlmLimitError || passes(error)) throw error
    run.tally.failed++
    console.warn(`${label} failed: ${message(error)}`)
    return false
  }
}

/** A unit of work done once per run: skipped on resume when the stopped run, with the same filters, finished it. */
async function unit(run: Run, key: string, work: () => Promise<void>, passes?: (error: unknown) => boolean): Promise<void> {
  const scoped = `${run.scope} ${key}`
  if (run.progress.has(scoped)) return
  if (await guard(run, key, work, passes)) await run.progress.done(scoped)
}

/**
 * One model's lookup. A discontinued model's is done once: marked in the ledger when it succeeds, and run again
 * only with `--refresh`. A model on sale is looked up on every run.
 */
async function modelUnit(
  run: Run,
  step: 'reviews' | 'youtube' | 'third-party',
  slug: string,
  work: () => Promise<void>,
  passes?: (error: unknown) => boolean,
): Promise<void> {
  const key = `${step}:${slug}`
  const discontinued = storedModel(run, slug).discontinued !== undefined
  if (discontinued && !run.refresh && run.once.has(key)) return
  await unit(
    run,
    key,
    async () => {
      await work()
      if (discontinued) await run.once.mark(key)
    },
    passes,
  )
}

/** Counts and logs a source that gave nothing. */
function skippedSource(run: Run, url: string, reason: string, detail?: string): void {
  run.tally.skipped++
  console.warn(`${url} skipped: ${reason}${detail ? ` (${detail})` : ''}`)
}

/** Drops, applies or queues one change. Risky fields are read again only for a change that is kept. */
async function handle(run: Run, made: CandidateChange): Promise<void> {
  const change: CandidateChange = run.origin === undefined ? made : { ...made, origin: run.origin }
  if (route(change, run.dataset.rejections) === 'drop') {
    run.tally.dropped++
    return
  }
  const checked = await withCrossChecks(change)
  if (route(checked, run.dataset.rejections) === 'auto') {
    await applyAuto(checked, run.dataset, run.dataDir)
    run.tally.auto++
  } else {
    // An archive proposal never replaces a card another command queued (an `update` card of a model on sale).
    const queuedBy = run.origin === undefined ? null : await queuedOrigin(run, pendingId(checked))
    if (queuedBy !== null && queuedBy !== run.origin) {
      skippedSource(run, checked.modelSlug ?? '', 'pending-clash', `${pendingId(checked)} is already queued by another command, left as it is`)
      return
    }
    const id = await enqueue(checked, run.dataDir)
    if (run.queued.has(id)) console.warn(`${id}: replaces a proposal made earlier in this run`)
    run.queued.add(id)
    run.tally.pending++
  }
}

/** The origin of the pending card with this id (`''` when it has none); null when there is no card. */
async function queuedOrigin(run: Run, id: string): Promise<string | null> {
  try {
    return (JSON.parse(await readFile(join(run.dataDir, 'pending', `${id}.json`), 'utf8')) as { origin?: string }).origin ?? ''
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** The page, or null (counted and logged) when the source is skipped. */
async function page(run: Run, url: string, opts: { render?: boolean; refresh?: boolean }): Promise<Page | null> {
  const result = await fetchPage(url, opts)
  if (result.status === 'ok') return result
  skippedSource(run, url, result.reason, result.detail)
  return null
}

/** Stored models of the selected brands, at most `limit` per brand. Read again each time: applying a change replaces the object. */
function modelSlugs(run: Run): string[] {
  return run.brands.flatMap((brand) =>
    run.dataset.models
      .filter((model) => model.brand === brand.slug)
      .slice(0, run.limit)
      .map((model) => model.slug),
  )
}
const storedModel = (run: Run, slug: string) => run.dataset.models.find((model) => model.slug === slug)!
const storedReviews = (run: Run, slug: string): Reviews | undefined => run.dataset.reviews.find((r) => r.slug === slug)

/** A change to one field of the model's reviews file, against what is stored there. */
function reviewsChange(run: Run, slug: string, kind: CandidateChange['kind'], field: keyof Reviews, after: unknown): CandidateChange {
  const before = storedReviews(run, slug)?.[field] ?? undefined
  return { kind, modelSlug: slug, path: `reviews.${field}`, ...(before !== undefined && { before }), after, checks: {} }
}

/** Every `sourceUrl` a stored model cites, with a Web Archive copy counted as the page it copies. */
function citedUrls(model: Model): Set<string> {
  const urls = new Set<string>()
  for (const [, field] of sourcedLeaves(model)) urls.add(parseArchiveUrl(field.sourceUrl)?.original ?? field.sourceUrl)
  return urls
}

/** The stored model's own official page: the page it cites most often that is a model page of the brand. */
function ownPageOf(model: Model, brand: Brand): string | undefined {
  const isModel = new RegExp(brand.scraper.modelUrlPattern)
  const counts = new Map<string, number>()
  for (const [, field] of sourcedLeaves(model)) {
    if (isModel.test(field.sourceUrl)) counts.set(field.sourceUrl, (counts.get(field.sourceUrl) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/**
 * Discontinuations and returns of one brand, judged against its complete live catalog. A stored model that no
 * catalog page lists is proposed as discontinued (always reviewed), or as an orphan when its own product page
 * is still live; a discontinued one that is listed again is proposed back on sale. `listedUrls` are the model
 * pages the catalog links: a model that cites one of them, or a catalog page itself, is still listed.
 */
async function lifecycleChanges(run: Run, brand: Brand, matched: Set<string>, listedUrls: string[], catalogPage: CatalogPage | undefined): Promise<void> {
  const stored = run.dataset.models.filter((model) => model.brand === brand.slug)
  const modelPages = new Set(listedUrls.map(plain))
  const listed = new Set([...modelPages, ...brand.scraper.catalogUrls.map(plain)])
  const copies = await priorCatalogCopies(brand.scraper.catalogUrls, run.startedAt)
  for (const model of stored) {
    if (matched.has(model.slug)) {
      if (model.discontinued) await handle(run, { kind: 'discontinued', modelSlug: model.slug, path: 'discontinued', before: model.discontinued, after: null, checks: {} })
      continue
    }
    if (model.discontinued || [...citedUrls(model)].some((url) => listed.has(plain(url)))) continue

    const listings = copies.flatMap((copy) => listingIn(model, copy) ?? [])
    const own = ownPageOf(model, brand)
    let liveProductPage: Page | undefined
    if (own !== undefined) {
      const read = await readOwnPage(run, own, brand.scraper.render)
      if (read.status === 'unread') {
        console.log(`${model.slug}: own page not read, lifecycle not checked`)
        continue
      }
      if (read.status === 'ok') {
        // An address the catalog links, reached by redirect, is a listed model under another URL.
        if (modelPages.has(plain(read.page.url))) continue
        // Another address of the same site (slash, locale) still shows the page is live; another site shows nothing.
        if (sameSite(read.page.url, own)) liveProductPage = read.page
      }
    }
    // A logged earlier copy of the model's own page, when no catalog copy names it.
    const namingPage = own === undefined ? undefined : (await priorCatalogCopies([own], run.startedAt))[0]
    const lifecycle = lifecycleOf(model, { inLiveCatalog: false, listings, liveProductPage, namingPage })
    if (lifecycle?.kind === 'on-sale') continue
    const checks: CandidateChange['checks'] = lifecycle?.kind === 'orphan' ? { discontinued: [{ name: 'lifecycle' as const, ok: false, detail: 'orphan-product-page' }] } : {}
    const source = lifecycle?.source ?? (catalogPage && absentFrom(model, catalogPage))
    if (source === undefined) {
      console.log(`${model.slug}: not in the catalog, no source to cite, lifecycle not decided`)
      continue
    }
    const lastListed = lifecycle?.kind === 'discontinued' ? lifecycle.lastListed : undefined
    await handle(run, { kind: 'discontinued', modelSlug: model.slug, path: 'discontinued', after: { ...(lastListed !== undefined && { lastListed }), source }, checks })
  }
}

const bareHost = (url: string) => new URL(url).host.replace(/^www\./, '')
/** Same site, `www.` ignored. */
const sameSite = (a: string, b: string) => bareHost(a) === bareHost(b)

/**
 * A model's own page, fetched fresh (a cached copy has no expiry and says nothing about now). Only a plain
 * "not found" (404, 410) is `gone`; a refusal, a timeout or a server error is `unread` (counted and logged):
 * it says nothing about the page, so the lifecycle is not decided on it.
 */
async function readOwnPage(run: Run, url: string, render: boolean): Promise<{ status: 'ok'; page: Page } | { status: 'gone' } | { status: 'unread' }> {
  const result = await fetchPage(url, { render, refresh: true })
  if (result.status === 'ok') return { status: 'ok', page: result }
  if (result.reason === 'http-error' && /^HTTP (404|410)$/.test(result.detail ?? '')) return { status: 'gone' }
  skippedSource(run, url, result.reason, result.detail)
  return { status: 'unread' }
}

/** A URL without its fragment and closing slash, so that `/x` and `/x/` are one page. */
function plain(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  return parsed.href.replace(/\/$/, '')
}

/** `lookupApp` answers of one run, by App Store id: models of a brand share their app. */
type AppLookups = Map<string, AppRecord | 'removed' | null>

/**
 * Predecessor, successor and app of a stored model, from what its official pages say. Only stored models
 * are linked (a name that matches none is logged and dropped); the quote was checked when the page was read.
 * An app needs exactly one App Store id, different from the stored one, named by the App Store. Returns
 * false when an iTunes lookup was skipped: that says nothing about the app, so the caller stops the unit.
 */
async function linkChanges(run: Run, existing: Model, candidate: ModelCandidate, lookups: AppLookups): Promise<boolean> {
  for (const path of ['predecessor', 'successor'] as const) {
    const claim = candidate.lineage?.[path]
    if (claim === undefined) continue
    const other = matchExistingModel({ ...candidate.model, name: claim.name }, run.dataset.models)
    if (other === null) {
      console.log(`${existing.slug}: ${path} "${claim.name}" is no stored model, left out`)
      continue
    }
    if (other.slug === existing.slug || existing[path]?.slug === other.slug) continue
    const reverse = path === 'predecessor' ? 'successor' : 'predecessor'
    if (other[reverse] !== undefined && other[reverse].slug !== existing.slug) {
      console.log(`${existing.slug}: ${other.slug} already has ${other[reverse].slug} as its ${reverse}, ${path} left out`)
      continue
    }
    const before = existing[path]
    await handle(run, {
      kind: 'spec-change',
      modelSlug: existing.slug,
      path,
      ...(before !== undefined && { before }),
      after: { slug: other.slug, source: claim.source },
      checks: { [path]: [{ name: 'literal', ok: true }] },
    })
  }

  const { ios = [], android = [] } = candidate.appIds ?? {}
  if (ios.length !== 1 || android.length > 1) {
    if (ios.length > 1) console.log(`${existing.slug}: ${ios.length} App Store ids on its pages, app not proposed`)
    return true
  }
  const [iosId] = ios
  if (iosId === existing.app?.iosId) return true
  if (!lookups.has(iosId)) lookups.set(iosId, await lookupApp(iosId))
  const app = lookups.get(iosId)
  if (app === null) return false
  if (app === undefined || app === 'removed') return true
  const androidUrl = android.length === 1 ? `https://play.google.com/store/apps/details?id=${android[0]}` : undefined
  await handle(run, {
    kind: 'spec-change',
    modelSlug: existing.slug,
    path: 'app',
    ...(existing.app !== undefined && { before: existing.app }),
    after: { name: app.name, iosId, ...(androidUrl !== undefined && { androidUrl }) },
    checks: { app: [] },
  })
  return true
}

/**
 * Puts the documents of the model's pages that pass `checkDocument` into the candidate, with their checks
 * under `documents.<i>`. A document the stored model already has is not read again; one that cannot be
 * fetched as a PDF is left out.
 */
async function addDocuments(run: Run, brand: Brand, existing: Model | null, candidate: ModelCandidate, urls: string[], onSkip?: OnSkip): Promise<void> {
  const original = (url: string) => parseArchiveUrl(url)?.original ?? url
  const stored = new Set((existing?.documents ?? []).map((d) => original(d.url)))
  const documents: Model['documents'] = []
  for (const url of urls) {
    if (stored.has(original(url))) continue
    await guard(
      run,
      `${candidate.model.slug} ${url}`,
      async () => {
        const checked = await checkDocument(brand, candidate.model, url, { refresh: run.refresh, onSkip })
        if (checked === null) return
        candidate.fieldChecks[`documents.${documents.length}`] = checked.checks
        documents.push(checked.document)
      },
      (error) => isBrandRefusal(error) || isArchiveStop(error),
    )
  }
  // Only the checked documents stay: whatever extractModel produced for `documents` is replaced.
  candidate.model = { ...candidate.model, documents }
}

type CatalogPage = { url: string; quote: string; fetchedAt: string }

/**
 * The only source left for a model that the whole catalog no longer lists and no logged page names: the
 * catalog page itself. The quote is a line of that page (it says nothing about the model); the derivation
 * says what was found, and the review card shows that instead of the quote.
 */
function absentFrom(model: Model, page: CatalogPage): Sourced<string> {
  return {
    value: model.name,
    quote: page.quote,
    sourceUrl: page.url,
    fetchedAt: page.fetchedAt,
    sourceType: 'derived',
    derivation: { op: 'absent-from-catalog', input: `${page.url} on ${page.fetchedAt.slice(0, 10)}` },
  }
}

/**
 * Brand sites (new models and spec changes), then third-party prices and hardware twins. A brand is one
 * unit: the pages of a model family are merged (see mergeCandidates) before they are compared with the
 * data, so each model is compared once. A brand stopped half-way is read again on resume; the LLM answers
 * for pages read before come from its cache (the pages too, without `--refresh`). A page that fails is
 * counted and left out.
 */
async function scrape(run: Run): Promise<void> {
  for (const brand of run.brands) {
    if (brand.status === 'gone') {
      console.log(`${brand.slug}: gone, not scraped live`)
      continue
    }
    await unit(run, `scrape:${brand.slug}`, async () => {
      // Lifecycle is judged only when the whole catalog was read: no `--limit`, no catalog or model page lost.
      let complete = !Number.isFinite(run.limit)
      const onSkip = (url: string, reason: string, detail?: string) => {
        if (brand.scraper.catalogUrls.includes(url)) complete = false
        skippedSource(run, url, reason, detail)
      }
      const onEmpty = () => {
        complete = false
      }
      let catalogPage: CatalogPage | undefined
      const onCatalog = (url: string, read: { quote: string; fetchedAt: string }) => {
        catalogPage ??= { url, ...read }
      }
      const found = await discoverModelUrls(brand, { refresh: run.refresh, onSkip, onEmpty, onCatalog })
      const groups = found.slice(0, run.limit)
      const candidates: ModelCandidate[] = []
      /** Whether a catalog page links a model, by slug (the pages of one family are one model). */
      const inCatalog = new Map<string, boolean>()
      /** The document URLs the pages of a model (a family is one model) link, by slug. */
      const documentsOf = new Map<string, Set<string>>()
      for (const { modelUrl, documentUrls, inCatalog: linked } of groups) {
        const read = await guard(run, modelUrl, async () => {
          const modelPage = await page(run, modelUrl, { render: brand.scraper.render, refresh: run.refresh })
          if (modelPage === null) {
            complete = false
            return
          }
          const pages = [modelPage]
          for (const url of documentUrls) {
            const document = await page(run, url, { refresh: run.refresh })
            if (document) pages.push(document)
          }
          const candidate = await extractModel(brand, pages)
          candidates.push(candidate)
          inCatalog.set(candidate.model.slug, inCatalog.get(candidate.model.slug) === true || linked)
          documentsOf.set(candidate.model.slug, new Set([...(documentsOf.get(candidate.model.slug) ?? []), ...documentUrls]))
        })
        if (!read) complete = false
      }

      const matched = new Set<string>()
      const lookups: AppLookups = new Map()
      let lookupSkipped = false
      for (const candidate of mergeCandidates(candidates)) {
        const existing = matchExistingModel(candidate.model, run.dataset.models)
        const inLiveCatalog = inCatalog.get(candidate.model.slug) === true
        if (existing !== null) {
          if (inLiveCatalog) matched.add(existing.slug)
        } else if (!isInScope(candidate.model, { inLiveCatalog })) {
          console.log(`${candidate.model.slug}: not sold since ${config.onSaleSince.slice(0, 4)} by its sources, left out`)
          continue
        } else if (!inLiveCatalog) {
          // Found on support pages only: the `archive` command decides whether it belongs.
          console.log(`${candidate.model.slug}: found only on support pages, left to the archive command`)
          continue
        }
        await addDocuments(run, brand, existing, candidate, [...(documentsOf.get(candidate.model.slug) ?? [])])
        for (const change of diffModel(existing, candidate)) await handle(run, change)
        if (existing !== null && !(await linkChanges(run, existing, candidate, lookups))) lookupSkipped = true
      }

      if (complete && groups.some((group) => group.inCatalog)) {
        await lifecycleChanges(run, brand, matched, groups.filter((group) => group.inCatalog).map((group) => group.modelUrl), catalogPage)
      } else {
        console.log(`${brand.slug}: catalog incomplete, lifecycle not checked`)
      }
      // A skipped lookup is not "no app": the brand is not done, and a resumed run asks again.
      if (lookupSkipped) throw new Error(`${brand.slug}: an iTunes lookup was skipped, app links not decided`)
    })
  }
  for (const slug of modelSlugs(run)) {
    await modelUnit(run, 'third-party', slug, async () => {
      const model = storedModel(run, slug)
      // A discontinued model has no current price: only its hardware twins are looked up.
      const changes = await discoverThirdPartyFacts(model, {
        asOf: run.asOf,
        refresh: run.refresh,
        ...(model.discontinued !== undefined && { prices: false }),
      })
      for (const change of changes) await handle(run, change)
    })
  }
}

/** FDA clearances and recalls of stored models, since the catalog's cut-off date; a repeated event is not written again. */
async function fda(run: Run): Promise<void> {
  await unit(run, 'fda', async () => {
    const models = run.dataset.models.filter((model) => run.brands.some((brand) => brand.slug === model.brand))
    // Every brand of the dataset names the sibling exclusion, even under `--brand`; only the models are the run's.
    const found = await fetchFdaEvents(config.eventsSince, run.dataset.brands, models)
    const unmatched = found.filter((event) => !event.matched).length
    if (unmatched > 0) console.log(`fda: ${unmatched} events name no stored model, left out`)
    for (const { event, matched } of found) {
      if (matched) await handle(run, { kind: 'fda-event', modelSlug: event.modelSlug, path: 'events', after: event, checks: {} })
    }
    await fdaStatuses(run, models)
  })
}

/**
 * The FDA status of each stored model, from its latest 510(k) or De Novo record since the catalog's start. The
 * records only fill the `fda` field: they make no feed event. Matching is fuzzy, so every change is reviewed.
 */
async function fdaStatuses(run: Run, models: Model[]): Promise<void> {
  const latest = new Map<string, Clearance510k>()
  for (const clearance of await fetchClearances(config.onSaleSince)) {
    const model = matchModel(clearance.applicant, clearance.deviceName, run.dataset.brands, models)
    if (model === undefined) continue
    const kept = latest.get(model.slug)
    if (kept === undefined || clearance.decisionDate > kept.decisionDate) latest.set(model.slug, clearance)
  }
  if (latest.size === 0) return
  const log = await readLog()
  for (const [slug, clearance] of latest) {
    const status = clearance.kNumber.startsWith('DEN') ? 'De Novo granted' : '510(k) cleared'
    const before = storedModel(run, slug).fda
    if (before?.value.status === status && before.value.k510 === clearance.kNumber) continue
    const after: Sourced<unknown> = {
      value: { status, k510: clearance.kNumber },
      sourceUrl: clearance.cdrhUrl,
      quote: clearance.deviceName,
      fetchedAt: clearance.ref.fetchedAt,
      sourceType: 'official',
    }
    await handle(run, {
      kind: 'spec-change',
      modelSlug: slug,
      path: 'fda',
      ...(before !== undefined && { before }),
      after,
      // Only the quote is checked against the record: the status and K-number are read from that same record.
      checks: { fda: [await recordCheck(clearance.ref, clearance.kNumber, clearance.deviceName, log)] },
    })
  }
}

/**
 * Whether the logged openFDA page holds one record with this K-number and this device name. The page is read
 * as parsed JSON, so escapes in the text do not matter, and the K-number and name must be in the same record.
 */
async function recordCheck(ref: LogRef, kNumber: string, deviceName: string, log: FetchLogEntry[]): Promise<CheckResult> {
  const hash = findInLog(log, ref)?.bodyHash
  if (hash === undefined) return { name: 'literal', ok: false, detail: 'record page not in the fetch log' }
  let page: { results?: { k_number?: unknown; device_name?: unknown }[] }
  try {
    page = JSON.parse(new TextDecoder().decode(await readBody(hash)))
  } catch {
    return { name: 'literal', ok: false, detail: 'logged record page is not JSON' }
  }
  const held = (page.results ?? []).some((record) => record.k_number === kNumber && record.device_name === deviceName)
  return held ? { name: 'literal', ok: true } : { name: 'literal', ok: false, detail: 'K-number and device name not in one logged record' }
}

/** A discontinued model whose brand's note says its app is no longer on the App Store: no version lookup. */
const appRemoved = (run: Run, model: Model) =>
  model.discontinued !== undefined && run.dataset.brands.find((brand) => brand.slug === model.brand)?.history?.app?.available === false

/** iOS app versions from the App Store; models that share an app are looked up once. */
async function apps(run: Run): Promise<void> {
  const versions = new Map<string, Awaited<ReturnType<typeof fetchIosVersion>>>()
  for (const slug of modelSlugs(run)) {
    const model = storedModel(run, slug)
    const iosId = model.app?.iosId
    if (iosId === undefined || appRemoved(run, model)) continue
    await unit(run, `apps:${slug}`, async () => {
      if (!versions.has(iosId)) {
        const version = await fetchIosVersion(iosId)
        if (version === null) run.tally.skipped++
        versions.set(iosId, version)
      }
      const after = versions.get(iosId)
      if (!after) return
      const before = storedModel(run, slug).app?.iosVersion
      const path = 'app.iosVersion'
      await handle(run, { kind: 'app-version', modelSlug: slug, path, ...(before && { before }), after, checks: {} })
    })
  }
}

type ProsConsInput = { sourceUrl: string; pros: string[]; cons: string[] }
const Input = z.object({ sourceUrl: z.string(), pros: z.array(z.string()), cons: z.array(z.string()) })
const Inputs = z.object({ expert: z.array(Input).default([]), video: z.array(Input).default([]) })

/**
 * Saves this step's pros and cons (from expert reviews or videos) under `.cache/` and proposes the
 * synthesis of both kinds, so that either step can run alone.
 */
async function proposeProsCons(run: Run, slug: string, kind: 'expert' | 'video', inputs: ProsConsInput[]): Promise<void> {
  const file = join(run.prosConsDir, `${slug}.json`)
  const saved = Inputs.safeParse((await readCache(file)) ?? {})
  const all = { ...(saved.success ? saved.data : { expert: [], video: [] }), [kind]: inputs }
  await writeJson(file, all)
  const prosCons = await synthesizeProsCons([...all.expert, ...all.video])
  if (prosCons !== null) await handle(run, reviewsChange(run, slug, 'pros-cons', 'prosCons', prosCons))
}

/** Customer ratings and complaint themes from shop pages (applied when checked), and pros and cons from expert reviews (reviewed). */
async function reviews(run: Run): Promise<void> {
  for (const slug of modelSlugs(run)) {
    await modelUnit(run, 'reviews', slug, async () => {
      const model = storedModel(run, slug)
      const { expert, retail } = await discoverReviewSources(model, { asOf: run.asOf })

      const customer: Reviews['customer'] = []
      const texts: string[] = []
      for (const url of retail) {
        // Always fetched again: ratings and counts change.
        const shop = await page(run, url, { refresh: true })
        if (shop === null) continue
        await guard(run, `${slug} ${url}`, async () => {
          const found = await extractRetailReviews(model, shop)
          if (found === null) return
          customer.push({ sourceUrl: shop.url, rating: found.rating, count: found.count, fetchedAt: shop.fetchedAt })
          texts.push(...found.texts)
        })
      }
      if (customer.length > 0) {
        // A shop not read this time keeps its last figures.
        const kept = (storedReviews(run, slug)?.customer ?? []).filter(
          (entry) => !customer.some((fresh) => fresh.sourceUrl === entry.sourceUrl),
        )
        await handle(run, reviewsChange(run, slug, 'review-stats', 'customer', [...kept, ...customer]))
      }
      // Shares of a handful of reviews say little, and they are published without review: none then, and
      // the stored themes stay.
      if (texts.length >= config.minThemeReviews) {
        await guard(run, `${slug} complaint themes`, async () => {
          await handle(run, reviewsChange(run, slug, 'complaint-themes', 'complaintThemes', await complaintThemes(texts)))
        })
      }

      const inputs: ProsConsInput[] = []
      for (const url of expert) {
        const review = await page(run, url, { refresh: run.refresh })
        if (review === null) continue
        await guard(run, `${slug} ${url}`, async () => {
          const points = await extractExpertProsCons(review, model)
          if (points) inputs.push(points)
        })
      }
      await proposeProsCons(run, slug, 'expert', inputs)
    })
  }
}

/**
 * Video reviews: found through the YouTube Data API, heard by Gemini. Without either, or at Gemini's daily
 * limit, the rest of the step is skipped and the run goes on; the next run tries again, with the videos
 * already heard answered from the LLM cache.
 */
async function youtube(run: Run): Promise<void> {
  const stopsStep = (error: unknown) =>
    error instanceof YouTubeError ||
    error instanceof LlmUnavailableError ||
    (error instanceof LlmLimitError && error.provider === 'gemini')
  try {
    for (const slug of modelSlugs(run)) {
      await modelUnit(
        run,
        'youtube',
        slug,
        async () => {
          const model = storedModel(run, slug)
          const videos: Reviews['videos'] = []
          const inputs: ProsConsInput[] = []
          for (const video of await searchVideos(model)) {
            const points = await analyzeVideo(video.id, model)
            // Only a video that reviews this model is shown.
            if (points.pros.length + points.cons.length === 0) continue
            videos.push(video)
            inputs.push({ sourceUrl: `https://www.youtube.com/watch?v=${video.id}`, ...points })
          }
          // Embeds of someone else's videos are looked at before they go on the site, like the pros and cons they give.
          if (videos.length > 0) await handle(run, reviewsChange(run, slug, 'pros-cons', 'videos', videos))
          await proposeProsCons(run, slug, 'video', inputs)
        },
        stopsStep,
      )
    }
  } catch (error) {
    if (!stopsStep(error)) throw error
    run.tally.skipped++
    console.warn(`youtube skipped: ${message(error)}`)
  }
}

/** A brand's own site refused (bot protection, rate limit, robots): that brand stops, the command goes on with the next. */
class BrandRefusedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`${url} refused: ${reason}`)
    this.name = 'BrandRefusedError'
  }
}
const REFUSALS = new Set(['rate-limited', 'bot-protection', 'robots'])
const isBrandRefusal = (error: unknown) => error instanceof BrandRefusedError
/** The Web Archive itself asked us to slow down or keep out: nothing more can be asked of it, the whole command stops. */
const isArchiveStop = (error: unknown) => error instanceof WaybackError && (error.reason === 'rate-limited' || error.reason === 'bot-protection')

/** True when the page is on the brand's own site (`www.` ignored) and outside its support pages. */
function isProductUrl(brand: Brand, url: string): boolean {
  return sameSite(url, brand.website) && !(brand.scraper.supportUrls ?? []).some((support) => url.startsWith(support))
}

/** What a skipped fetch of a document means: a brand's own refusal stops that brand, the Web Archive's stops the command. */
function documentSkip(run: Run): OnSkip {
  return (url, reason, detail) => {
    const archived = config.archiveHosts.includes(new URL(url).hostname)
    if (archived && (reason === 'rate-limited' || reason === 'bot-protection')) throw new WaybackError(reason, detail)
    if (!archived && REFUSALS.has(reason)) throw new BrandRefusedError(url, reason)
    // `archive-excluded` (the archive does not serve the site) and any other skip: this document is left out.
    skippedSource(run, url, reason, detail)
  }
}

/**
 * `archive-support`: the models the brand's support pages link that its live catalog does not (what `update`
 * leaves to this command). One that matches no stored model and is in scope by an official 2018+ date becomes a
 * new, discontinued card, its page the naming source; a live product page of it makes it an orphan, flagged for
 * review. One that matches a stored model only adds documents. Support model pages are not product pages and
 * are not looked at for that flag: an unlisted model whose only live page is a support page is not flagged.
 */
async function archiveSupport(run: Run, brand: Brand): Promise<void> {
  // The whole catalog is asked too: a model it links is on sale and belongs to `update`. A catalog page lost says nothing.
  let catalogComplete = true
  const onSkip = (url: string, reason: string, detail?: string) => {
    if (REFUSALS.has(reason)) throw new BrandRefusedError(url, reason)
    if (brand.scraper.catalogUrls.includes(url)) catalogComplete = false
    skippedSource(run, url, reason, detail)
  }
  const onEmpty = () => {
    catalogComplete = false
  }
  const all = await discoverModelUrls(brand, { refresh: run.refresh, onSkip, onEmpty })
  for (const group of all.filter((g) => g.inCatalog)) console.log(`${group.modelUrl}: in the live catalog, left to update`)
  const found = all.filter((g) => !g.inCatalog).slice(0, run.limit)
  const candidates: ModelCandidate[] = []
  const documentsOf = new Map<string, Set<string>>()
  const pagesOf = new Map<string, Page[]>()
  const read = async (url: string, opts: { render?: boolean }): Promise<Page | null> => {
    const result = await fetchPage(url, { ...opts, refresh: run.refresh })
    if (result.status === 'ok') return result
    if (REFUSALS.has(result.reason)) throw new BrandRefusedError(url, result.reason)
    skippedSource(run, url, result.reason, result.detail)
    return null
  }
  for (const { modelUrl, documentUrls } of found) {
    await guard(
      run,
      modelUrl,
      async () => {
        const modelPage = await read(modelUrl, { render: brand.scraper.render })
        if (modelPage === null) return
        const pages = [modelPage]
        for (const url of documentUrls) {
          const document = await read(url, {})
          if (document) pages.push(document)
        }
        const candidate = await extractModel(brand, pages)
        candidates.push(candidate)
        const slug = candidate.model.slug
        pagesOf.set(slug, [...(pagesOf.get(slug) ?? []), modelPage])
        documentsOf.set(slug, new Set([...(documentsOf.get(slug) ?? []), ...documentUrls]))
      },
      isBrandRefusal,
    )
  }

  const skip = documentSkip(run)
  for (const candidate of mergeCandidates(candidates)) {
    const { slug } = candidate.model
    const urls = [...(documentsOf.get(slug) ?? [])]
    const existing = matchExistingModel(candidate.model, run.dataset.models)
    if (existing !== null) {
      await addDocuments(run, brand, existing, candidate, urls, skip)
      for (const change of diffModel(existing, candidate)) if (change.kind === 'document') await handle(run, change)
      continue
    }
    if (!isInScope(candidate.model, {})) {
      console.log(`${slug}: no official release date since ${config.onSaleSince.slice(0, 4)}, left out`)
      continue
    }
    if (!catalogComplete) {
      console.log(`${slug}: the live catalog was not read whole, not proposed`)
      continue
    }
    const pages = pagesOf.get(slug) ?? []
    // Every page of the family that is on the brand's product site is read fresh: does the model still have a live page?
    let liveProductPage: Page | undefined
    let decided = true
    for (const page of pages.filter((p) => isProductUrl(brand, p.url))) {
      const own = await readOwnPage(run, page.url, brand.scraper.render)
      if (own.status === 'unread') decided = false
      else if (own.status === 'ok' && isProductUrl(brand, own.page.url)) liveProductPage ??= own.page
    }
    if (!decided && liveProductPage === undefined) {
      console.log(`${slug}: its product page was not read, lifecycle not decided`)
      continue
    }
    const lifecycle = lifecycleOf(candidate.model, { inLiveCatalog: false, listings: [], liveProductPage, namingPage: pages[0] })
    if (lifecycle === null || lifecycle.kind === 'on-sale') {
      console.log(`${slug}: its support page does not name it, not proposed`)
      continue
    }
    await addDocuments(run, brand, null, candidate, urls, skip)
    const lifecycleCheck: CheckResult[] = lifecycle.kind === 'orphan' ? [{ name: 'lifecycle', ok: false, detail: 'orphan-product-page' }] : []
    const archived: ModelCandidate = {
      model: { ...candidate.model, discontinued: { source: lifecycle.source } },
      fieldChecks: { ...candidate.fieldChecks, ...(lifecycleCheck.length > 0 && { discontinued: lifecycleCheck }) },
    }
    for (const change of diffModel(null, archived)) await handle(run, change)
  }
}

/**
 * `archive-documents`: stored documents whose live link is dead, replaced by a checked Web Archive copy. A gone
 * brand's live links are not fetched. A brand-host refusal stops the brand, a web.archive.org one the command;
 * a document the archive does not serve is left alone, and so is a model that fails.
 */
async function archiveDocuments(run: Run, brand: Brand): Promise<void> {
  const gone = brand.status === 'gone'
  const skip = documentSkip(run)
  for (const { slug } of run.dataset.models.filter((m) => m.brand === brand.slug).slice(0, run.limit)) {
    await guard(
      run,
      `${slug} documents`,
      async () => {
        try {
          for (const change of await replaceDeadDocuments(storedModel(run, slug), { brand, gone, refresh: run.refresh, onSkip: skip })) await handle(run, change)
        } catch (error) {
          if (!(error instanceof WaybackError && error.reason === 'archive-excluded')) throw error
          skippedSource(run, slug, 'archive-excluded', `${config.archiveHosts[0]} does not serve this site, documents not replaced`)
        }
      },
      (error) => isBrandRefusal(error) || isArchiveStop(error),
    )
  }
}

/**
 * `archive-wayback`: models found only in Web Archive copies of the brand's catalog pages (a gone brand's, or an
 * active brand's `archive.catalogUrls`), as discontinued cards, with their documents. An active brand's live
 * catalog is read first: the models it lists belong to `update`, and when it cannot be read whole nothing is proposed.
 * A refusal by the brand's site stops the brand, one by web.archive.org the command; a site the archive does not
 * serve (`archive-excluded`) is logged and the run goes on.
 */
async function archiveWayback(run: Run, brand: Brand): Promise<void> {
  const liveModelUrls = new Set<string>()
  if (brand.status === 'active') {
    let complete = true
    const onSkip = (url: string, reason: string, detail?: string) => {
      if (REFUSALS.has(reason)) throw new BrandRefusedError(url, reason)
      complete = false
      skippedSource(run, url, reason, detail)
    }
    const found = await discoverModelUrls(brand, { onSkip, onEmpty: () => (complete = false) })
    if (!complete) {
      console.log(`${brand.slug}: the live catalog was not read whole, Web Archive models not proposed`)
      return
    }
    for (const group of found.filter((g) => g.inCatalog)) liveModelUrls.add(group.modelUrl)
  }
  try {
    const changes = await archiveCandidates(brand, run.dataset.models, {
      limit: run.limit,
      refresh: run.refresh,
      liveModelUrls,
      onSkip: documentSkip(run),
      onFail: (label, error) => {
        run.tally.failed++
        console.warn(`${label} failed: ${message(error)}`)
      },
    })
    for (const change of changes) await handle(run, change)
  } catch (error) {
    if (!(error instanceof WaybackError && error.reason === 'archive-excluded')) throw error
    skippedSource(run, brand.slug, 'archive-excluded', `${config.archiveHosts[0]} does not serve this site, no archive models`)
  }
}

/**
 * `archive-history`: what happened to a brand, from its `historySources` (a gone brand's own pages only as Web
 * Archive copies) and its app's App Store record, as a `brand-history` card for review. Company relations the
 * sources state are queued as proposed. A skipped App Store lookup fails the unit, which a resume repeats.
 */
async function archiveHistory(run: Run, brand: Brand): Promise<void> {
  // Before any fetch: a skipped lookup stops the run (see `AppLookupSkipped`).
  const app = await appStatus(brand, run.dataset)
  const own = ownHosts(brand)
  // Only the brand's own site refusing stops the brand; a news site that refuses is left out with a log line.
  const onSkip: OnSkip = (url, reason, detail) => {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const ownSite = own.some((domain) => host === domain || host.endsWith(`.${domain}`))
    if (REFUSALS.has(reason) && !ownSite && !config.archiveHosts.includes(new URL(url).hostname)) {
      skippedSource(run, url, reason, `${detail ?? ''} (not the brand's site, source left out)`.trim())
      return
    }
    documentSkip(run)(url, reason, detail)
  }
  const pages = await readHistorySources(brand, { refresh: run.refresh, onSkip })
  if (pages.length === 0) {
    console.log(`${brand.slug}: no history source could be read`)
    return
  }
  const { change, relations } = await draftHistory(brand, pages, app, run.dataset.brands)
  if (change === null) console.log(`${brand.slug}: fewer than 3 sourced facts, no history proposed`)
  else await handle(run, change)
  for (const relation of relations) {
    if ((await queueRelation(relation, run.dataset, run.dataDir)) === 'queued') run.tally.pending++
    else run.tally.dropped++
  }
}

/**
 * Per brand, in order: support pages, Web Archive models, documents, brand history. A brand whose site refuses stops there and is recorded as refused: a plain `--resume` skips it but
 * still lists it, a run with `--brand <slug>` tries again.
 */
async function archive(run: Run): Promise<void> {
  for (const brand of run.brands) {
    const refusedKey = `${run.scope} archive-refused:${brand.slug}`
    if (run.progress.has(refusedKey)) {
      console.log(`${brand.slug}: refused earlier, skipped (retry it with --brand ${brand.slug})`)
      run.refused.push(brand.slug)
      continue
    }
    try {
      if (brand.status === 'active' && (brand.scraper.supportUrls ?? []).length > 0) {
        await unit(run, `archive-support:${brand.slug}`, () => archiveSupport(run, brand), isBrandRefusal)
      }
      if (brand.status === 'gone' || (brand.archive?.catalogUrls ?? []).length > 0) {
        await unit(run, `archive-wayback:${brand.slug}`, () => archiveWayback(run, brand), (e) => isBrandRefusal(e) || isArchiveStop(e))
      }
      await unit(run, `archive-documents:${brand.slug}`, () => archiveDocuments(run, brand), (e) => isBrandRefusal(e) || isArchiveStop(e))
      if ((brand.historySources ?? []).length > 0) {
        await unit(run, `archive-history:${brand.slug}`, () => archiveHistory(run, brand), (e) => isBrandRefusal(e) || isArchiveStop(e) || e instanceof AppLookupSkipped)
      }
    } catch (error) {
      if (!isBrandRefusal(error)) throw error
      console.warn(`${brand.slug}: ${(error as Error).message}, brand stopped`)
      await run.progress.done(refusedKey)
      run.refused.push(brand.slug)
    }
  }
}

const RUN_STEP: Record<Step, (run: Run) => Promise<void>> = { scrape, fda, apps, reviews, youtube }

/**
 * Adds the pairs that are curated now to `compare-pairs.json`, so that their pages stay when the closest
 * competitors change. Nothing is ever taken out, and the file is written only when there is a new pair.
 */
async function recordPairs(dataDir: string): Promise<void> {
  const { models, events, comparePairs } = await loadDataset(dataDir)
  const current = selectCuratedPairs(buildCatalogIndex(models, events)).map(([a, b]) => pairSlug(a, b))
  const merged = [...new Set([...comparePairs, ...current])].sort()
  const added = merged.length - comparePairs.length
  if (added === 0) return
  // Checked before writing: a file the loader refuses would stop the site build.
  await writeJson(join(dataDir, 'compare-pairs.json'), ComparePairs.parse(merged))
  console.log(`pairs: ${added} added, ${merged.length} recorded`)
}

/** `progressDir` holds one progress file per command, so that running one step does not end a stopped `update`. */
export type CliOptions = { dataDir?: string; progressDir?: string; prosConsDir?: string; onceFile?: string }

/**
 * Runs a command; resolves to the exit code: 0 done, 1 bad arguments or no site URL, 2 stopped by a usage
 * limit.
 */
export async function main(argv: string[], opts: CliOptions = {}): Promise<number> {
  const { dataDir = 'data', progressDir = '.cache/progress', prosConsDir = '.cache/pros-cons', onceFile = '.cache/once.json' } = opts
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        brand: { type: 'string' },
        resume: { type: 'boolean', default: false },
        refresh: { type: 'boolean', default: false },
        limit: { type: 'string' },
      },
    })
  } catch (error) {
    console.error(message(error))
    return 1
  }
  const { positionals, values } = parsed
  const command = positionals[0]
  const steps: readonly Step[] | undefined =
    command === 'update' ? STEPS : command === 'archive' ? [] : STEPS.includes(command as Step) ? [command as Step] : undefined
  const limit = values.limit === undefined ? Infinity : Number(values.limit)
  const known = steps !== undefined || command === 'pairs'
  if (!known || positionals.length > 1 || !(Number.isInteger(limit) || limit === Infinity) || limit < 1) {
    console.error(`Usage: cli.ts <update|archive|pairs|${STEPS.join('|')}> [--brand <slug>] [--resume] [--refresh] [--limit <n>]`)
    return 1
  }
  // Not a step of the run: it leaves the progress of a stopped one alone.
  if (steps === undefined) {
    await recordPairs(dataDir)
    return 0
  }
  const dataset = await loadDataset(dataDir)
  const brands = values.brand === undefined ? dataset.brands : dataset.brands.filter((brand) => brand.slug === values.brand)
  if (brands.length === 0) {
    console.error(`Unknown brand: ${values.brand}`)
    return 1
  }

  // An archive run limited to one brand keeps its own record: it must not clear the finished units and refusals of a full run.
  const progressFile = command === 'archive' && values.brand !== undefined ? `archive-${values.brand}.json` : `${command}.json`
  const run: Run = {
    dataset,
    dataDir,
    prosConsDir,
    brands,
    limit,
    refresh: values.refresh,
    asOf: currentMonth(),
    startedAt: new Date().toISOString(),
    ...(command === 'archive' && { origin: 'archive' as const }),
    scope: `brand=${values.brand ?? '*'} limit=${values.limit ?? '*'}`,
    progress: await Progress.open(join(progressDir, progressFile), values.resume),
    once: await OnceLedger.open(onceFile),
    refused: [],
    queued: new Set(),
    tally: { auto: 0, pending: 0, dropped: 0, skipped: 0, failed: 0 },
  }
  const summary = () => {
    const { auto, pending, dropped, skipped, failed } = run.tally
    console.log(`Summary: auto ${auto}, pending ${pending}, dropped ${dropped}, skipped sources ${skipped}, failed ${failed}`)
  }

  try {
    if (command === 'archive') await archive(run)
    else for (const step of steps) await RUN_STEP[step](run)
  } catch (error) {
    const stopped = error instanceof LlmLimitError ? `${PROVIDER_NAMES[error.provider]} usage limit reached.` : isArchiveStop(error) ? `${config.archiveHosts[0]} refused requests.` : error instanceof AppLookupSkipped ? `${error.message}; no more App Store lookups this run.` : undefined
    if (stopped === undefined) throw error
    summary()
    // The same command and filters: work done under other filters is not skipped (see `Run.scope`).
    const flags = [
      '--resume',
      ...(values.brand ? ['--brand', values.brand] : []),
      ...(values.limit ? ['--limit', values.limit] : []),
      ...(values.refresh ? ['--refresh'] : []),
    ]
    const also = run.refused.length > 0 ? `. Refused by their own sites: ${run.refused.join(', ')}; try each again later: npm run archive -- --brand <slug>` : ''
    console.error(`${stopped} Resume later: npm run ${command} -- ${flags.join(' ')}${also}`)
    return 2
  }
  if (run.refused.length > 0) {
    // Progress stays: a plain `--resume` skips these brands but lists them again, `--brand <slug>` tries one again.
    summary()
    console.error(`Refused by their own sites: ${run.refused.join(', ')}. Try one again later: ${run.refused.map((slug) => `npm run archive -- --brand ${slug}`).join('; ')}`)
    return 2
  }
  if (command === 'archive' && values.brand !== undefined) {
    // Done after a refusal: the full run no longer has to skip this brand.
    const full = await Progress.open(join(progressDir, 'archive.json'), true)
    await full.forget(`brand=* limit=* archive-refused:${values.brand}`)
  }
  await run.progress.clear()
  if (command === 'update') await recordPairs(dataDir)
  summary()
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Secrets and the site URL, before anything reads the config. Variables already set are kept.
  try {
    process.loadEnvFile('.env.local')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  process.exitCode = await main(process.argv.slice(2))
}
