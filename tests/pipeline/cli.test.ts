// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { priorCatalogCopies } from '@/pipeline/archive/catalog-history'
import { crossCheck } from '@/pipeline/checks/crosscheck'
import { main } from '@/pipeline/cli'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { llm, LlmLimitError, LlmOutputError } from '@/pipeline/llm'
import { discoverModelUrls, extractModel, type ModelCandidate } from '@/pipeline/sources/brand-site'
import { fetchIosVersion } from '@/pipeline/sources/itunes'
import { fetchFdaEvents } from '@/pipeline/sources/openfda'
import { complaintThemes, discoverReviewSources, extractRetailReviews } from '@/pipeline/sources/reviews'
import { discoverThirdPartyFacts } from '@/pipeline/sources/third-party-facts'
import { analyzeVideo, searchVideos, YouTubeError } from '@/pipeline/sources/youtube'
import { synthesizeProsCons } from '@/pipeline/sources/pros-cons'
import { writeJson } from '@/src/lib/data/write'
import { Model } from '@/src/lib/schema/model'
import { PendingChange } from '@/src/lib/schema/pending'
import { Reviews } from '@/src/lib/schema/reviews'

vi.mock('@/pipeline/archive/catalog-history', () => ({ priorCatalogCopies: vi.fn() }))
vi.mock('@/pipeline/fetch/fetcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/fetch/fetcher')>()),
  fetchPage: vi.fn(),
}))
vi.mock('@/pipeline/checks/crosscheck', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/checks/crosscheck')>()),
  crossCheck: vi.fn(),
}))
vi.mock('@/pipeline/sources/brand-site', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/sources/brand-site')>()),
  discoverModelUrls: vi.fn(),
  extractModel: vi.fn(),
}))
// No real model is ever asked from here.
vi.mock('@/pipeline/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/llm')>()),
  llm: vi.fn(),
}))
vi.mock('@/pipeline/sources/pros-cons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/sources/pros-cons')>()),
  synthesizeProsCons: vi.fn(),
}))
vi.mock('@/pipeline/sources/openfda', () => ({ fetchFdaEvents: vi.fn() }))
vi.mock('@/pipeline/sources/itunes', () => ({ fetchIosVersion: vi.fn() }))
vi.mock('@/pipeline/sources/third-party-facts', () => ({ discoverThirdPartyFacts: vi.fn() }))
vi.mock('@/pipeline/sources/reviews', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/sources/reviews')>()),
  discoverReviewSources: vi.fn(),
  extractRetailReviews: vi.fn(),
  complaintThemes: vi.fn(),
}))
vi.mock('@/pipeline/sources/youtube', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/sources/youtube')>()),
  searchVideos: vi.fn(),
  analyzeVideo: vi.fn(),
}))

const FETCHED_AT = '2026-11-26T10:00:00.000Z'
const BASE = 'https://www.jabraenhance.com/product'
const okPage = (url: string): Extract<FetchResult, { status: 'ok' }> => ({
  status: 'ok',
  url,
  text: `page ${url}`,
  contentHash: 'hash',
  fetchedAt: FETCHED_AT,
})

const brand = {
  slug: 'jabra-enhance',
  name: 'Jabra Enhance',
  group: 'GN',
  website: 'https://www.jabraenhance.com',
  imageLicense: 'none',
  defaultType: 'otc',
  status: 'active',
  scraper: { catalogUrls: [BASE], modelUrlPattern: '', render: false },
}

const model = (name: string, extra: Partial<Model> = {}): Model =>
  Model.parse({
    slug: `jabra-enhance-${name.toLowerCase().replace(/ /g, '-')}`,
    brand: 'jabra-enhance',
    name,
    aliases: [],
    type: 'otc',
    sameHardwareAs: [],
    variants: [
      {
        id: 'ric',
        formFactor: 'RIC',
        weightG: { value: 2.1, unit: 'g', quote: '2.1 g', sourceUrl: `${BASE}/x`, fetchedAt: FETCHED_AT, sourceType: 'official' },
      },
    ],
    ...extra,
  })
const candidate = (name: string): ModelCandidate => ({ model: model(name), fieldChecks: { 'variants.0.weightG': [{ name: 'literal', ok: true }] } })

let dir: string
let dataDir: string
/** Where `update` keeps its progress; each command has its own file in the progress directory. */
let progressFile: string
let opts: { dataDir: string; progressDir: string; prosConsDir: string }
let log: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cli-'))
  dataDir = join(dir, 'data')
  progressFile = join(dir, 'cache', 'progress', 'update.json')
  opts = { dataDir, progressDir: join(dir, 'cache', 'progress'), prosConsDir: join(dir, 'cache', 'pros-cons') }
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://hearing.test')
  await writeJson(join(dataDir, 'brands', 'jabra-enhance.json'), brand)
  await writeJson(join(dataDir, 'rejections.json'), [])
  await writeJson(join(dataDir, 'blocklist.json'), [])
  log = []
  const capture = (...args: unknown[]) => void log.push(args.join(' '))
  vi.spyOn(console, 'log').mockImplementation(capture)
  vi.spyOn(console, 'warn').mockImplementation(capture)
  vi.spyOn(console, 'error').mockImplementation(capture)

  vi.mocked(fetchPage).mockImplementation(async (url) => okPage(url))
  vi.mocked(crossCheck).mockResolvedValue({ name: 'crosscheck', ok: true })
  vi.mocked(fetchFdaEvents).mockResolvedValue([])
  vi.mocked(discoverThirdPartyFacts).mockResolvedValue([])
  vi.mocked(discoverReviewSources).mockResolvedValue({ expert: [], retail: [] })
  vi.mocked(searchVideos).mockResolvedValue([])
  vi.mocked(synthesizeProsCons).mockResolvedValue(null)
  vi.mocked(priorCatalogCopies).mockResolvedValue([])
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
}

