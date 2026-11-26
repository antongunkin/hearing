// `npm run update`: every source in turn, each change dropped, applied or queued for review. A run stopped by
// the Claude usage limit goes on with `--resume`. `scrape`, `fda`, `apps`, `reviews` and `youtube` run one step.
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { applyAuto, diffModel, enqueue, route, withCrossChecks } from '@/pipeline/apply'
import { config } from '@/pipeline/config'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { LlmLimitError, LlmUnavailableError } from '@/pipeline/llm'
import { readCache } from '@/pipeline/llm/cache'
import { Progress } from '@/pipeline/progress'
import { discoverModelUrls, extractModel, isInScope, matchExistingModel } from '@/pipeline/sources/brand-site'
import { fetchIosVersion } from '@/pipeline/sources/itunes'
import { fetchFdaEvents } from '@/pipeline/sources/openfda'
import { extractExpertProsCons, synthesizeProsCons } from '@/pipeline/sources/pros-cons'
import { complaintThemes, currentMonth, discoverReviewSources, extractRetailReviews } from '@/pipeline/sources/reviews'
import { discoverThirdPartyFacts } from '@/pipeline/sources/third-party-facts'
import { analyzeVideo, searchVideos, YouTubeError } from '@/pipeline/sources/youtube'
import { loadDataset, type Dataset } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'
import type { Brand } from '@/src/lib/schema/brand'
import type { Model } from '@/src/lib/schema/model'
import type { CandidateChange } from '@/src/lib/schema/pending'
import type { Reviews } from '@/src/lib/schema/reviews'

type Page = Extract<FetchResult, { status: 'ok' }>

const LIMIT_MESSAGE = 'Claude usage limit reached. Resume later: npm run update -- --resume'

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
  /** The filters of the run (`--brand`, `--limit`): work done under other filters is not this run's. */
  scope: string
  progress: Progress
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

/** Counts and logs a source that gave nothing. */
function skippedSource(run: Run, url: string, reason: string, detail?: string): void {
  run.tally.skipped++
  console.warn(`${url} skipped: ${reason}${detail ? ` (${detail})` : ''}`)
}

