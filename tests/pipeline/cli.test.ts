// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { priorCatalogCopies } from '@/pipeline/archive/catalog-history'
import { archiveCandidates } from '@/pipeline/archive/wayback-models'
import { crossCheck } from '@/pipeline/checks/crosscheck'
import { planChange } from '@/pipeline/apply'
import { main } from '@/pipeline/cli'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { llm, LlmLimitError, LlmOutputError } from '@/pipeline/llm'
import { discoverModelUrls, extractModel, type ModelCandidate } from '@/pipeline/sources/brand-site'
import { latestCopy, WaybackError } from '@/pipeline/sources/wayback'
import { fetchIosVersion, lookupApp } from '@/pipeline/sources/itunes'
import { fetchClearances, fetchFdaEvents, type Clearance510k } from '@/pipeline/sources/openfda'
import { readBody, readLog } from '@/pipeline/fetch/raw-store'
import { complaintThemes, discoverReviewSources, extractRetailReviews } from '@/pipeline/sources/reviews'
import { discoverThirdPartyFacts } from '@/pipeline/sources/third-party-facts'
import { analyzeVideo, searchVideos, YouTubeError } from '@/pipeline/sources/youtube'
import { synthesizeProsCons } from '@/pipeline/sources/pros-cons'
import { loadDataset } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'
import { Model } from '@/src/lib/schema/model'
import { PendingChange } from '@/src/lib/schema/pending'
import { Reviews } from '@/src/lib/schema/reviews'

vi.mock('@/pipeline/archive/catalog-history', () => ({ priorCatalogCopies: vi.fn() }))
vi.mock('@/pipeline/archive/wayback-models', () => ({ archiveCandidates: vi.fn() }))
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
vi.mock('@/pipeline/sources/wayback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/sources/wayback')>()),
  latestCopy: vi.fn(),
}))
vi.mock('@/pipeline/sources/openfda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/sources/openfda')>()),
  fetchFdaEvents: vi.fn(),
  fetchClearances: vi.fn(),
}))
vi.mock('@/pipeline/fetch/raw-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/fetch/raw-store')>()),
  readLog: vi.fn(),
  readBody: vi.fn(),
}))
vi.mock('@/pipeline/sources/itunes', () => ({ fetchIosVersion: vi.fn(), lookupApp: vi.fn() }))
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
  vi.mocked(fetchClearances).mockResolvedValue([])
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