test('LlmLimitError mid-run: exit 2, progress saved, no *.tmp, resume skips done brands and reads the stopped one again', async () => {
  await writeJson(join(dataDir, 'brands', 'audien.json'), { ...brand, slug: 'audien', name: 'Audien', website: 'https://audien.com' })
  const groups = ['select-100', 'select-200', 'select-300'].map((slug) => ({ modelUrl: `${BASE}/${slug}`, documentUrls: [], inCatalog: true }))
  vi.mocked(discoverModelUrls).mockImplementation(async (b) => (b.slug === 'audien' ? [{ modelUrl: 'https://audien.com/atom', documentUrls: [], inCatalog: true }] : groups))
  const atom = candidate('Atom')
  atom.model = Model.parse({ ...atom.model, slug: 'audien-atom', brand: 'audien' })
  vi.mocked(extractModel)
    .mockResolvedValueOnce(atom)
    .mockResolvedValueOnce(candidate('Select 100'))
    .mockRejectedValueOnce(new LlmLimitError('claude', 'usage limit'))

  expect(await main(['update'], opts)).toBe(2)

  expect(log).toContain('Claude usage limit reached. Resume later: npm run update -- --resume')
  // Audien was done; Jabra Enhance stopped before its pages were compared with the data.
  expect(await filesUnder(join(dataDir, 'pending'))).toEqual(['audien-atom-model.json'])
  expect(JSON.parse(await readFile(progressFile, 'utf8'))).toEqual({ done: ['brand=* limit=* scrape:audien'] })
  expect([...(await filesUnder(dataDir)), ...(await filesUnder(join(dir, 'cache')))].filter((f) => f.endsWith('.tmp'))).toEqual([])
  expect(fetchFdaEvents).not.toHaveBeenCalled() // the run stopped

  vi.mocked(extractModel).mockReset()
  vi.mocked(extractModel)
    .mockResolvedValueOnce(candidate('Select 100'))
    .mockResolvedValueOnce(candidate('Select 200'))
    .mockResolvedValueOnce(candidate('Select 300'))
  expect(await main(['update', '--resume'], opts)).toBe(0)

  // The stopped brand is read again whole (from the page and LLM caches, in a real run); Audien is not.
  expect(vi.mocked(extractModel).mock.calls.map(([, pages]) => pages.map((page) => page.url))).toEqual([
    [`${BASE}/select-100`],
    [`${BASE}/select-200`],
    [`${BASE}/select-300`],
  ])
  const pending = (await filesUnder(join(dataDir, 'pending'))).sort()
  expect(pending).toEqual([
    'audien-atom-model.json',
    'jabra-enhance-select-100-model.json',
    'jabra-enhance-select-200-model.json',
    'jabra-enhance-select-300-model.json',
  ])
  const first = PendingChange.parse(JSON.parse(await readFile(join(dataDir, 'pending', pending[1]), 'utf8')))
  expect(first.kind).toBe('new-model')
  expect(first.checks['variants.0.weightG']).toEqual([{ name: 'literal', ok: true }, { name: 'crosscheck', ok: true }])
  expect(fetchFdaEvents).toHaveBeenCalled()
  await expect(readFile(progressFile)).rejects.toThrow() // finished: nothing to resume
  expect(log.at(-1)).toBe('Summary: auto 0, pending 3, dropped 0, skipped sources 0, failed 0')
})

test('scrape: the pages of one family give one new model with the variants of all of them', async () => {
  const groups = ['reveal-r', 'reveal-t'].map((slug) => ({ modelUrl: `${BASE}/${slug}`, documentUrls: [], inCatalog: true }))
  vi.mocked(discoverModelUrls).mockResolvedValue(groups)
  const style = (id: string): ModelCandidate => {
    const c = candidate('Reveal')
    c.model = Model.parse({ ...c.model, variants: [{ ...c.model.variants[0], id }] })
    return c
  }
  vi.mocked(extractModel).mockResolvedValueOnce(style('minirite-r')).mockResolvedValueOnce(style('minirite-t'))

  expect(await main(['scrape'], opts)).toBe(0)

  expect(await filesUnder(join(dataDir, 'pending'))).toEqual(['jabra-enhance-reveal-model.json'])
  const card = PendingChange.parse(JSON.parse(await readFile(join(dataDir, 'pending', 'jabra-enhance-reveal-model.json'), 'utf8')))
  expect((card.after as Model).variants.map((v) => v.id)).toEqual(['minirite-r', 'minirite-t'])
  expect(Object.keys(card.checks).sort()).toEqual(['variants.0.weightG', 'variants.1.weightG'])
  expect(log.at(-1)).toBe('Summary: auto 0, pending 1, dropped 0, skipped sources 0, failed 0')
})

