// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { atlasMain } from '@/pipeline/atlas/cli'
import { readGraph } from '@/pipeline/atlas/graph-store'
import { appPublishers, fdaApplicants, RelationSourceError, searchClaims, sourceKindFor } from '@/pipeline/atlas/relations'
import type { Site, SiteReport } from '@/pipeline/atlas/schema'
import { Sites } from '@/pipeline/atlas/schema'
import { fetchPage } from '@/pipeline/fetch/fetcher'
import { appendLog, storeBody } from '@/pipeline/fetch/raw-store'
import { config } from '@/pipeline/config'
import { llm } from '@/pipeline/llm'
import { lookupApp } from '@/pipeline/sources/itunes'
import { fetchClearances } from '@/pipeline/sources/openfda'
import { loadDataset } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'
import type { Brand } from '@/src/lib/schema/brand'
import { PendingChange } from '@/src/lib/schema/pending'

vi.mock('@/pipeline/fetch/fetcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/fetch/fetcher')>()),
  fetchPage: vi.fn(),
}))
vi.mock('@/pipeline/llm', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/pipeline/llm')>()), llm: vi.fn() }))
vi.mock('@/pipeline/sources/openfda', () => ({ fetchClearances: vi.fn() }))
vi.mock('@/pipeline/sources/itunes', () => ({ lookupApp: vi.fn() }))

const FETCHED_AT = '2026-11-27T10:00:00.000Z'
const brand: Brand = {
  slug: 'xbrand',
  name: 'XBrand',
  group: 'X Group',
  website: 'https://xbrand.test/',
  imageLicense: 'none',
  defaultType: 'rx',
  status: 'active',
  scraper: { catalogUrls: [], modelUrlPattern: '', render: false },
}
const site: Site = { domain: 'xbrand.test', start: 'https://xbrand.test/', kind: 'brand', mode: 'live', brands: ['xbrand'] }
const ctx = { brands: [brand], sites: [site] }

const NEWS = 'https://news.test/deal'
const OWNS = 'XBrand is a brand of X Group Holding.'
const claim = (extra: Record<string, unknown> = {}) => ({
  kind: 'owns',
  subject: 'X Group Holding',
  subjectKind: 'company',
  object: 'XBrand',
  objectKind: 'brand',
  url: NEWS,
  quote: OWNS,
  sourceKind: 'press-release',
  ...extra,
})
const claims = (...list: unknown[]) => vi.mocked(llm).mockReset().mockResolvedValue({ claims: list })

let dir: string
let rawDir: string
/** Puts a reply in the raw store and the fetch log, as the fetcher does. */
async function logReply(url: string, body: string) {
  await appendLog({ url, redirects: [], fetchedAt: FETCHED_AT, status: 200, contentType: 'application/json', bodyHash: await storeBody(new TextEncoder().encode(body), rawDir), via: 'live', rendered: false }, rawDir)
}
let web: Record<string, string | { skip: 'rate-limited' | 'http-error' }>
const fetched = () => vi.mocked(fetchPage).mock.calls.map(([url]) => url)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atlas-relations-'))
  rawDir = join(dir, 'raw')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  web = { [NEWS]: `Business news. ${OWNS} More text.` }
  vi.mocked(fetchPage).mockReset().mockImplementation(async (url) => {
    const reply = web[url]
    if (reply === undefined) return { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' }
    if (typeof reply === 'object') return { status: 'skipped', url, reason: reply.skip }
    return { status: 'ok', url, text: reply, contentHash: 'h', fetchedAt: FETCHED_AT }
  })
  vi.mocked(llm).mockReset().mockResolvedValue({ claims: [] })
  vi.mocked(fetchClearances).mockReset().mockResolvedValue([])
  vi.mocked(lookupApp).mockReset()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

test('an SEC filing on another host, or a third-party source for owns, is refused', () => {
  expect(sourceKindFor('https://news.test/x', 'sec-filing', 'owns', [])).toBeNull()
  expect(sourceKindFor('https://www.sec.gov/x', 'sec-filing', 'owns', [])).toBe('sec-filing')
  expect(sourceKindFor('https://news.test/x', 'third-party', 'owns', [])).toBeNull()
  expect(sourceKindFor('https://news.test/x', 'third-party', 'makes-for', [])).toBe('third-party')
  expect(sourceKindFor('https://news.test/x', 'press-release', 'owns', [])).toBe('press-release')
  expect(sourceKindFor('https://news.test/x', 'fda-record', 'files-as', [])).toBeNull()
  expect(sourceKindFor('https://www.accessdata.fda.gov/x', 'fda-record', 'files-as', [])).toBe('fda-record')
  expect(sourceKindFor('https://evil.test/itunes.apple.com', 'app-store', 'publishes', [])).toBeNull()
  expect(sourceKindFor('https://apps.apple.com/us/app/x/id1', 'app-store', 'publishes', [])).toBe('app-store')
  expect(sourceKindFor('https://xbrand.test/about', 'company-page', 'owns', ['news.test'])).toBeNull()
  expect(sourceKindFor('https://www.xbrand.test/about', 'company-page', 'owns', ['xbrand.test'])).toBe('company-page')
  expect(sourceKindFor('https://xbrand.test/about', 'crawl', 'owns', ['xbrand.test'])).toBeNull()
})

test('a claim whose quote is on the page becomes a proposed internal edge with its checks; a date the quote lacks is dropped', async () => {
  claims(claim({ since: '2020' }))
  const [rel] = await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx)

  expect(vi.mocked(llm).mock.calls[0][0]).toMatchObject({ provider: 'claude', tools: ['WebSearch'], model: config.llm.claudeModel })
  expect(vi.mocked(llm).mock.calls[0][0].prompt).toMatch(/as of \d{4}-\d{2}/)
  expect(rel.edge).toEqual({
    from: 'company:x-group-holding',
    to: 'brand:xbrand',
    kind: 'owns',
    visibility: 'internal',
    status: 'proposed',
    sources: [{ url: NEWS, quote: OWNS, fetchedAt: FETCHED_AT, kind: 'press-release' }],
  })
  expect(rel.entities.map((entity) => entity.id)).toEqual(['company:x-group-holding', 'brand:xbrand'])
  expect(rel.checks.quote[0].ok).toBe(true)
})

test('since stays only as far as the quote states it', async () => {
  const bought = 'X Group Holding bought XBrand in 2020.'
  web[NEWS] = `News. ${bought} More.`
  claims(claim({ quote: bought, since: '2020-05' }), claim({ quote: bought, kind: 'makes-for', sourceKind: 'third-party', since: '2019' }))
  const found = await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx)
  expect(found.map((rel) => [rel.edge.kind, rel.edge.since])).toEqual([['owns', '2020'], ['makes-for', undefined]])
})