describe('scrape: predecessor, successor and app links', () => {
  const SOURCE = {
    value: 'Select 200',
    quote: 'Select 300 is the successor to Select 200.',
    sourceUrl: `${BASE}/select-300`,
    fetchedAt: FETCHED_AT,
    sourceType: 'official' as const,
  }
  const record = (iosId: string) => ({ iosId, name: 'Jabra Enhance Pro', seller: 'GN', url: `https://apps.apple.com/app/id${iosId}`, lookupUrl: 'https://itunes.apple.com/lookup', fetchedAt: FETCHED_AT })
  const pendingFile = async (id: string) => PendingChange.parse(JSON.parse(await readFile(join(dataDir, 'pending', `${id}.json`), 'utf8')))

  async function scrapeWith(extra: Partial<ModelCandidate>, stored: Model[] = [model('Select 200'), model('Select 300')]) {
    for (const m of stored) await writeJson(join(dataDir, 'models', `${m.slug}.json`), m)
    vi.mocked(discoverModelUrls).mockResolvedValue([{ modelUrl: `${BASE}/select-300`, documentUrls: [], inCatalog: true }])
    vi.mocked(extractModel).mockResolvedValue({ ...candidate('Select 300'), ...extra })
    return main(['scrape', '--limit', '5'], opts)
  }

  test('a predecessor named by a checked quote and stored gives a pending spec-change with the source', async () => {
    expect(await scrapeWith({ lineage: { predecessor: { name: 'Select 200', source: SOURCE } } })).toBe(0)

    const card = await pendingFile('jabra-enhance-select-300-predecessor')
    expect(card).toMatchObject({ kind: 'spec-change', modelSlug: 'jabra-enhance-select-300', path: 'predecessor', after: { slug: 'jabra-enhance-select-200', source: SOURCE } })
  })

  test('a name that is no stored model, or the model itself, gives no proposal', async () => {
    await scrapeWith({ lineage: { predecessor: { name: 'Select 50', source: SOURCE }, successor: { name: 'Select 300', source: SOURCE } } })

    expect(await filesUnder(join(dataDir, 'pending'))).toEqual([])
    expect(log).toContain('jabra-enhance-select-300: predecessor "Select 50" is no stored model, left out')
  })

  test('a link the other model already holds differently is not proposed', async () => {
    const other = model('Select 200', { successor: { slug: 'jabra-enhance-select-400', source: SOURCE } })
    await scrapeWith({ lineage: { predecessor: { name: 'Select 200', source: SOURCE } } }, [other, model('Select 300'), model('Select 400')])
    expect(await filesUnder(join(dataDir, 'pending'))).toEqual([])
  })

  test('one App Store id gives an app proposal named by the lookup, with the Play link', async () => {
    vi.mocked(lookupApp).mockResolvedValue(record('1234567890'))

    await scrapeWith({ appIds: { ios: ['1234567890'], android: ['com.jabra.enhance'] } })

    expect(lookupApp).toHaveBeenCalledTimes(1)
    const card = await pendingFile('jabra-enhance-select-300-app')
    expect(card).toMatchObject({
      path: 'app',
      after: { name: 'Jabra Enhance Pro', iosId: '1234567890', androidUrl: 'https://play.google.com/store/apps/details?id=com.jabra.enhance' },
    })
  })

  test('two App Store ids, the stored id, or a removed app give no proposal and no lookup is made for the first two', async () => {
    await scrapeWith({ appIds: { ios: ['1', '2'], android: [] } })
    expect(lookupApp).not.toHaveBeenCalled()
    await scrapeWith({ appIds: { ios: ['7'], android: [] } }, [model('Select 200'), model('Select 300', { app: { name: 'App', iosId: '7' } })])
    expect(lookupApp).not.toHaveBeenCalled()
    vi.mocked(lookupApp).mockResolvedValue('removed')
    await scrapeWith({ appIds: { ios: ['8'], android: [] } })
    expect(await filesUnder(join(dataDir, 'pending'))).toEqual([])
  })

  test('a skipped iTunes lookup stops the brand unit, so a resumed run asks again; it never means no app', async () => {
    vi.mocked(lookupApp).mockResolvedValueOnce(null)

    expect(await scrapeWith({ appIds: { ios: ['1234567890'], android: [] } })).toBe(0)
    expect(log.some((line) => line.includes('an iTunes lookup was skipped'))).toBe(true)
    expect(log.at(-1)).toBe('Summary: auto 0, pending 0, dropped 0, skipped sources 0, failed 1')
    expect(await filesUnder(join(dataDir, 'pending'))).toEqual([])

    vi.mocked(lookupApp).mockResolvedValue(record('1234567890'))
    expect(await main(['scrape', '--limit', '5', '--resume'], opts)).toBe(0)
    expect(await filesUnder(join(dataDir, 'pending'))).toEqual(['jabra-enhance-select-300-app.json'])
  })
})