test('a gone brand is not scraped live', async () => {
  await writeJson(join(dataDir, 'brands', 'jabra-enhance.json'), { ...brand, status: 'gone' })

  expect(await main(['scrape'], opts)).toBe(0)

  expect(discoverModelUrls).not.toHaveBeenCalled()
  expect(log).toContain('jabra-enhance: gone, not scraped live')
})

test('a proposal that replaces another made earlier in the same run is reported', async () => {
  const stored = model('Select 300')
  await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
  const proposal = (value: number) => ({
    kind: 'spec-change' as const,
    modelSlug: stored.slug,
    path: 'variants.0.weightG',
    before: stored.variants[0].weightG,
    after: { ...stored.variants[0].weightG!, value, quote: `${value} g` },
    checks: {},
  })
  vi.mocked(discoverThirdPartyFacts).mockResolvedValue([proposal(2.2), proposal(2.3)])

  expect(await main(['scrape'], opts)).toBe(0)

  expect(log).toContain(`${stored.slug}-variants-0-weightg: replaces a proposal made earlier in this run`)
})

test('per-step failures are counted and the run goes on; youtube without a key is skipped', async () => {
  const stored = model('Select 300', { app: { name: 'Jabra Enhance', iosId: '123' } })
  await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
  vi.mocked(discoverModelUrls).mockImplementation(async (_brand, opts) => {
    opts?.onSkip?.(BASE, 'robots', 'disallowed')
    return []
  })
  vi.mocked(fetchFdaEvents).mockRejectedValue(new Error('openFDA 510k skipped: http-error (HTTP 500)'))
  vi.mocked(fetchIosVersion).mockResolvedValue(null)
  const shop = 'https://shop.example/select-300'
  vi.mocked(discoverReviewSources).mockResolvedValue({ expert: [], retail: [shop, 'https://blocked.example/x'] })
  vi.mocked(fetchPage).mockImplementation(async (url) =>
    url === shop ? okPage(url) : { status: 'skipped', url, reason: 'bot-protection', detail: 'HTTP 403' },
  )
  // Enough reviews for complaint themes (config.minThemeReviews).
  const texts = Array.from({ length: 20 }, (_, i) => `battery died after ${i + 1} days`)
  vi.mocked(extractRetailReviews).mockResolvedValue({ rating: 4.2, count: 87, texts })
  vi.mocked(complaintThemes).mockRejectedValue(new LlmOutputError('some reviews have no entry'))
  vi.mocked(searchVideos).mockRejectedValue(new YouTubeError('YOUTUBE_API_KEY is not set'))

  expect(await main(['update', '--refresh'], opts)).toBe(0)

  expect(vi.mocked(discoverModelUrls).mock.calls[0][1]).toMatchObject({ refresh: true })
  expect(vi.mocked(discoverThirdPartyFacts).mock.calls[0][1]).toEqual({ asOf: expect.stringMatching(/^\d{4}-\d{2}$/), refresh: true })
  const reviews = Reviews.parse(JSON.parse(await readFile(join(dataDir, 'reviews', `${stored.slug}.json`), 'utf8')))
  expect(reviews.customer).toEqual([{ sourceUrl: shop, rating: 4.2, count: 87, fetchedAt: FETCHED_AT }])
  expect(log.some((line) => line.includes('youtube skipped') && line.includes('YOUTUBE_API_KEY'))).toBe(true)
  expect(log).toContain(`${BASE} skipped: robots (disallowed)`)
  // Skipped: the catalog, the iTunes lookup, one shop page and the youtube step. Failed: FDA and complaint themes.
  expect(log.at(-1)).toBe('Summary: auto 1, pending 0, dropped 0, skipped sources 4, failed 2')
})

test('subcommand runs only its step; --limit caps models per brand', async () => {
  for (const name of ['Select 100', 'Select 200']) {
    const stored = model(name, { app: { name: 'Jabra Enhance', iosId: '123' } })
    await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
  }
  vi.mocked(fetchIosVersion).mockResolvedValue(null)

  expect(await main(['apps', '--limit', '1'], opts)).toBe(0)

  expect(fetchIosVersion).toHaveBeenCalledTimes(1)
  expect(discoverModelUrls).not.toHaveBeenCalled()
  expect(fetchFdaEvents).not.toHaveBeenCalled()
  expect(discoverReviewSources).not.toHaveBeenCalled()
  expect(await main(['update', '--brand', 'nope'], opts)).toBe(1)
})