test('a page on the live domain of a gone brand or an archive site is never a source', async () => {
  const gone: Brand = { ...brand, slug: 'oldbrand', name: 'OldBrand', website: 'https://www.oldbrand.test/', status: 'gone' }
  const archived: Site = { domain: 'oldsite.test', start: 'https://oldsite.test/', kind: 'brand', mode: 'archive', brands: ['xbrand'] }
  const quote = 'OldBrand is a brand of X Group Holding.'
  web['https://oldbrand.test/about'] = `About. ${quote}`
  web['https://shop.oldsite.test/about'] = `About. ${OWNS}`
  claims(
    claim({ object: 'OldBrand', url: 'https://oldbrand.test/about', quote, sourceKind: 'company-page' }),
    claim({ kind: 'makes-for', object: 'OldBrand', url: 'https://oldbrand.test/about', quote, sourceKind: 'press-release' }),
    claim({ url: 'https://shop.oldsite.test/about', sourceKind: 'company-page' }),
  )
  const context = { brands: [brand, gone], sites: [site, archived] }
  expect(await searchClaims({ name: 'OldBrand', kind: 'brand' }, context)).toEqual([])
  expect(fetched()).toEqual([])
  // The same claims count when the brand is active and the site live.
  const live = { brands: [brand, { ...gone, status: 'active' as const }], sites: [site, { ...archived, mode: 'live' as const }] }
  expect(await searchClaims({ name: 'OldBrand', kind: 'brand' }, live)).toHaveLength(3)
})

test('a claim whose quote is not on the page is dropped', async () => {
  claims(claim({ quote: 'X Group Holding bought XBrand in 1999.' }))
  expect(await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx)).toEqual([])
})

