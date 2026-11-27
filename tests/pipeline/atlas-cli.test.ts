// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { atlasMain } from '@/pipeline/atlas/cli'
import { ArchiveRefusedError, crawlSite, SiteRefusedError } from '@/pipeline/atlas/crawl'
import { upsertEdge, upsertEntity } from '@/pipeline/atlas/graph-store'
import { Sites, SiteReport, type Site } from '@/pipeline/atlas/schema'
import { writeJson } from '@/src/lib/data/write'
import { Graph } from '@/src/lib/schema/graph'

vi.mock('@/pipeline/atlas/crawl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/atlas/crawl')>()),
  crawlSite: vi.fn(),
}))

const FETCHED_AT = '2026-11-27T10:00:00.000Z'
const site = (domain: string): Site => ({ domain, start: `https://${domain}/`, kind: 'brand', mode: 'live', brands: [] })
const SITES = [site('one.test'), site('two.test'), site('three.test')]

let dir: string
let opts: { dataDir: string; progressDir: string }
const reportPath = (domain: string) => join(dir, 'data', 'atlas', 'sites', domain, 'report.json')

const pageFor = (s: Site) => ({
  url: s.start,
  ref: { url: s.start, fetchedAt: FETCHED_AT },
  internalLinks: 0,
  external: [],
  pdfs: [],
  apps: { ios: [], android: [] },
  jsonLdTypes: [],
  needsRender: false,
})