describe('scrape: documents', () => {
  const GUIDE = `${BASE}/docs/select-300-user-guide.pdf`
  const OTHER = `${BASE}/docs/select-100-user-guide.pdf`
  const pdfPage = (url: string, text: string): FetchResult => ({ ...okPage(url), text, contentType: 'application/pdf' })
  const pendingFile = async (id: string) => PendingChange.parse(JSON.parse(await readFile(join(dataDir, 'pending', `${id}.json`), 'utf8')))

  async function scrapeDocuments(stored: Model[]) {
    await writeJson(join(dataDir, 'brands', 'jabra-enhance.json'), { ...brand, scraper: { ...brand.scraper, documentUrlPattern: '\\.pdf$' } })
    for (const m of stored) await writeJson(join(dataDir, 'models', `${m.slug}.json`), m)
    vi.mocked(discoverModelUrls).mockResolvedValue([{ modelUrl: `${BASE}/select-300`, documentUrls: [GUIDE, OTHER], inCatalog: true }])
    vi.mocked(extractModel).mockResolvedValue(candidate('Select 300'))
    vi.mocked(fetchPage).mockImplementation(async (url) =>
      url === GUIDE
        ? pdfPage(url, 'Jabra Enhance Select 300 user guide')
        : url === OTHER
          ? pdfPage(url, 'Jabra Enhance Select 100 user guide')
          : okPage(url),
    )
    return main(['scrape', '--limit', '5'], opts)
  }

  test('a new model carries its documents with their checks, one that does not name it with a failed check', async () => {
    expect(await scrapeDocuments([])).toBe(0)

    const card = await pendingFile('jabra-enhance-select-300-model')
    expect((card.after as Model).documents.map((d) => [d.kind, d.url])).toEqual([
      ['user-guide', GUIDE],
      ['user-guide', OTHER],
    ])
    expect(card.checks['documents.0'].every((c) => c.ok)).toBe(true)
    expect(card.checks['documents.0']).toHaveLength(3)
    expect(card.checks['documents.1'].find((c) => !c.ok)?.detail).toBe('the document does not name the model')
  })

  test('a stored model gets a document change per new document: applied when its three checks pass, queued when one fails', async () => {
    expect(await scrapeDocuments([model('Select 300')])).toBe(0)

    const stored = Model.parse(JSON.parse(await readFile(join(dataDir, 'models', 'jabra-enhance-select-300.json'), 'utf8')))
    expect(stored.documents.map((d) => d.url)).toEqual([GUIDE])
    const card = await pendingFile('jabra-enhance-select-300-documents-1')
    expect(card).toMatchObject({ path: 'documents.1', after: { url: OTHER } })
  })

  test('a document that cannot be fetched is left out', async () => {
    await scrapeDocuments([])
    vi.mocked(fetchPage).mockImplementation(async (url) => ([GUIDE, OTHER].includes(url) ? { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' } : okPage(url)))
    await rm(join(dataDir, 'pending'), { recursive: true, force: true })
    await main(['scrape', '--limit', '5'], opts)
    const card = await pendingFile('jabra-enhance-select-300-model')
    expect((card.after as Model).documents).toEqual([])
  })
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

describe('archive', () => {
  const SUPPORT = `${BASE}/support`
  const SUPPORT_MODEL = `${SUPPORT}/select-200`
  const pending = async (id: string) => PendingChange.parse(JSON.parse(await readFile(join(dataDir, 'pending', `${id}.json`), 'utf8')))
  const withSupport = { ...brand, scraper: { ...brand.scraper, supportUrls: [SUPPORT], documentUrlPattern: '\\.pdf$' } }
  const dated = (name: string, value = '2025-02'): ModelCandidate => ({
    model: Model.parse({ ...candidate(name).model, releaseDate: { value, quote: value, sourceUrl: SUPPORT_MODEL, fetchedAt: FETCHED_AT, sourceType: 'official' } }),
    fieldChecks: {},
  })
  const pdfPage = (url: string, text: string): FetchResult => ({ ...okPage(url), text, contentType: 'application/pdf' })

  /** Support pages that link one model page; the page names the model on its first line. */
  function supportLinks(urls: string[] = [SUPPORT_MODEL], documentUrls: string[] = []) {
    vi.mocked(discoverModelUrls).mockResolvedValue(urls.map((modelUrl) => ({ modelUrl, documentUrls, inCatalog: false })))
    vi.mocked(fetchPage).mockImplementation(async (url) => (/\.pdf/.test(url) ? pdfPage(url, 'Jabra Enhance Select 200 user guide') : { ...okPage(url), text: 'Jabra Enhance Select 200 support' }))
  }
  beforeEach(async () => {
    await writeJson(join(dataDir, 'brands', 'jabra-enhance.json'), withSupport)
  })

  test('archive is its own command and not part of update', async () => {
    const stored = model('Select 300', { documents: [{ kind: 'user-guide', title: 'Guide', url: `${BASE}/docs/g.pdf`, fetchedAt: FETCHED_AT }] })
    await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
    vi.mocked(discoverModelUrls).mockResolvedValue([])
    await main(['update'], opts)
    expect(latestCopy).not.toHaveBeenCalled()
    expect(await filesUnder(join(dir, 'cache', 'progress'))).not.toContain('archive.json')
  })

  test('a support-only model with an official 2018+ date becomes a dateless discontinued card, origin archive, no event', async () => {
    supportLinks()
    vi.mocked(extractModel).mockResolvedValue(dated('Select 200'))
    expect(await main(['archive'], opts)).toBe(0)

    const card = await pending('jabra-enhance-select-200-model')
    expect(card.kind).toBe('new-model')
    expect(card.origin).toBe('archive')
    expect(card.after).toMatchObject({ discontinued: { source: { sourceUrl: SUPPORT_MODEL, quote: 'Jabra Enhance Select 200 support' } } })
    expect((card.after as Model).discontinued?.lastListed).toBeUndefined()
    expect(card.checks.discontinued).toBeUndefined() // a support page is no live product page
    // Approving it writes the model and no feed event.
    const plan = planChange({ kind: card.kind as 'new-model', modelSlug: card.modelSlug, path: card.path, after: card.after, origin: card.origin }, await loadDataset(dataDir))
    expect(plan.events).toEqual([])
    expect(plan.writes.map((w) => w.path)).toEqual(['models/jabra-enhance-select-200.json'])
    expect(vi.mocked(discoverModelUrls).mock.calls[0][0].scraper.catalogUrls).toEqual([BASE]) // the live catalog is asked too
  })

  test('a support-linked model that the live catalog links too is left to update, and never replaces its pending card', async () => {
    vi.mocked(discoverModelUrls).mockResolvedValue([
      { modelUrl: `${BASE}/select-200`, documentUrls: [], inCatalog: true },
      { modelUrl: SUPPORT_MODEL, documentUrls: [], inCatalog: false },
    ])
    vi.mocked(fetchPage).mockImplementation(async (url) => ({ ...okPage(url), text: 'Jabra Enhance Select 200 support' }))
    vi.mocked(extractModel).mockResolvedValue(dated('Select 200'))
    await writeJson(join(dataDir, 'pending', 'jabra-enhance-select-200-model.json'), {
      id: 'jabra-enhance-select-200-model', kind: 'new-model', modelSlug: 'jabra-enhance-select-200', path: '', after: dated('Select 200').model, checks: {}, createdAt: FETCHED_AT,
    })
    await main(['archive'], opts)
    expect(vi.mocked(extractModel)).toHaveBeenCalledTimes(1) // the catalog-linked page is not read
    expect((await pending('jabra-enhance-select-200-model')).origin).toBeUndefined() // update's card stays
    expect(log.join('\n')).toContain('already queued by another command')
    expect(log).toContain(`${BASE}/select-200: in the live catalog, left to update`)
  })

  test('a catalog page that was not read leaves new models unproposed', async () => {
    supportLinks()
    vi.mocked(discoverModelUrls).mockImplementation(async (_b, o) => {
      o?.onSkip?.(BASE, 'http-error', 'HTTP 500')
      return [{ modelUrl: SUPPORT_MODEL, documentUrls: [], inCatalog: false }]
    })
    vi.mocked(extractModel).mockResolvedValue(dated('Select 200'))
    await main(['archive'], opts)
    expect(await filesUnder(join(dataDir, 'pending'))).toEqual([])
    expect(log).toContain('jabra-enhance-select-200: the live catalog was not read whole, not proposed')
  })

  test('a model without an official 2018+ date is left out', async () => {
    supportLinks()
    vi.mocked(extractModel).mockResolvedValue(dated('Select 200', '2016-05'))
    await main(['archive'], opts)
    expect(await filesUnder(join(dataDir, 'pending'))).toEqual([])
    expect(log).toContain('jabra-enhance-select-200: no official release date since 2018, left out')
  })

  test('a model page of the brand outside its support pages is a live product page: orphan-product-page, for review', async () => {
    const product = `${BASE}/select-200`
    supportLinks([product])
    vi.mocked(extractModel).mockResolvedValue(dated('Select 200'))
    await main(['archive'], opts)
    expect((await pending('jabra-enhance-select-200-model')).checks.discontinued).toEqual([{ name: 'lifecycle', ok: false, detail: 'orphan-product-page' }])
  })

  test('the orphan check reads the product page fresh: a cached-live page that now answers 404 is not an orphan, a www-less host still counts', async () => {
    const product = `${BASE}/select-200`
    supportLinks([product])
    vi.mocked(extractModel).mockResolvedValue(dated('Select 200'))
    vi.mocked(fetchPage).mockImplementation(async (url, o) =>
      url === product && o?.refresh ? { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' } : { ...okPage(url), text: 'Jabra Enhance Select 200 page' },
    )
    await main(['archive'], opts)
    expect((await pending('jabra-enhance-select-200-model')).checks.discontinued).toBeUndefined()
    expect(vi.mocked(fetchPage)).toHaveBeenCalledWith(product, expect.objectContaining({ refresh: true }))

    await rm(join(dataDir, 'pending'), { recursive: true, force: true })
    vi.mocked(fetchPage).mockImplementation(async (url, o) =>
      o?.refresh ? { ...okPage(url.replace('www.', '')), text: 'Jabra Enhance Select 200 page' } : { ...okPage(url), text: 'Jabra Enhance Select 200 page' },
    )
    await main(['archive'], opts)
    expect((await pending('jabra-enhance-select-200-model')).checks.discontinued).toEqual([{ name: 'lifecycle', ok: false, detail: 'orphan-product-page' }])
  })

  test('a product page that cannot be read (a refusal) leaves the model undecided', async () => {
    const product = `${BASE}/select-200`
    supportLinks([product])
    vi.mocked(extractModel).mockResolvedValue(dated('Select 200'))
    vi.mocked(fetchPage).mockImplementation(async (url, o) => (o?.refresh ? { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 503' } : { ...okPage(url), text: 'Jabra Enhance Select 200 page' }))
    await main(['archive'], opts)
    expect(await filesUnder(join(dataDir, 'pending'))).toEqual([])
    expect(log).toContain('jabra-enhance-select-200: its product page was not read, lifecycle not decided')
  })

  test('a model that matches a stored one only adds its documents (all with origin archive)', async () => {
    const GUIDE = `${BASE}/docs/select-200-user-guide.pdf`
    const stored = model('Select 200')
    await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
    supportLinks([SUPPORT_MODEL], [GUIDE])
    vi.mocked(extractModel).mockResolvedValue(dated('Select 200'))
    expect(await main(['archive'], opts)).toBe(0)

    expect(await filesUnder(join(dataDir, 'pending'))).toEqual([])
    const after = Model.parse(JSON.parse(await readFile(join(dataDir, 'models', `${stored.slug}.json`), 'utf8')))
    expect(after.documents.map((d) => d.url)).toEqual([GUIDE])
    expect(after.releaseDate).toBeUndefined()
    expect(after.discontinued).toBeUndefined()
  })

  describe('documents', () => {
    const DEAD = `${BASE}/docs/select-300-user-guide.pdf`
    const COPY = 'https://web.archive.org/web/20200101000000/' + DEAD
    const withDead = async () => {
      const stored = model('Select 300', { documents: [{ kind: 'user-guide', title: 'Guide', url: DEAD, fetchedAt: FETCHED_AT }] })
      await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
      vi.mocked(discoverModelUrls).mockResolvedValue([])
      return stored
    }
    const storedUrls = async (slug: string) => Model.parse(JSON.parse(await readFile(join(dataDir, 'models', `${slug}.json`), 'utf8'))).documents.map((d) => d.url)

    test('a dead document is replaced by its archive copy once the three checks pass', async () => {
      const stored = await withDead()
      vi.mocked(fetchPage).mockImplementation(async (url) =>
        url === DEAD ? { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' } : url.includes('id_') ? pdfPage(url, 'Jabra Enhance Select 300 user guide') : okPage(url),
      )
      vi.mocked(latestCopy).mockResolvedValue({ timestamp: '20200101000000', original: DEAD, statusCode: '200', mimeType: 'application/pdf', digest: 'd' })
      expect(await main(['archive'], opts)).toBe(0)
      expect(await storedUrls(stored.slug)).toEqual([COPY])
    })

    test('a copy that does not name the model is queued by no one: nothing changes', async () => {
      const stored = await withDead()
      vi.mocked(fetchPage).mockImplementation(async (url) =>
        url === DEAD ? { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' } : url.includes('id_') ? pdfPage(url, 'Something else') : okPage(url),
      )
      vi.mocked(latestCopy).mockResolvedValue({ timestamp: '20200101000000', original: DEAD, statusCode: '200', mimeType: 'application/pdf', digest: 'd' })
      await main(['archive'], opts)
      expect(await storedUrls(stored.slug)).toEqual([DEAD])
    })

    test('a gone brand\'s live documents are never fetched', async () => {
      await writeJson(join(dataDir, 'brands', 'jabra-enhance.json'), { ...withSupport, status: 'gone' })
      await withDead()
      await main(['archive'], opts)
      expect(fetchPage).not.toHaveBeenCalled()
      expect(latestCopy).not.toHaveBeenCalled()
    })

    test('an archive-excluded answer means no archive data for the brand, and the run goes on', async () => {
      await withDead()
      vi.mocked(fetchPage).mockImplementation(async (url) => (url === DEAD ? { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' } : okPage(url)))
      vi.mocked(latestCopy).mockRejectedValue(new WaybackError('archive-excluded', 'HTTP 403'))
      expect(await main(['archive'], opts)).toBe(0)
      expect(log.join('\n')).toContain('web.archive.org does not serve this site, documents not replaced')
    })
  })

  test('a 429 from web.archive.org stops the command with a resume hint; --resume skips finished units', async () => {
    await writeJson(join(dataDir, 'brands', 'audien.json'), { ...withSupport, slug: 'audien', name: 'Audien', website: 'https://audien.com' })
    const dead = `${BASE}/docs/g.pdf`
    const stored = model('Select 300', { documents: [{ kind: 'user-guide', title: 'G', url: dead, fetchedAt: FETCHED_AT }] })
    await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
    vi.mocked(discoverModelUrls).mockResolvedValue([])
    vi.mocked(fetchPage).mockImplementation(async (url) => (url === dead ? { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' } : okPage(url)))
    vi.mocked(latestCopy).mockRejectedValue(new WaybackError('rate-limited', 'HTTP 429'))

    // Audien (no models) is finished first; Jabra Enhance's archive copy is refused.
    expect(await main(['archive'], opts)).toBe(2)
    expect(log).toContain('web.archive.org refused requests. Resume later: npm run archive -- --resume')
    expect(JSON.parse(await readFile(join(dir, 'cache', 'progress', 'archive.json'), 'utf8')).done).toContain('brand=* limit=* archive-documents:audien')

    vi.mocked(discoverModelUrls).mockClear()
    vi.mocked(latestCopy).mockClear()
    vi.mocked(latestCopy).mockResolvedValue(null)
    expect(await main(['archive', '--resume'], opts)).toBe(0)
    // Both support units were done; only Jabra Enhance's documents are read again (Audien has no model).
    expect(vi.mocked(discoverModelUrls)).not.toHaveBeenCalled()
    expect(vi.mocked(latestCopy)).toHaveBeenCalledTimes(1)
  })

  test('a refusal by a brand\'s own site stops only that brand: the others go on, exit 2; --resume lists it again and keeps progress; --brand retries with its own progress file', async () => {
    await writeJson(join(dataDir, 'brands', 'audien.json'), { ...withSupport, slug: 'audien', name: 'Audien', website: 'https://audien.com', scraper: { ...withSupport.scraper, supportUrls: ['https://audien.com/support'] } })
    vi.mocked(discoverModelUrls).mockImplementation(async (b, o) => {
      if (b.slug === 'audien') {
        o?.onSkip?.('https://audien.com/support', 'bot-protection', 'HTTP 403')
        return []
      }
      return [{ modelUrl: SUPPORT_MODEL, documentUrls: [], inCatalog: false }]
    })
    vi.mocked(fetchPage).mockImplementation(async (url) => ({ ...okPage(url), text: 'Jabra Enhance Select 200 support' }))
    vi.mocked(extractModel).mockResolvedValue(dated('Select 200'))
    const full = join(dir, 'cache', 'progress', 'archive.json')

    expect(await main(['archive'], opts)).toBe(2)
    expect(await filesUnder(join(dataDir, 'pending'))).toEqual(['jabra-enhance-select-200-model.json']) // the next brand went on
    expect(log.join('\n')).toContain('Refused by their own sites: audien.')

    vi.mocked(discoverModelUrls).mockClear()
    expect(await main(['archive', '--resume'], opts)).toBe(2) // still listed, progress kept
    expect(vi.mocked(discoverModelUrls)).not.toHaveBeenCalled() // audien refused earlier, jabra-enhance done
    expect(log).toContain('audien: refused earlier, skipped (retry it with --brand audien)')
    const record = await readFile(full, 'utf8')
    expect(JSON.parse(record).done).toContain('brand=* limit=* archive-refused:audien')

    expect(await main(['archive', '--brand', 'audien'], opts)).toBe(2) // retried, refused again
    expect(vi.mocked(discoverModelUrls)).toHaveBeenCalledTimes(1)
    expect(await readFile(full, 'utf8')).toBe(record) // the full run's record survives
    expect(await filesUnder(join(dir, 'cache', 'progress'))).toContain('archive-audien.json')

    // The site answers now: the retry finishes and the full run stops skipping the brand.
    vi.mocked(discoverModelUrls).mockImplementation(async () => [])
    expect(await main(['archive', '--brand', 'audien'], opts)).toBe(0)
    expect(JSON.parse(await readFile(full, 'utf8')).done).not.toContain('brand=* limit=* archive-refused:audien')
  })

  describe('documents: refusals', () => {
    const DEAD = `${BASE}/docs/g.pdf`
    const store = async () => {
      const stored = model('Select 300', { documents: [{ kind: 'user-guide', title: 'G', url: DEAD, fetchedAt: FETCHED_AT }] })
      await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
      vi.mocked(discoverModelUrls).mockResolvedValue([])
      vi.mocked(latestCopy).mockResolvedValue({ timestamp: '20200101000000', original: DEAD, statusCode: '200', mimeType: 'application/pdf', digest: 'd' })
      return stored
    }
    const dead = (url: string): FetchResult => ({ status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' })

    test('a refusal of a live document by the brand site stops that brand and records it refused', async () => {
      await store()
      vi.mocked(fetchPage).mockImplementation(async (url) => ({ status: 'skipped', url, reason: 'rate-limited', detail: 'HTTP 429' }))
      expect(await main(['archive'], opts)).toBe(2)
      expect(log.join('\n')).toContain('Refused by their own sites: jabra-enhance.')
      expect(latestCopy).not.toHaveBeenCalled()
    })

    test('a 429 on the archived PDF stops the whole command like a CDX refusal', async () => {
      await store()
      vi.mocked(fetchPage).mockImplementation(async (url) => (url === DEAD ? dead(url) : { status: 'skipped', url, reason: 'rate-limited', detail: 'HTTP 429' }))
      expect(await main(['archive'], opts)).toBe(2)
      expect(log).toContain('web.archive.org refused requests. Resume later: npm run archive -- --resume')
    })

    test('an empty 403 on the archived PDF skips that document and the run goes on', async () => {
      const stored = await store()
      vi.mocked(fetchPage).mockImplementation(async (url) => (url === DEAD ? dead(url) : { status: 'skipped', url, reason: 'archive-excluded', detail: 'HTTP 403' }))
      expect(await main(['archive'], opts)).toBe(0)
      expect(log.join('\n')).toContain('archive-excluded')
      expect(Model.parse(JSON.parse(await readFile(join(dataDir, 'models', `${stored.slug}.json`), 'utf8'))).documents.map((d) => d.url)).toEqual([DEAD])
    })

    test('one model that fails does not stop the others of the brand', async () => {
      await store()
      const other = model('Select 100', { documents: [{ kind: 'user-guide', title: 'G', url: `${BASE}/docs/h.pdf`, fetchedAt: FETCHED_AT }] })
      await writeJson(join(dataDir, 'models', `${other.slug}.json`), other)
      vi.mocked(fetchPage).mockImplementation(async (url) => dead(url))
      vi.mocked(latestCopy).mockRejectedValueOnce(new WaybackError('http-error', 'HTTP 500')).mockResolvedValue(null)
      expect(await main(['archive'], opts)).toBe(0)
      expect(vi.mocked(latestCopy)).toHaveBeenCalledTimes(2)
      expect(log.at(-1)).toContain('failed 1')
    })
  })

  test('--brand and --limit narrow the run', async () => {
    await writeJson(join(dataDir, 'brands', 'audien.json'), { ...withSupport, slug: 'audien', name: 'Audien', website: 'https://audien.com' })
    supportLinks([SUPPORT_MODEL, `${SUPPORT}/select-300`])
    vi.mocked(extractModel).mockImplementation(async () => dated('Select 200'))
    await main(['archive', '--brand', 'jabra-enhance', '--limit', '1'], opts)
    expect(vi.mocked(discoverModelUrls).mock.calls.map(([b]) => b.slug)).toEqual(['jabra-enhance'])
    expect(vi.mocked(extractModel)).toHaveBeenCalledTimes(1)
  })

  describe('archive-wayback', () => {
    const gone = { ...brand, status: 'gone' as const }
    const found = async () => {
      const zed = { ...model('Zed 2'), discontinued: { source: { value: 'Zed 2', quote: 'Jabra Enhance Zed 2', sourceUrl: 'https://web.archive.org/web/2020/https://x.test/', fetchedAt: FETCHED_AT, sourceType: 'official' as const } } }
      vi.mocked(archiveCandidates).mockResolvedValue([{ kind: 'new-model', modelSlug: zed.slug, path: '', after: zed, checks: {} }])
    }

    test('a gone brand gets its archive models as pending cards with origin archive, and no live catalog read', async () => {
      await writeJson(join(dataDir, 'brands', 'jabra-enhance.json'), gone)
      await found()
      expect(await main(['archive'], opts)).toBe(0)
      const card = PendingChange.parse(JSON.parse(await readFile(join(dataDir, 'pending', 'jabra-enhance-zed-2-model.json'), 'utf8')))
      expect(card.origin).toBe('archive')
      expect(discoverModelUrls).not.toHaveBeenCalled()
      expect(vi.mocked(archiveCandidates).mock.calls[0][2].liveModelUrls.size).toBe(0)
    })

    test('an active brand without archive.catalogUrls has no wayback unit; with them the live catalog models are left out', async () => {
      await found()
      vi.mocked(discoverModelUrls).mockResolvedValue([])
      await main(['archive'], opts)
      expect(archiveCandidates).not.toHaveBeenCalled()

      await writeJson(join(dataDir, 'brands', 'jabra-enhance.json'), { ...brand, archive: { catalogUrls: [BASE] } })
      vi.mocked(discoverModelUrls).mockResolvedValue([{ modelUrl: `${BASE}/live`, documentUrls: [], inCatalog: true }])
      await main(['archive'], opts)
      expect([...vi.mocked(archiveCandidates).mock.calls[0][2].liveModelUrls]).toEqual([`${BASE}/live`])
    })

    test('an active brand whose live catalog was not read whole gets no archive proposals', async () => {
      await writeJson(join(dataDir, 'brands', 'jabra-enhance.json'), { ...brand, archive: { catalogUrls: [BASE] } })
      vi.mocked(discoverModelUrls).mockImplementation(async (_b, o) => {
        o?.onEmpty?.(BASE)
        return []
      })
      await main(['archive'], opts)
      expect(archiveCandidates).not.toHaveBeenCalled()
      expect(log.join('\n')).toContain('live catalog was not read whole')
    })

    test('archive-excluded is logged and the run goes on; a 429 from the archive stops it', async () => {
      await writeJson(join(dataDir, 'brands', 'jabra-enhance.json'), gone)
      vi.mocked(archiveCandidates).mockRejectedValue(new WaybackError('archive-excluded', 'HTTP 403'))
      expect(await main(['archive'], opts)).toBe(0)
      expect(log.join('\n')).toContain('web.archive.org does not serve this site, no archive models')

      vi.mocked(archiveCandidates).mockRejectedValue(new WaybackError('rate-limited', 'HTTP 429'))
      expect(await main(['archive'], opts)).toBe(2)
      expect(log).toContain('web.archive.org refused requests. Resume later: npm run archive -- --resume')
    })
  })
})

describe('fda status from 510(k) records', () => {
  const DEVICE = 'Jabra Enhance Select Self-fit (Jabra Enhance Select 550)'
  const CDRH = 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=K254108'
  const clearance = (overrides: Partial<Clearance510k> = {}): Clearance510k => ({
    kNumber: 'K254108',
    applicant: 'GN Hearing A/S',
    deviceName: DEVICE,
    decisionDate: '2026-06-25',
    cdrhUrl: CDRH,
    ref: { url: 'https://api.fda.gov/device/510k.json?search=x', fetchedAt: FETCHED_AT },
    ...overrides,
  })
  /** The logged openFDA page holding the record: the body the quote is checked against. */
  const logRecord = (text: string) => {
    vi.mocked(readLog).mockResolvedValue([
      { url: 'https://api.fda.gov/device/510k.json?search=x', redirects: [], fetchedAt: FETCHED_AT, status: 200, via: 'live', rendered: false, bodyHash: 'a'.repeat(64) },
    ])
    vi.mocked(readBody).mockResolvedValue(new TextEncoder().encode(text))
  }
  const RECORD = JSON.stringify({ k_number: 'K254108', device_name: DEVICE })

  beforeEach(async () => {
    await writeJson(join(dataDir, 'models', 'jabra-enhance-select-550.json'), model('Select 550'))
    logRecord(RECORD)
  })

  test('a clearance naming a stored model proposes its fda field for review; feed events keep eventsSince', async () => {
    vi.mocked(fetchClearances).mockResolvedValue([clearance()])

    expect(await main(['fda'], opts)).toBe(0)

    expect(fetchClearances).toHaveBeenCalledWith('2018-01-01')
    expect(fetchFdaEvents).toHaveBeenCalledWith('2023-11-01', expect.anything(), expect.anything())
    const change = await pendingCard('jabra-enhance-select-550-fda')
    expect(change.kind).toBe('spec-change')
    expect(change.after).toEqual({ value: { status: '510(k) cleared', k510: 'K254108' }, sourceUrl: CDRH, quote: DEVICE, fetchedAt: FETCHED_AT, sourceType: 'official' })
    expect(change.checks.fda).toEqual([{ name: 'literal', ok: true }])
  })

  test('the latest of several matching records is the one proposed; De Novo grants say so', async () => {
    vi.mocked(fetchClearances).mockResolvedValue([
      clearance({ kNumber: 'K100001', decisionDate: '2024-02-01' }),
      clearance({ kNumber: 'DEN230001', decisionDate: '2025-03-01' }),
      clearance({ decisionDate: '2026-01-01' }),
    ])

    expect(await main(['fda'], opts)).toBe(0)

    expect((await pendingCard('jabra-enhance-select-550-fda')).after).toMatchObject({ value: { status: '510(k) cleared', k510: 'K254108' } })
  })

  test('a De Novo record is named as such', async () => {
    vi.mocked(fetchClearances).mockResolvedValue([clearance({ kNumber: 'DEN230001' })])
    logRecord(JSON.stringify({ k_number: 'DEN230001', device_name: DEVICE }))

    expect(await main(['fda'], opts)).toBe(0)

    expect((await pendingCard('jabra-enhance-select-550-fda')).after).toMatchObject({ value: { status: 'De Novo granted', k510: 'DEN230001' } })
  })

  test('without a matching record fda stays empty', async () => {
    vi.mocked(fetchClearances).mockResolvedValue([clearance({ applicant: 'Samsung Electronics Co., Ltd.', deviceName: 'Hearing Aid Feature' })])

    expect(await main(['fda'], opts)).toBe(0)

    expect(await filesUnder(join(dataDir, 'pending'))).toEqual([])
  })

  test('a stored fda that already says the same is not proposed again', async () => {
    await writeJson(
      join(dataDir, 'models', 'jabra-enhance-select-550.json'),
      model('Select 550', { fda: { value: { status: '510(k) cleared', k510: 'K254108' }, quote: DEVICE, sourceUrl: CDRH, fetchedAt: FETCHED_AT, sourceType: 'official' } }),
    )
    vi.mocked(fetchClearances).mockResolvedValue([clearance()])

    expect(await main(['fda'], opts)).toBe(0)

    expect(await filesUnder(join(dataDir, 'pending'))).toEqual([])
  })

  test('a quote the logged record does not contain fails its literal check', async () => {
    vi.mocked(fetchClearances).mockResolvedValue([clearance()])
    logRecord(JSON.stringify({ k_number: 'K254108', device_name: 'Some other device' }))

    expect(await main(['fda'], opts)).toBe(0)

    expect((await pendingCard('jabra-enhance-select-550-fda')).checks.fda).toEqual([{ name: 'literal', ok: false, detail: 'quote not found in source text' }])
  })
})