test('a claim is dropped when the page misses a name, the quote is too long or names neither side, or the kind does not fit the host', async () => {
  const long = `${OWNS} ${'Filler words. '.repeat(30)}`
  web[NEWS] = `${OWNS} Unrelated: the weather is fine. ${long}`
  claims(
    claim({ object: 'Other Brand' }),
    claim({ quote: 'Unrelated: the weather is fine.' }),
    claim({ quote: long.trim() }),
    claim({ sourceKind: 'company-page' }),
    claim({ sourceKind: 'third-party' }),
    claim({ sourceKind: 'sec-filing' }),
  )
  expect(await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx)).toEqual([])
})

test('a company-page claim is kept on the brand website and dropped elsewhere', async () => {
  web['https://xbrand.test/about'] = `About. ${OWNS}`
  claims(claim({ url: 'https://xbrand.test/about', sourceKind: 'company-page' }), claim({ sourceKind: 'company-page' }))
  const found = await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx)
  expect(found.map((rel) => rel.edge.sources[0].url)).toEqual(['https://xbrand.test/about'])
})

test('search results go through fetchableUrls: Google, Amazon and SEC pages are never fetched', async () => {
  const urls = ['https://www.google.com/search?q=x', 'https://www.amazon.de/dp/1', 'https://www.sec.gov/Archives/x', 'https://efts.sec.gov/x', 'ftp://news.test/x', NEWS]
  claims(...urls.map((url) => claim({ url, sourceKind: url.includes('sec.gov') ? 'sec-filing' : 'press-release' })))
  const found = await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx)

  expect(fetched()).toEqual([NEWS])
  expect(found).toHaveLength(1)
})

test('a claim page is fetched with sec.gov in the blocklist, so a redirect to it is refused', async () => {
  claims(claim())
  await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx)
  expect(vi.mocked(fetchPage).mock.calls[0][1]?.blocklist).toContain('sec.gov')
})

test('an app found by search and the same app found in the store are one graph node', async () => {
  const store = 'https://apps.apple.com/us/app/xbrand-remote/id123456'
  web[store] = 'XBrand Remote. XBrand Remote is an app published by XBrand Inc.'
  claims(claim({ kind: 'publishes', subject: 'XBrand', subjectKind: 'brand', object: 'XBrand Remote', objectKind: 'app', url: store, quote: 'XBrand Remote is an app published by XBrand Inc.', sourceKind: 'app-store' }))
  const [rel] = await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx)
  expect(rel.edge.to).toBe('app:ios-123456')
  expect(rel.entities[1]).toEqual({ id: 'app:ios-123456', kind: 'app', name: 'XBrand Remote', iosId: '123456' })

  // Without an iOS id in the URL the slug is the id.
  web[NEWS] = 'XBrand Remote is an app published by XBrand Inc.'
  claims(claim({ kind: 'publishes', subject: 'XBrand', subjectKind: 'brand', object: 'XBrand Remote', objectKind: 'app', quote: 'XBrand Remote is an app published by XBrand Inc.' }))
  expect((await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx))[0].edge.to).toBe('app:xbrand-remote')

  // An `id=` parameter is an iOS id only on the App Store.
  const article = 'https://news.test/article?id=999'
  web[article] = 'XBrand Remote is an app published by XBrand Inc.'
  claims(claim({ kind: 'publishes', subject: 'XBrand', subjectKind: 'brand', object: 'XBrand Remote', objectKind: 'app', url: article, quote: 'XBrand Remote is an app published by XBrand Inc.' }))
  expect((await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx))[0].edge.to).toBe('app:xbrand-remote')
})

test('a refused page drops only the claims that cite it', async () => {
  web['https://rate.test/a'] = { skip: 'rate-limited' }
  claims(claim({ url: 'https://rate.test/a' }), claim())
  const found = await searchClaims({ name: 'XBrand', kind: 'brand' }, ctx)
  expect(found.map((rel) => rel.edge.sources[0].url)).toEqual([NEWS])
})