const reportFor = (s: Site): SiteReport => ({
  domain: s.domain,
  generatedAt: FETCHED_AT,
  mode: 'live',
  start: s.start,
  budget: 60,
  robots: { ref: null, status: null, sitemaps: [], groups: [] },
  sitemap: { refs: [], urlCount: 0, sections: [] },
  pages: [pageFor(s)],
  templates: [],
  outbound: [],
  redirects: [],
  pdfHosts: [],
  archive: { sections: [] },
  failures: [],
  urls: [],
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atlas-cli-'))
  opts = { dataDir: join(dir, 'data'), progressDir: join(dir, 'progress') }
  await writeJson(join(opts.dataDir, 'atlas', 'sites.json'), Sites.parse(SITES))
  vi.mocked(crawlSite).mockReset().mockImplementation(async (s) => ({
    report: reportFor(s),
    graph: (g) => {
      let next = upsertEntity(g, { id: `domain:${s.domain}`, kind: 'domain', name: s.domain })
      next = upsertEntity(next, { id: 'domain:x.test', kind: 'domain', name: 'x.test' })
      return upsertEdge(next, {
        from: `domain:${s.domain}`,
        to: 'domain:x.test',
        kind: 'links-to',
        visibility: 'internal',
        status: 'observed',
        sources: [{ url: s.start, fetchedAt: FETCHED_AT, kind: 'crawl' }],
      })
    },
  }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

test('crawl writes report.json and the observed edges', async () => {
  expect(await atlasMain(['crawl'], opts)).toBe(0)
  expect(SiteReport.parse(JSON.parse(await readFile(reportPath('one.test'), 'utf8'))).domain).toBe('one.test')
  expect(await stat(reportPath('two.test'))).toBeTruthy()
  const edges = JSON.parse(await readFile(join(opts.dataDir, 'graph', 'edges.json'), 'utf8'))
  const entities = JSON.parse(await readFile(join(opts.dataDir, 'graph', 'entities.json'), 'utf8'))
  expect(Graph.parse({ entities, edges }).edges.map((e) => e.from)).toEqual(['domain:one.test', 'domain:three.test', 'domain:two.test'])
})

/** A crawl of `s` that the site refused after reading `pages` pages. */
const refusedCrawl = (s: Site, pages: number) => ({
  report: {
    ...reportFor(s),
    pages: pages > 0 ? [pageFor(s)] : [],
    failures: [{ url: `${s.start}x`, reason: 'refused', detail: 'rate-limited' }],
  },
  graph: (g: Graph) => g,
  refused: new SiteRefusedError(s.domain, `${s.start}x`, 'rate-limited'),
})

test('a site that refuses stops only itself: its partial report is written, the next site runs, exit 2 names it', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(crawlSite).mockImplementation(async (s) =>
    s.domain === 'two.test' ? refusedCrawl(s, 1) : { report: reportFor(s), graph: (g) => g },
  )
  expect(await atlasMain(['crawl'], opts)).toBe(2)
  expect(vi.mocked(crawlSite).mock.calls.map(([s]) => s.domain)).toEqual(['one.test', 'two.test', 'three.test'])
  expect(SiteReport.parse(JSON.parse(await readFile(reportPath('two.test'), 'utf8'))).failures).toEqual([
    { url: 'https://two.test/x', reason: 'refused', detail: 'rate-limited' },
  ])
  expect(await stat(reportPath('three.test'))).toBeTruthy()
  const errors = vi.mocked(console.error).mock.calls.join('\n')
  expect(errors).toContain('Refused: two.test')
  expect(errors).toContain('npm run atlas:crawl -- --site two.test')

  // Plain --resume skips the refused site and still says so; --site tries it again.
  vi.mocked(crawlSite).mockClear()
  expect(await atlasMain(['crawl', '--resume'], opts)).toBe(2)
  expect(crawlSite).not.toHaveBeenCalled()
  vi.mocked(crawlSite).mockImplementation(async (s) => ({ report: reportFor(s), graph: (g) => g }))
  expect(await atlasMain(['crawl', '--site', 'two.test'], opts)).toBe(0)
  expect(vi.mocked(crawlSite).mock.calls.map(([s]) => s.domain)).toEqual(['two.test'])
})

test('a site that refused before any page keeps its older report', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await writeJson(reportPath('two.test'), { ...reportFor(site('two.test')), generatedAt: '2026-11-26T10:00:00.000Z' })
  const oldReport = await readFile(reportPath('two.test'), 'utf8')
  vi.mocked(crawlSite).mockImplementation(async (s) => (s.domain === 'two.test' ? refusedCrawl(s, 0) : { report: reportFor(s), graph: (g) => g }))
  expect(await atlasMain(['crawl'], opts)).toBe(2)
  expect(await readFile(reportPath('two.test'), 'utf8')).toBe(oldReport)
})

test('a refusal by web.archive.org stops the whole run; --resume goes on where it stopped', async () => {
  vi.mocked(crawlSite).mockImplementationOnce(async (s) => ({ report: reportFor(s), graph: (g) => g }))
  vi.mocked(crawlSite).mockRejectedValueOnce(new ArchiveRefusedError('two.test', 'https://two.test/x', 'rate-limited'))
  expect(await atlasMain(['crawl'], opts)).toBe(2)
  expect(vi.mocked(crawlSite).mock.calls.map(([s]) => s.domain)).toEqual(['one.test', 'two.test'])
  expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('Resume later: npm run atlas:crawl -- --resume')
  vi.mocked(crawlSite).mockClear()
  expect(await atlasMain(['crawl', '--resume'], opts)).toBe(0)
  expect(vi.mocked(crawlSite).mock.calls.map(([s]) => s.domain)).toEqual(['two.test', 'three.test'])
})

test('a crawl that read no page keeps the old report, is not done and exits 1', async () => {
  await writeJson(reportPath('two.test'), reportFor(site('two.test')))
  const oldReport = await readFile(reportPath('two.test'), 'utf8')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(crawlSite).mockImplementation(async (s) => ({ report: { ...reportFor(s), pages: s.domain === 'two.test' ? [] : [pageFor(s)] }, graph: (g: Graph) => g }))
  expect(await atlasMain(['crawl'], opts)).toBe(1)
  expect(await readFile(reportPath('two.test'), 'utf8')).toBe(oldReport)
  vi.mocked(crawlSite).mockClear()
  expect(await atlasMain(['crawl', '--resume'], opts)).toBe(1)
  expect(vi.mocked(crawlSite).mock.calls.map(([s]) => s.domain)).toEqual(['two.test'])
})

test('a successful --site run leaves the progress of a stopped full run alone', async () => {
  vi.mocked(crawlSite).mockRejectedValueOnce(new ArchiveRefusedError('one.test', 'https://one.test/', 'rate-limited'))
  expect(await atlasMain(['crawl'], opts)).toBe(2)
  expect(await atlasMain(['crawl', '--site', 'two.test'], opts)).toBe(0)
  vi.mocked(crawlSite).mockClear()
  expect(await atlasMain(['crawl', '--resume'], opts)).toBe(0)
  expect(vi.mocked(crawlSite).mock.calls.map(([s]) => s.domain)).toEqual(['one.test', 'two.test', 'three.test'])
})

test('--site limits the run to one domain; an unknown domain exits 1', async () => {
  expect(await atlasMain(['crawl', '--site', 'two.test'], opts)).toBe(0)
  expect(vi.mocked(crawlSite).mock.calls.map(([s]) => s.domain)).toEqual(['two.test'])
  expect(await atlasMain(['crawl', '--site', 'nope.test'], opts)).toBe(1)
})

test('bad arguments exit 1', async () => {
  expect(await atlasMain([], opts)).toBe(1)
  expect(await atlasMain(['crawl', '--bogus'], opts)).toBe(1)
})

test('runs without NEXT_PUBLIC_SITE_URL', async () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
  expect(await atlasMain(['crawl'], opts)).toBe(0)
})

test('the real sites.json is valid', async () => {
  const sites = Sites.parse(JSON.parse(await readFile('data/atlas/sites.json', 'utf8')))
  const byDomain = new Map(sites.map((s) => [s.domain, s]))
  expect(byDomain.get('apple.com')?.include).toBe('^https://www\\.apple\\.com/airpods-pro/')
  expect(byDomain.get('costco.com')?.brands).toEqual(['kirkland-signature'])
  expect(sites.filter((s) => s.mode === 'archive').map((s) => s.domain).sort()).toEqual(['eargo.com', 'lexiehearing.com', 'livelyhearing.com'])
  expect(byDomain.get('livelyhearing.com')?.newBrand?.slug).toBe('lively')
  expect(sites.filter((s) => s.kind === 'group').map((s) => s.domain).sort()).toEqual(['demant.com', 'gn.com', 'sonova.com', 'wsa.com'])
  expect(byDomain.get('eargo.com')?.brands).toEqual(['eargo'])
})