/** Drops, applies or queues one change. Risky fields are read again only for a change that is kept. */
async function handle(run: Run, change: CandidateChange): Promise<void> {
  if (route(change, run.dataset.rejections) === 'drop') {
    run.tally.dropped++
    return
  }
  const checked = await withCrossChecks(change)
  if (route(checked, run.dataset.rejections) === 'auto') {
    await applyAuto(checked, run.dataset, run.dataDir)
    run.tally.auto++
  } else {
    await enqueue(checked, run.dataDir)
    run.tally.pending++
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

/** Brand sites (new models and spec changes), then third-party prices and hardware twins. */
async function scrape(run: Run): Promise<void> {
  for (const brand of run.brands) {
    let groups: Awaited<ReturnType<typeof discoverModelUrls>> = []
    await guard(run, `${brand.slug} catalog`, async () => {
      const onSkip = (url: string, reason: string, detail?: string) => skippedSource(run, url, reason, detail)
      groups = (await discoverModelUrls(brand, { refresh: run.refresh, onSkip })).slice(0, run.limit)
    })
    for (const { modelUrl, documentUrls } of groups) {
      await unit(run, `scrape:${brand.slug}:${modelUrl}`, async () => {
        const modelPage = await page(run, modelUrl, { render: brand.scraper.render, refresh: run.refresh })
        if (modelPage === null) return
        const pages = [modelPage]
        for (const url of documentUrls) {
          const document = await page(run, url, { refresh: run.refresh })
          if (document) pages.push(document)
        }
        const candidate = await extractModel(brand, pages)
        const existing = matchExistingModel(candidate.model, run.dataset.models)
        if (existing === null && !isInScope(candidate.model)) {
          console.log(`${candidate.model.slug}: released before ${config.releasedAfter}, left out`)
          return
        }
        for (const change of diffModel(existing, candidate)) await handle(run, change)
      })
    }
  }
  for (const slug of modelSlugs(run)) {
    await unit(run, `third-party:${slug}`, async () => {
      const changes = await discoverThirdPartyFacts(storedModel(run, slug), { asOf: run.asOf, refresh: run.refresh })
      for (const change of changes) await handle(run, change)
    })
  }
}

/** FDA clearances and recalls of stored models, since the catalog's cut-off date; a repeated event is not written again. */
async function fda(run: Run): Promise<void> {
  await unit(run, 'fda', async () => {
    const models = run.dataset.models.filter((model) => run.brands.some((brand) => brand.slug === model.brand))
    const found = await fetchFdaEvents(config.releasedAfter, run.brands, models)
    const unmatched = found.filter((event) => !event.matched).length
    if (unmatched > 0) console.log(`fda: ${unmatched} events name no stored model, left out`)
    for (const { event, matched } of found) {
      if (matched) await handle(run, { kind: 'fda-event', modelSlug: event.modelSlug, path: 'events', after: event, checks: {} })
    }
  })
}

/** iOS app versions from the App Store; models that share an app are looked up once. */
async function apps(run: Run): Promise<void> {
  const versions = new Map<string, Awaited<ReturnType<typeof fetchIosVersion>>>()
  for (const slug of modelSlugs(run)) {
    const iosId = storedModel(run, slug).app?.iosId
    if (iosId === undefined) continue
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
    await unit(run, `reviews:${slug}`, async () => {
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
      if (texts.length > 0) {
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

/** Video reviews: found through the YouTube Data API, heard by Gemini. Without either, the step is skipped. */
async function youtube(run: Run): Promise<void> {
  const stopsStep = (error: unknown) => error instanceof YouTubeError || error instanceof LlmUnavailableError
  try {
    for (const slug of modelSlugs(run)) {
      await unit(
        run,
        `youtube:${slug}`,
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

const RUN_STEP: Record<Step, (run: Run) => Promise<void>> = { scrape, fda, apps, reviews, youtube }

export type CliOptions = { dataDir?: string; progressFile?: string; prosConsDir?: string }

/** Runs a command; resolves to the exit code: 0 done, 1 bad arguments, 2 stopped by the usage limit. */
export async function main(argv: string[], opts: CliOptions = {}): Promise<number> {
  const { dataDir = 'data', progressFile = '.cache/progress.json', prosConsDir = '.cache/pros-cons' } = opts
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
    command === 'update' ? STEPS : STEPS.includes(command as Step) ? [command as Step] : undefined
  const limit = values.limit === undefined ? Infinity : Number(values.limit)
  if (steps === undefined || positionals.length > 1 || !(Number.isInteger(limit) || limit === Infinity) || limit < 1) {
    console.error(`Usage: cli.ts <update|${STEPS.join('|')}> [--brand <slug>] [--resume] [--refresh] [--limit <n>]`)
    return 1
  }

  const dataset = await loadDataset(dataDir)
  const brands = values.brand === undefined ? dataset.brands : dataset.brands.filter((brand) => brand.slug === values.brand)
  if (brands.length === 0) {
    console.error(`Unknown brand: ${values.brand}`)
    return 1
  }

  const run: Run = {
    dataset,
    dataDir,
    prosConsDir,
    brands,
    limit,
    refresh: values.refresh,
    asOf: currentMonth(),
    scope: `brand=${values.brand ?? '*'} limit=${values.limit ?? '*'}`,
    progress: await Progress.open(progressFile, values.resume),
    tally: { auto: 0, pending: 0, dropped: 0, skipped: 0, failed: 0 },
  }
  const summary = () => {
    const { auto, pending, dropped, skipped, failed } = run.tally
    console.log(`Summary: auto ${auto}, pending ${pending}, dropped ${dropped}, skipped sources ${skipped}, failed ${failed}`)
  }

  try {
    for (const step of steps) await RUN_STEP[step](run)
  } catch (error) {
    if (!(error instanceof LlmLimitError)) throw error
    summary()
    console.error(LIMIT_MESSAGE)
    const filters = [values.brand && `--brand ${values.brand}`, values.limit && `--limit ${values.limit}`].filter(Boolean)
    if (filters.length > 0) console.error(`Resume with the same filters: ${filters.join(' ')}`)
    return 2
  }
  await run.progress.clear()
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