test('FDA applicants become entities; one naming a brand or its group gets a proposed files-as relation', async () => {
  const ref = { url: 'https://api.fda.gov/device/510k.json?x', fetchedAt: FETCHED_AT }
  const clearance = (applicant: string, kNumber: string) => ({ kNumber, applicant, deviceName: 'd', decisionDate: '2024-01-01', cdrhUrl: 'https://x.test', ref })
  vi.mocked(fetchClearances).mockResolvedValue([
    clearance('XBrand Hearing Inc.', 'K1'),
    clearance('XBrand Hearing Inc.', 'K2'),
    clearance('X Group Holding GmbH', 'K3'),
    clearance('Unrelated Audio LLC', 'K4'),
  ])
  await logReply(ref.url, JSON.stringify({ results: ['XBrand Hearing Inc.', 'X Group Holding GmbH', 'Unrelated Audio LLC'].map((applicant) => ({ applicant })) }))
  const { entities, relations } = await fdaApplicants([brand], rawDir)

  expect(entities.map((entity) => entity.id)).toEqual(['fda-applicant:xbrand-hearing-inc', 'fda-applicant:x-group-holding-gmbh', 'fda-applicant:unrelated-audio-llc'])
  expect(relations.map((rel) => [rel.edge.from, rel.edge.kind, rel.edge.to, rel.edge.status, rel.edge.visibility])).toEqual([
    ['brand:xbrand', 'files-as', 'fda-applicant:xbrand-hearing-inc', 'proposed', 'internal'],
    ['company:x-group', 'files-as', 'fda-applicant:x-group-holding-gmbh', 'proposed', 'internal'],
  ])
  expect(relations[0].edge.sources).toEqual([{ url: ref.url, quote: 'XBrand Hearing Inc.', fetchedAt: FETCHED_AT, kind: 'fda-record' }])
  expect(relations[0].checks.quote).toEqual([{ name: 'log', ok: true }, { name: 'literal', ok: true }])
})

test('the checks of an FDA relation are computed: a reply missing from the fetch log, or without the applicant, fails', async () => {
  const ref = { url: 'https://api.fda.gov/device/510k.json?x', fetchedAt: FETCHED_AT }
  vi.mocked(fetchClearances).mockResolvedValue([{ kNumber: 'K1', applicant: 'XBrand Hearing Inc.', deviceName: 'd', decisionDate: '2024-01-01', cdrhUrl: 'https://x.test', ref }])
  expect((await fdaApplicants([brand], rawDir)).relations[0].checks.quote).toEqual([{ name: 'log', ok: false, detail: 'not in the fetch log' }])
  await logReply(ref.url, '{"results":[]}')
  const [log, literal] = (await fdaApplicants([brand], rawDir)).relations[0].checks.quote
  expect(log.ok).toBe(true)
  expect(literal).toMatchObject({ name: 'literal', ok: false })
})

test('an openFDA refusal stops the unit', async () => {
  vi.mocked(fetchClearances).mockRejectedValue(new Error('openFDA 510k skipped: rate-limited'))
  await expect(fdaApplicants([brand], rawDir)).rejects.toBeInstanceOf(RelationSourceError)
})

const report = (ios: string[]): SiteReport => ({ pages: [{ apps: { ios } }, { apps: { ios: ['1'] } }] }) as unknown as SiteReport
const app = (seller: string) => ({ iosId: '1', name: 'XBrand Remote', seller, url: 'https://apps.apple.com/app/id1', lookupUrl: 'https://itunes.apple.com/lookup?id=1', fetchedAt: FETCHED_AT })

test('an app whose seller is the brand gives a publishes relation; another seller or a removed app gives none', async () => {
  // The lookup writes its reply to the fetch log as it fetches, like the real one.
  vi.mocked(lookupApp)
    .mockImplementationOnce(async () => {
      await logReply('https://itunes.apple.com/lookup?id=1', '{"results":[{"sellerName":"XBrand Inc."}]}')
      return app('XBrand Inc.')
    })
    .mockResolvedValueOnce('removed')
  const [rel, ...rest] = await appPublishers(report(['1', '2']), brand, rawDir)
  expect(rel.checks.quote).toEqual([{ name: 'log', ok: true }, { name: 'literal', ok: true }])
  expect(rest).toEqual([])
  expect(rel.edge).toMatchObject({
    from: 'brand:xbrand',
    to: 'app:ios-1',
    kind: 'publishes',
    status: 'proposed',
    visibility: 'internal',
    sources: [{ url: 'https://itunes.apple.com/lookup?id=1', quote: 'XBrand Inc.', kind: 'app-store' }],
  })
  expect(rel.entities[1]).toEqual({ id: 'app:ios-1', kind: 'app', name: 'XBrand Remote', iosId: '1' })

  vi.mocked(lookupApp).mockResolvedValue(app('Someone Else Ltd'))
  expect(await appPublishers(report(['1']), brand, rawDir)).toEqual([])
})