test('reviews: complaint themes are proposed only from at least 20 reviews, with how many they come from', async () => {
  const stored = model('Select 300')
  await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
  const shops = ['https://shop.example/a', 'https://shop.example/b']
  vi.mocked(discoverReviewSources).mockResolvedValue({ expert: [], retail: shops })
  const texts = (from: number, count: number) => Array.from({ length: count }, (_, i) => `review ${from + i}`)
  vi.mocked(extractRetailReviews)
    .mockResolvedValueOnce({ rating: 4.2, count: 87, texts: texts(0, 12) })
    .mockResolvedValueOnce({ rating: 4.0, count: 9, texts: texts(12, 7) })
  expect(await main(['reviews'], opts)).toBe(0)
  expect(complaintThemes).not.toHaveBeenCalled() // 19 reviews

  const themes = [{ theme: 'battery', share: 0.25, n: 5, of: 20 }]
  vi.mocked(complaintThemes).mockResolvedValue(themes)
  vi.mocked(extractRetailReviews)
    .mockResolvedValueOnce({ rating: 4.2, count: 87, texts: texts(0, 13) })
    .mockResolvedValueOnce({ rating: 4.0, count: 9, texts: texts(13, 7) })
  expect(await main(['reviews'], opts)).toBe(0)
  expect(vi.mocked(complaintThemes).mock.calls[0][0]).toHaveLength(20)
  const reviews = Reviews.parse(JSON.parse(await readFile(join(dataDir, 'reviews', `${stored.slug}.json`), 'utf8')))
  expect(reviews.complaintThemes).toEqual(themes)
})

test('apps: a new version of an app two models share gives one event, also when the run is repeated', async () => {
  const at = { sourceUrl: 'https://apps.apple.com/us/app/x/id555', fetchedAt: FETCHED_AT, sourceType: 'official' as const }
  const old = { value: '2.4.0', quote: '2.4.0', ...at }
  const app = { name: 'Jabra Enhance', iosId: '555', iosVersion: old }
  const stored = ['Select 100', 'Select 200'].map((name) => model(name, { app }))
  for (const m of stored) await writeJson(join(dataDir, 'models', `${m.slug}.json`), m)
  vi.mocked(fetchIosVersion).mockResolvedValue({ value: '2.5.0', quote: '2.5.0', ...at })
  vi.mocked(llm).mockResolvedValue({ text: 'The Jabra Enhance app for iOS was updated to version 2.5.0.' })

  expect(await main(['apps'], opts)).toBe(0)

  const events = await filesUnder(join(dataDir, 'events'))
  expect(events).toHaveLength(1)
  expect(JSON.parse(await readFile(join(dataDir, 'events', events[0]), 'utf8'))).toMatchObject({ modelSlug: null, key: '555:2.5.0' })
  for (const m of stored) {
    const updated = Model.parse(JSON.parse(await readFile(join(dataDir, 'models', `${m.slug}.json`), 'utf8')))
    expect(updated.app?.iosVersion?.value).toBe('2.5.0')
  }
  expect(log.at(-1)).toBe('Summary: auto 2, pending 0, dropped 0, skipped sources 0, failed 0')

  // As if the run had stopped after the event and the first model: the second model is still on 2.4.0.
  await writeJson(join(dataDir, 'models', `${stored[1].slug}.json`), stored[1])
  expect(await main(['apps', '--resume'], opts)).toBe(0)
  expect(await filesUnder(join(dataDir, 'events'))).toEqual(events)
  expect(llm).toHaveBeenCalledTimes(1)
})

