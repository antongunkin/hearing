// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { crossCheck } from '@/pipeline/checks/crosscheck'
import { main } from '@/pipeline/cli'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { LlmLimitError, LlmOutputError } from '@/pipeline/llm'
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
let progressFile: string
let opts: { dataDir: string; progressFile: string; prosConsDir: string }
let log: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cli-'))
  dataDir = join(dir, 'data')
  progressFile = join(dir, 'cache', 'progress.json')
  opts = { dataDir, progressFile, prosConsDir: join(dir, 'cache', 'pros-cons') }
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
})

afterEach(async () => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
}

test('LlmLimitError mid-run: exit 2, progress saved, no *.tmp, resume skips done models', async () => {
  const groups = ['select-100', 'select-200', 'select-300'].map((slug) => ({ modelUrl: `${BASE}/${slug}`, documentUrls: [] }))
  vi.mocked(discoverModelUrls).mockResolvedValue(groups)
  vi.mocked(extractModel)
    .mockResolvedValueOnce(candidate('Select 100'))
    .mockRejectedValueOnce(new LlmLimitError('usage limit'))

  expect(await main(['update', '--brand', 'jabra-enhance'], opts)).toBe(2)

  expect(log).toContain('Claude usage limit reached. Resume later: npm run update -- --resume')
  expect(await filesUnder(dataDir)).toEqual(
    expect.arrayContaining(['pending/jabra-enhance-select-100-model.json']),
  )
  expect(JSON.parse(await readFile(progressFile, 'utf8'))).toEqual({ done: [`scrape:jabra-enhance:${BASE}/select-100`] })
  expect([...(await filesUnder(dataDir)), ...(await filesUnder(join(dir, 'cache')))].filter((f) => f.endsWith('.tmp'))).toEqual([])
  expect(fetchFdaEvents).not.toHaveBeenCalled() // the run stopped

  vi.mocked(extractModel).mockReset()
  vi.mocked(extractModel).mockResolvedValueOnce(candidate('Select 200')).mockResolvedValueOnce(candidate('Select 300'))
  expect(await main(['update', '--resume'], opts)).toBe(0)

  // Model pages fetched on resume: the two not done.
  expect(vi.mocked(extractModel).mock.calls.map(([, pages]) => pages.map((page) => page.url))).toEqual([
    [`${BASE}/select-200`],
    [`${BASE}/select-300`],
  ])
  const pending = (await filesUnder(join(dataDir, 'pending'))).sort()
  expect(pending).toEqual(['jabra-enhance-select-100-model.json', 'jabra-enhance-select-200-model.json', 'jabra-enhance-select-300-model.json'])
  const first = PendingChange.parse(JSON.parse(await readFile(join(dataDir, 'pending', pending[0]), 'utf8')))
  expect(first.kind).toBe('new-model')
  expect(first.checks['variants.0.weightG']).toEqual([{ name: 'literal', ok: true }, { name: 'crosscheck', ok: true }])
  expect(fetchFdaEvents).toHaveBeenCalled()
  await expect(readFile(progressFile)).rejects.toThrow() // finished: nothing to resume
  expect(log.at(-1)).toBe('Summary: auto 0, pending 2, dropped 0, skipped sources 0, failed 0')
})

test('per-step failures are counted and the run goes on; youtube without a key is skipped', async () => {
  const stored = model('Select 300', { app: { name: 'Jabra Enhance', iosId: '123' } })
  await writeJson(join(dataDir, 'models', `${stored.slug}.json`), stored)
  vi.mocked(discoverModelUrls).mockResolvedValue([])
  vi.mocked(fetchFdaEvents).mockRejectedValue(new Error('openFDA 510k skipped: http-error (HTTP 500)'))
  vi.mocked(fetchIosVersion).mockResolvedValue(null)
  const shop = 'https://shop.example/select-300'
  vi.mocked(discoverReviewSources).mockResolvedValue({ expert: [], retail: [shop, 'https://blocked.example/x'] })
  vi.mocked(fetchPage).mockImplementation(async (url) =>
    url === shop ? okPage(url) : { status: 'skipped', url, reason: 'bot-protection', detail: 'HTTP 403' },
  )
  vi.mocked(extractRetailReviews).mockResolvedValue({ rating: 4.2, count: 87, texts: ['battery died'] })
  vi.mocked(complaintThemes).mockRejectedValue(new LlmOutputError('some reviews have no entry'))
  vi.mocked(searchVideos).mockRejectedValue(new YouTubeError('YOUTUBE_API_KEY is not set'))

  expect(await main(['update', '--refresh'], opts)).toBe(0)

  expect(vi.mocked(discoverModelUrls).mock.calls[0][1]).toEqual({ refresh: true })
  expect(vi.mocked(discoverThirdPartyFacts).mock.calls[0][1]).toEqual({ asOf: expect.stringMatching(/^\d{4}-\d{2}$/), refresh: true })
  const reviews = Reviews.parse(JSON.parse(await readFile(join(dataDir, 'reviews', `${stored.slug}.json`), 'utf8')))
  expect(reviews.customer).toEqual([{ sourceUrl: shop, rating: 4.2, count: 87, fetchedAt: FETCHED_AT }])
  expect(log.some((line) => line.includes('youtube skipped') && line.includes('YOUTUBE_API_KEY'))).toBe(true)
  // Skipped: the iTunes lookup, one shop page and the youtube step. Failed: FDA and complaint themes.
  expect(log.at(-1)).toBe('Summary: auto 1, pending 0, dropped 0, skipped sources 3, failed 2')
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