test('a skipped App Store lookup stops the unit', async () => {
  vi.mocked(lookupApp).mockResolvedValue(null)
  await expect(appPublishers(report(['1']), brand, rawDir)).rejects.toBeInstanceOf(RelationSourceError)
})

test('atlas:relations queues every kept relation as a proposed internal edge and a relation card; SEC is never asked', async () => {
  const dataDir = join(dir, 'data')
  const opts = { dataDir, progressDir: join(dir, 'progress'), rawDir }
  await writeJson(join(dataDir, 'brands', 'xbrand.json'), brand)
  await writeJson(join(dataDir, 'rejections.json'), [])
  await writeJson(join(dataDir, 'blocklist.json'), [])
  await writeJson(join(dataDir, 'atlas', 'sites.json'), Sites.parse([site]))
  claims(claim())
  await logReply('https://api.fda.gov/x', '{"applicant":"XBrand Hearing Inc."}')
  vi.mocked(fetchClearances).mockResolvedValue([
    { kNumber: 'K1', applicant: 'XBrand Hearing Inc.', deviceName: 'd', decisionDate: '2024-01-01', cdrhUrl: 'https://x.test', ref: { url: 'https://api.fda.gov/x', fetchedAt: FETCHED_AT } },
    { kNumber: 'K2', applicant: 'Unrelated Audio LLC', deviceName: 'd', decisionDate: '2024-01-01', cdrhUrl: 'https://x.test', ref: { url: 'https://api.fda.gov/x', fetchedAt: FETCHED_AT } },
  ])
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})

  expect(await atlasMain(['relations'], opts)).toBe(0)

  expect(log.mock.calls.flat().filter((line) => String(line).startsWith('SEC skipped'))).toHaveLength(1)
  expect(fetched().some((url) => url.includes('sec.gov'))).toBe(false)
  const graph = await readGraph(dataDir)
  expect(graph.edges.map((edge) => `${edge.from} ${edge.kind} ${edge.to}`).sort()).toEqual([
    'brand:xbrand files-as fda-applicant:xbrand-hearing-inc',
    'company:x-group-holding owns brand:xbrand',
  ])
  expect(graph.edges.every((edge) => edge.visibility === 'internal' && edge.status === 'proposed')).toBe(true)
  // Applicants without a relation are in the graph too.
  expect(graph.entities.map((entity) => entity.id)).toContain('fda-applicant:unrelated-audio-llc')
  const cards = await Promise.all((await readdir(join(dataDir, 'pending'))).map(async (file) => (await loadDataset(dataDir)).pending.find((card) => file.startsWith(card.id))))
  expect(cards.every((card) => card?.kind === 'relation')).toBe(true)
  expect(cards).toHaveLength(2)
  PendingChange.parse(cards[0])
  log.mockRestore()
})

test('a refused openFDA stops the run with exit 2 and --resume skips finished units', async () => {
  const dataDir = join(dir, 'data')
  const opts = { dataDir, progressDir: join(dir, 'progress'), rawDir }
  await writeJson(join(dataDir, 'brands', 'xbrand.json'), brand)
  await writeJson(join(dataDir, 'rejections.json'), [])
  await writeJson(join(dataDir, 'blocklist.json'), [])
  await writeJson(join(dataDir, 'atlas', 'sites.json'), Sites.parse([site]))
  vi.mocked(fetchClearances).mockRejectedValueOnce(new Error('openFDA 510k skipped: rate-limited'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  expect(await atlasMain(['relations'], opts)).toBe(2)
  vi.mocked(llm).mockClear()
  expect(await atlasMain(['relations', '--resume'], opts)).toBe(0)
  expect(llm).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})