test('youtube: videos that review the model and the pros and cons they give go to review', async () => {
  const stored = model('Select 300')
  await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
  const videos = [
    { id: 'aaaaaaaaaaa', channel: 'Hear Advice', title: 'Select 300 review' },
    { id: 'bbbbbbbbbbb', channel: 'Other', title: 'Select 300 vs Select 200' },
  ]
  vi.mocked(searchVideos).mockResolvedValue(videos)
  vi.mocked(analyzeVideo)
    .mockResolvedValueOnce({ pros: ['clear speech in quiet rooms'], cons: [] })
    .mockResolvedValueOnce({ pros: [], cons: [] })
  const prosCons = { pros: [{ text: 'clear speech in quiet rooms', sources: ['https://www.youtube.com/watch?v=aaaaaaaaaaa'] }], cons: [] }
  vi.mocked(synthesizeProsCons).mockResolvedValue(prosCons)

  expect(await main(['youtube'], opts)).toBe(0)

  expect(synthesizeProsCons).toHaveBeenCalledWith([
    { sourceUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', pros: ['clear speech in quiet rooms'], cons: [] },
  ])
  const read = async (name: string) =>
    PendingChange.parse(JSON.parse(await readFile(join(dataDir, 'pending', `${stored.slug}-${name}.json`), 'utf8')))
  expect(await read('reviews-videos')).toMatchObject({ kind: 'pros-cons', path: 'reviews.videos', after: [videos[0]] })
  expect(await read('reviews-proscons')).toMatchObject({ kind: 'pros-cons', path: 'reviews.prosCons', after: prosCons })
  expect(log.at(-1)).toBe('Summary: auto 0, pending 2, dropped 0, skipped sources 0, failed 0')
})

test('a Gemini rate limit skips the rest of the youtube step; the run goes on and ends', async () => {
  await store('Select 100', 'Select 200')
  vi.mocked(discoverModelUrls).mockResolvedValue([])
  vi.mocked(searchVideos).mockResolvedValue([{ id: 'aaaaaaaaaaa', channel: 'Hear Advice', title: 'review' }])
  vi.mocked(analyzeVideo).mockRejectedValue(new LlmLimitError('gemini', 'Gemini rate limit: RESOURCE_EXHAUSTED'))

  expect(await main(['update'], opts)).toBe(0)

  expect(analyzeVideo).toHaveBeenCalledTimes(1) // not tried again for the second model
  expect(log.some((line) => line.startsWith('youtube skipped: Gemini rate limit'))).toBe(true)
  expect(await recorded()).toEqual(['jabra-enhance-select-100-vs-jabra-enhance-select-200'])
  await expect(readFile(progressFile)).rejects.toThrow()
  expect(log.at(-1)).toBe('Summary: auto 0, pending 0, dropped 0, skipped sources 1, failed 0')
})

test('the usage-limit message names the provider and the exact command to resume with', async () => {
  vi.mocked(discoverModelUrls).mockResolvedValue([{ modelUrl: `${BASE}/select-100`, documentUrls: [], inCatalog: true }])
  vi.mocked(extractModel).mockRejectedValue(new LlmLimitError('claude', 'usage limit'))

  expect(await main(['scrape', '--brand', 'jabra-enhance', '--limit', '3', '--refresh'], opts)).toBe(2)

  expect(log).toContain('Claude usage limit reached. Resume later: npm run scrape -- --resume --brand jabra-enhance --limit 3 --refresh')
})

test("a single step run between a stopped update and its resume leaves the update's progress alone", async () => {
  vi.mocked(discoverModelUrls).mockResolvedValue([{ modelUrl: `${BASE}/select-100`, documentUrls: [], inCatalog: true }])
  vi.mocked(extractModel).mockResolvedValue(candidate('Select 100'))
  vi.mocked(fetchFdaEvents).mockRejectedValueOnce(new LlmLimitError('claude', 'usage limit'))
  expect(await main(['update'], opts)).toBe(2)
  const saved = await readFile(progressFile, 'utf8')

  expect(await main(['fda'], opts)).toBe(0)
  expect(await readFile(progressFile, 'utf8')).toBe(saved)

  expect(await main(['update', '--resume'], opts)).toBe(0)
  expect(extractModel).toHaveBeenCalledTimes(1) // the brand was done before the stop
})

test('--resume with other --brand or --limit does not skip work done under the old filters', async () => {
  const groups = ['select-100', 'select-200'].map((slug) => ({ modelUrl: `${BASE}/${slug}`, documentUrls: [], inCatalog: true }))
  vi.mocked(discoverModelUrls).mockResolvedValue(groups)
  vi.mocked(extractModel).mockResolvedValueOnce(candidate('Select 100')).mockRejectedValueOnce(new LlmLimitError('claude', 'usage limit'))
  expect(await main(['update', '--brand', 'jabra-enhance', '--limit', '2'], opts)).toBe(2)

  vi.mocked(extractModel).mockReset()
  vi.mocked(extractModel).mockResolvedValue(candidate('Select 100'))
  expect(await main(['update', '--resume', '--limit', '1'], opts)).toBe(0)

  // Select 100 was done for "jabra-enhance, 2 models", not for "all brands, 1 model": done again.
  expect(vi.mocked(extractModel).mock.calls.map(([, pages]) => pages[0].url)).toEqual([`${BASE}/select-100`])
})

const pairsFile = () => join(dataDir, 'compare-pairs.json')
const recorded = async () => JSON.parse(await readFile(pairsFile(), 'utf8'))
async function store(...names: string[]) {
  for (const name of names) {
    const stored = model(name)
    await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
  }
}

test('pairs: adds the current pairs to the recorded ones, once', async () => {
  await store('Select 100', 'Select 200', 'Select 300')
  // Recorded earlier; one of its models is gone for now.
  await writeJson(pairsFile(), ['jabra-enhance-select-100-vs-jabra-enhance-select-50'])
  // A stopped run waits to be resumed.
  await writeJson(progressFile, { done: ['x'] })

  expect(await main(['pairs'], opts)).toBe(0)

  const all = [
    'jabra-enhance-select-100-vs-jabra-enhance-select-200',
    'jabra-enhance-select-100-vs-jabra-enhance-select-300',
    'jabra-enhance-select-100-vs-jabra-enhance-select-50',
    'jabra-enhance-select-200-vs-jabra-enhance-select-300',
  ]
  expect(await recorded()).toEqual(all)
  expect(log).toEqual(['pairs: 3 added, 4 recorded'])
  expect(JSON.parse(await readFile(progressFile, 'utf8'))).toEqual({ done: ['x'] })

  const written = await stat(pairsFile())
  expect(await main(['pairs'], opts)).toBe(0)
  expect(await recorded()).toEqual(all)
  expect((await stat(pairsFile())).ino).toBe(written.ino) // not written again: writeJson would replace the file
  expect(log).toHaveLength(1)
  for (const source of [discoverModelUrls, fetchPage, fetchFdaEvents, fetchIosVersion, llm]) expect(source).not.toHaveBeenCalled()
})

test('pairs: writes no file while there is no pair', async () => {
  await store('Select 100')

  expect(await main(['pairs'], opts)).toBe(0)

  await expect(stat(pairsFile())).rejects.toThrow()
})

test('update ends by recording the pairs; one step alone does not', async () => {
  await store('Select 100', 'Select 200')
  vi.mocked(discoverModelUrls).mockResolvedValue([])

  expect(await main(['apps'], opts)).toBe(0)
  await expect(stat(pairsFile())).rejects.toThrow()

  expect(await main(['update'], opts)).toBe(0)
  expect(await recorded()).toEqual(['jabra-enhance-select-100-vs-jabra-enhance-select-200'])
})

// Lifecycle: a stored model that the complete live catalog no longer lists, or lists again.
const LISTED = { modelUrl: `${BASE}/select-500`, documentUrls: [], inCatalog: true }
const copy = (fetchedAt: string, text: string): Extract<FetchResult, { status: 'ok' }> => ({ ...okPage(BASE), fetchedAt, text })
const pendingCard = async (id: string) => PendingChange.parse(JSON.parse(await readFile(join(dataDir, 'pending', `${id}.json`), 'utf8')))
const SOURCE = { value: 'Select 300', quote: 'Jabra Enhance Select 300', sourceUrl: `${BASE}/x`, fetchedAt: FETCHED_AT, sourceType: 'official' as const }

async function storeSelect300(extra: Partial<Model> = {}): Promise<Model> {
  const stored = model('Select 300', extra)
  await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
  return stored
}

/** A complete catalog that lists one model, Select 500. */
function catalogLists500() {
  vi.mocked(discoverModelUrls).mockImplementation(async (_brand, o) => {
    o?.onCatalog?.(BASE, { quote: 'Hearing aids', fetchedAt: '2026-11-27T09:00:00.000Z' })
    return [LISTED]
  })
  vi.mocked(extractModel).mockImplementation(async () => candidate('Select 500'))
}

test('a model missing from a complete catalog is proposed as discontinued, for review, with the month it was last listed', async () => {
  const stored = await storeSelect300()
  catalogLists500()
  vi.mocked(priorCatalogCopies).mockResolvedValue([
    copy('2026-03-05T00:00:00.000Z', 'Jabra Enhance Select 300\nBuy now'),
    copy('2025-11-02T00:00:00.000Z', 'Jabra Enhance Select 300'),
  ])

  expect(await main(['scrape'], opts)).toBe(0)

  const card = await pendingCard(`${stored.slug}-discontinued`)
  expect(card).toMatchObject({ kind: 'spec-change', path: 'discontinued', modelSlug: stored.slug })
  expect(card.before).toBeUndefined()
  expect(card.after).toMatchObject({ lastListed: '2026-03', source: { value: 'Select 300', quote: 'Jabra Enhance Select 300' } })
  expect(vi.mocked(priorCatalogCopies).mock.calls[0][0]).toEqual([BASE])
  // The model is not changed by the proposal.
  expect(JSON.parse(await readFile(join(dataDir, 'models', `${stored.slug}.json`), 'utf8')).discontinued).toBeUndefined()
})

test('a model that no logged copy names is still proposed as discontinued, without a date, sourced to the catalog it is absent from', async () => {
  const stored = await storeSelect300()
  catalogLists500()
  vi.mocked(priorCatalogCopies).mockResolvedValue([copy('2026-03-05T00:00:00.000Z', 'Something else')])

  expect(await main(['scrape'], opts)).toBe(0)

  const card = await pendingCard(`${stored.slug}-discontinued`)
  expect(card).toMatchObject({ kind: 'spec-change', path: 'discontinued' })
  const after = card.after as { lastListed?: string; source: Record<string, unknown> }
  expect(after.lastListed).toBeUndefined()
  expect(after.source).toMatchObject({ value: 'Select 300', quote: 'Hearing aids',
    fetchedAt: '2026-11-27T09:00:00.000Z',
    sourceUrl: BASE,
    sourceType: 'derived',
    derivation: { op: 'absent-from-catalog', input: `${BASE} on 2026-11-27` },
  })
})

test('an earlier logged copy of the model\'s own page that names it gives a dateless discontinuation sourced to that page', async () => {
  const stored = await storeSelect300()
  catalogLists500()
  vi.mocked(priorCatalogCopies).mockImplementation(async (urls) =>
    urls[0] === `${BASE}/x` ? [{ ...okPage(`${BASE}/x`), text: 'Jabra Enhance Select 300 hearing aid' }] : [],
  )

  expect(await main(['scrape'], opts)).toBe(0)

  const after = (await pendingCard(`${stored.slug}-discontinued`)).after as { lastListed?: string; source: { sourceUrl: string; sourceType: string } }
  expect(after.lastListed).toBeUndefined()
  expect(after.source).toMatchObject({ sourceUrl: `${BASE}/x`, sourceType: 'official' })
})

test('a skipped catalog page, a limit, a lost model page, or no model links at all proposes no discontinuation', async () => {
  await storeSelect300()
  vi.mocked(priorCatalogCopies).mockResolvedValue([copy('2026-03-05T00:00:00.000Z', 'Jabra Enhance Select 300')])
  const pendingPaths = async () => (await filesUnder(join(dataDir, 'pending'))).filter((f) => f.includes('discontinued'))
  catalogLists500()

  // A catalog page that was skipped.
  vi.mocked(discoverModelUrls).mockImplementation(async (_brand, o) => {
    o?.onSkip?.(BASE, 'bot-protection', 'HTTP 403')
    return [LISTED]
  })
  expect(await main(['scrape'], opts)).toBe(0)
  expect(log).toContain('jabra-enhance: catalog incomplete, lifecycle not checked')
  expect(await pendingPaths()).toEqual([])

  // A model page that was skipped.
  vi.mocked(discoverModelUrls).mockResolvedValue([LISTED, { ...LISTED, modelUrl: `${BASE}/select-600` }])
  vi.mocked(fetchPage).mockImplementation(async (url) =>
    url.endsWith('select-600') ? { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 500' } : okPage(url),
  )
  vi.mocked(extractModel).mockImplementation(async () => candidate('Select 500'))
  expect(await main(['scrape'], opts)).toBe(0)
  expect(await pendingPaths()).toEqual([])

  // A run under --limit.
  vi.mocked(fetchPage).mockImplementation(async (url) => okPage(url))
  expect(await main(['scrape', '--limit', '5'], opts)).toBe(0)
  expect(await pendingPaths()).toEqual([])

  // A catalog that links no model at all (a changed page layout).
  vi.mocked(discoverModelUrls).mockResolvedValue([])
  expect(await main(['scrape'], opts)).toBe(0)
  expect(await pendingPaths()).toEqual([])

  // Support pages only.
  vi.mocked(discoverModelUrls).mockResolvedValue([{ ...LISTED, inCatalog: false }])
  expect(await main(['scrape'], opts)).toBe(0)
  expect(await pendingPaths()).toEqual([])
})

test('a stored model that cites a model page of the catalog is still listed', async () => {
  const stored = await storeSelect300()
  vi.mocked(priorCatalogCopies).mockResolvedValue([copy('2026-03-05T00:00:00.000Z', 'Jabra Enhance Select 300')])
  vi.mocked(discoverModelUrls).mockResolvedValue([{ ...LISTED, modelUrl: `${BASE}/x` }])
  vi.mocked(extractModel).mockResolvedValue(candidate('Select 500'))

  expect(await main(['scrape'], opts)).toBe(0)

  expect(await filesUnder(join(dataDir, 'pending'))).not.toContain(`${stored.slug}-discontinued.json`)
})

test('a live product page outside the catalog is flagged orphan-product-page', async () => {
  const stored = await storeSelect300()
  catalogLists500()
  vi.mocked(fetchPage).mockImplementation(async (url) => ({ ...okPage(url), text: url === `${BASE}/x` ? 'Jabra Enhance Select 300 hearing aid' : 'page' }))

  expect(await main(['scrape'], opts)).toBe(0)

  const card = await pendingCard(`${stored.slug}-discontinued`)
  expect(card.kind).toBe('failed-check')
  expect(card.checks.discontinued).toEqual([{ name: 'lifecycle', ok: false, detail: 'orphan-product-page' }])
  expect(vi.mocked(fetchPage)).toHaveBeenCalledWith(`${BASE}/x`, { render: false, refresh: true })
})

test('an own page that answers 404 or 410 is gone: a plain discontinuation', async () => {
  const stored = await storeSelect300()
  catalogLists500()
  for (const code of ['HTTP 404', 'HTTP 410']) {
    await rm(join(dataDir, 'pending'), { recursive: true, force: true })
    vi.mocked(fetchPage).mockImplementation(async (url) =>
      url === `${BASE}/x` ? { status: 'skipped', url, reason: 'http-error', detail: code } : okPage(url),
    )
    expect(await main(['scrape'], opts)).toBe(0)
    expect((await pendingCard(`${stored.slug}-discontinued`)).kind).toBe('spec-change')
  }
})

test('an own page that fails for any other reason leaves the model unchecked this run', async () => {
  const stored = await storeSelect300()
  catalogLists500()
  const failures = [
    { reason: 'http-error', detail: 'HTTP 502' },
    { reason: 'http-error', detail: 'request failed: ETIMEDOUT' },
    { reason: 'rate-limited', detail: 'HTTP 429' },
    { reason: 'bot-protection', detail: 'HTTP 403' },
  ] as const
  for (const failure of failures) {
    vi.mocked(fetchPage).mockImplementation(async (url) => (url === `${BASE}/x` ? { status: 'skipped', url, ...failure } : okPage(url)))
    expect(await main(['scrape'], opts)).toBe(0)
    expect(await filesUnder(join(dataDir, 'pending'))).not.toContain(`${stored.slug}-discontinued.json`)
  }
  expect(log).toContain(`${stored.slug}: own page not read, lifecycle not checked`)
})

test('an own page that redirects to an address the catalog links is a listed model; a slash variant of the same page is still an orphan', async () => {
  const stored = await storeSelect300()
  catalogLists500()
  vi.mocked(fetchPage).mockImplementation(async (url) =>
    url === `${BASE}/x` ? { ...okPage(`${BASE}/select-500/`), text: 'Jabra Enhance Select 300' } : okPage(url),
  )
  expect(await main(['scrape'], opts)).toBe(0)
  expect(await filesUnder(join(dataDir, 'pending'))).not.toContain(`${stored.slug}-discontinued.json`)

  // A retired page that redirects to the catalog itself hides nothing: the model is proposed.
  vi.mocked(fetchPage).mockImplementation(async (url) =>
    url === `${BASE}/x` ? { ...okPage(BASE), text: 'Hearing aids' } : okPage(url),
  )
  await rm(join(dataDir, 'pending'), { recursive: true, force: true })
  expect(await main(['scrape'], opts)).toBe(0)
  expect((await pendingCard(`${stored.slug}-discontinued`)).kind).toBe('spec-change')

  vi.mocked(fetchPage).mockImplementation(async (url) =>
    url === `${BASE}/x` ? { ...okPage(`${BASE}/x/`), text: 'Jabra Enhance Select 300' } : okPage(url),
  )
  expect(await main(['scrape'], opts)).toBe(0)
  expect((await pendingCard(`${stored.slug}-discontinued`)).kind).toBe('failed-check')
})

test('a catalog page that gives no model link makes the catalog incomplete', async () => {
  await storeSelect300()
  vi.mocked(priorCatalogCopies).mockResolvedValue([copy('2026-03-05T00:00:00.000Z', 'Jabra Enhance Select 300')])
  vi.mocked(extractModel).mockResolvedValue(candidate('Select 500'))
  vi.mocked(discoverModelUrls).mockImplementation(async (_brand, o) => {
    o?.onEmpty?.(BASE)
    return [LISTED]
  })

  expect(await main(['scrape'], opts)).toBe(0)

  expect(log).toContain('jabra-enhance: catalog incomplete, lifecycle not checked')
  expect((await filesUnder(join(dataDir, 'pending'))).filter((f) => f.includes('discontinued'))).toEqual([])
})

test('a discontinued model back in the catalog gets its discontinuation removed through review', async () => {
  const stored = await storeSelect300({ discontinued: { lastListed: '2025-01', source: SOURCE } })
  vi.mocked(discoverModelUrls).mockResolvedValue([LISTED])
  vi.mocked(extractModel).mockResolvedValue(candidate('Select 300'))

  expect(await main(['scrape'], opts)).toBe(0)

  const card = await pendingCard(`${stored.slug}-discontinued`)
  expect(card).toMatchObject({ kind: 'spec-change', path: 'discontinued', after: null })
  expect(card.before).toMatchObject({ lastListed: '2025-01' })
  expect(JSON.parse(await readFile(join(dataDir, 'models', `${stored.slug}.json`), 'utf8')).discontinued).toBeDefined()
})

test('a model already discontinued that the catalog still lacks gets no new proposal', async () => {
  const stored = await storeSelect300({ discontinued: { lastListed: '2025-01', source: SOURCE } })
  catalogLists500()
  vi.mocked(priorCatalogCopies).mockResolvedValue([copy('2026-03-05T00:00:00.000Z', 'Jabra Enhance Select 300')])

  expect(await main(['scrape'], opts)).toBe(0)

  expect(await filesUnder(join(dataDir, 'pending'))).not.toContain(`${stored.slug}-discontinued.json`)
})

test('a support-only model without an official date since 2018 is left out; one with a date is left to the archive command', async () => {
  vi.mocked(discoverModelUrls).mockResolvedValue([LISTED, { ...LISTED, modelUrl: `${BASE}/old`, inCatalog: false }, { ...LISTED, modelUrl: `${BASE}/new`, inCatalog: false }])
  const dated = (name: string, value: string) =>
    candidate(name).model.releaseDate === undefined
      ? Model.parse({ ...candidate(name).model, releaseDate: { value, quote: value, sourceUrl: `${BASE}/new`, fetchedAt: FETCHED_AT, sourceType: 'official' } })
      : candidate(name).model
  vi.mocked(extractModel)
    .mockResolvedValueOnce(candidate('Select 500'))
    .mockResolvedValueOnce(candidate('Select 100'))
    .mockResolvedValueOnce({ model: dated('Select 200', '2025-02'), fieldChecks: {} })

  expect(await main(['scrape'], opts)).toBe(0)

  expect(await filesUnder(join(dataDir, 'pending'))).toEqual(['jabra-enhance-select-500-model.json'])
  expect(log).toContain('jabra-enhance-select-100: not sold since 2018 by its sources, left out')
  expect(log).toContain('jabra-enhance-select-200: found only on support pages, left to the archive command')
})
