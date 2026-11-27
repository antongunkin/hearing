// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'
import { ArchiveRefusedError, crawlSite, parseRobotsTxt, SiteRefusedError } from '@/pipeline/atlas/crawl'
import type { Site } from '@/pipeline/atlas/schema'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { cdx, WaybackError, type CdxRow } from '@/pipeline/sources/wayback'
import { Graph } from '@/src/lib/schema/graph'
import { archiveUrl } from '@/src/lib/archive-url'

vi.mock('@/pipeline/fetch/fetcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/fetch/fetcher')>()),
  fetchPage: vi.fn(),
}))
vi.mock('@/pipeline/sources/wayback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/sources/wayback')>()),
  cdx: vi.fn(),
}))

const FETCHED_AT = '2026-11-27T10:00:00.000Z'
const origin = 'https://brand.test'
const home = `${origin}/`
const site: Site = { domain: 'brand.test', start: home, kind: 'brand', mode: 'live', brands: [] }
const other: Site = { domain: 'other.test', start: 'https://other.test/', kind: 'group', mode: 'live', brands: [] }

type Reply = string | { skip: Extract<FetchResult, { status: 'skipped' }>['reason']; detail?: string } | { url: string; html: string }
let web: Record<string, Reply>
const requested: string[] = []

const anchors = (...hrefs: string[]) => `<html><head><title>t</title></head><body>${hrefs.map((h) => `<a href="${h}">x</a>`).join('')}</body></html>`

beforeEach(() => {
  requested.length = 0
  web = {}
  vi.mocked(cdx).mockReset().mockResolvedValue([])
  vi.mocked(fetchPage).mockReset().mockImplementation(async (url) => {
    requested.push(url)
    const reply = web[url]
    if (reply === undefined) return { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' }
    if (typeof reply === 'object' && 'skip' in reply) return { status: 'skipped', url, reason: reply.skip, detail: reply.detail }
    const html = typeof reply === 'string' ? reply : reply.html
    return {
      status: 'ok',
      url: typeof reply === 'string' ? url : reply.url,
      // A sitemap served as text/html: the fetcher's text is only what a reader sees, the tags are in html.
      text: url.endsWith('.xml') ? html.replace(/<[^>]*>/g, ' ') : html,
      ...(url.endsWith('.txt') ? {} : { html }),
      contentHash: 'h',
      fetchedAt: FETCHED_AT,
      contentType: 'text/html',
    }
  })
})

const row = (timestamp: string, original = home, statusCode = '200'): CdxRow => ({ timestamp, original, statusCode, mimeType: 'text/html', digest: 'd' })

test('crawls breadth-first within the budget, catalog-like paths first', async () => {
  web[home] = anchors('/about', '/hearing-aids', '/support')
  web[`${origin}/about`] = anchors()
  web[`${origin}/hearing-aids`] = anchors('/hearing-aids/a')
  web[`${origin}/support`] = anchors()
  const { report } = await crawlSite(site, [site], { budget: 3 })
  expect(report.pages.map((p) => p.url)).toEqual([home, `${origin}/hearing-aids`, `${origin}/support`])
  expect(report.pages.every((p) => p.ref.fetchedAt === FETCHED_AT)).toBe(true)
  expect(report.budget).toBe(3)
  expect(requested.filter((u) => u.endsWith('/about'))).toEqual([])
  // Linked but unfetched URLs are still listed.
  expect(report.urls).toContain(`${origin}/about`)
  expect(report.urls).toEqual([...report.urls].sort())
})

test('sitemap URLs are counted, never fetched', async () => {
  web[`${origin}/robots.txt`] = `User-agent: *\nDisallow: /private\nCrawl-delay: 4\nSitemap: ${origin}/index.xml\n`
  web[`${origin}/index.xml`] = `<sitemapindex><sitemap><loc>${origin}/a.xml</loc></sitemap><sitemap><loc>${origin}/b.xml.gz</loc></sitemap></sitemapindex>`
  web[`${origin}/a.xml`] = `<urlset><url><loc>${origin}/products/1</loc></url><url><loc>${origin}/products/2</loc></url><url><loc>${origin}/blog/x</loc></url></urlset>`
  web[home] = anchors()
  const { report } = await crawlSite(site, [site], { budget: 1 })
  expect(report.robots).toMatchObject({ status: 200, crawlDelaySec: 4, sitemaps: [`${origin}/index.xml`], groups: [{ userAgents: ['*'], disallow: ['/private'] }] })
  expect(report.sitemap.urlCount).toBe(3)
  expect(report.sitemap.sections).toEqual([{ path: '/products', count: 2 }, { path: '/blog', count: 1 }])
  expect(report.sitemap.refs.map((r) => r.url)).toEqual([`${origin}/index.xml`, `${origin}/a.xml`])
  expect(report.failures).toContainEqual({ url: `${origin}/b.xml.gz`, reason: 'unsupported', detail: 'gzipped sitemap' })
  expect(requested).not.toContain(`${origin}/products/1`)
  expect(report.urls).toEqual(expect.arrayContaining([`${origin}/products/1`, `${origin}/blog/x`]))
})

test('the first URL of each sitemap section is crawled after the start', async () => {
  web[`${origin}/sitemap.xml`] = `<urlset><url><loc>${origin}/products/1</loc></url><url><loc>${origin}/products/2</loc></url></urlset>`
  web[home] = anchors()
  web[`${origin}/products/1`] = anchors()
  const { report } = await crawlSite(site, [site])
  expect(report.pages.map((p) => p.url)).toEqual([home, `${origin}/products/1`])
})

test('stays inside include and the site domain; outside links are only counted', async () => {
  const inc: Site = { ...site, include: '^https://brand\\.test/(?:$|hearing)' }
  web[home] = anchors('/hearing-aids', '/careers', 'https://shop.example/x', 'https://shop.example/y', 'https://apps.apple.com/us/app/x/id123', '/guide.pdf', 'https://docs.cdn.test/a.pdf')
  web[`${origin}/hearing-aids`] = anchors()
  const { report } = await crawlSite(inc, [inc], { budget: 10 })
  expect(report.pages.map((p) => p.url)).toEqual([home, `${origin}/hearing-aids`])
  expect(requested).not.toContain(`${origin}/careers`)
  expect(requested.some((u) => u.includes('shop.example') || u.endsWith('.pdf'))).toBe(false)
  expect(report.outbound[0]).toMatchObject({ domain: 'shop.example', count: 2 })
  expect(report.outbound.map((o) => o.domain)).toContain('apps.apple.com')
  expect(report.pdfHosts.map((p) => p.host).sort()).toEqual(['brand.test', 'docs.cdn.test'])
  expect(report.urls).toEqual(expect.arrayContaining([`${origin}/guide.pdf`, 'https://docs.cdn.test/a.pdf']))
  expect(report.urls).not.toContain(`${origin}/careers`)
})

test('a 429 in the middle ends the crawl of the site: the report keeps what was read, with a refused failure', async () => {
  web[home] = anchors('/hearing-aids', '/support')
  web[`${origin}/hearing-aids`] = { skip: 'rate-limited', detail: 'HTTP 429' }
  web[`${origin}/support`] = anchors()
  vi.mocked(cdx).mockResolvedValue([row('20200101000000')])
  const { report, refused } = await crawlSite(site, [site])
  expect(refused).toBeInstanceOf(SiteRefusedError)
  expect(refused).not.toBeInstanceOf(ArchiveRefusedError)
  expect(refused).toMatchObject({ reason: 'rate-limited', domain: 'brand.test', url: `${origin}/hearing-aids` })
  expect(report.pages.map((p) => p.url)).toEqual([home])
  expect(report.failures.at(-1)).toEqual({ url: `${origin}/hearing-aids`, reason: 'refused', detail: 'rate-limited' })
  // No request to the site after the refusal, and no archive coverage either.
  expect(requested.at(-1)).toBe(`${origin}/hearing-aids`)
  expect(cdx).not.toHaveBeenCalled()
  expect(report.urls).toContain(`${origin}/support`)
})

test('a refusal of robots.txt ends the crawl before any page', async () => {
  web[`${origin}/robots.txt`] = { skip: 'bot-protection', detail: 'HTTP 403' }
  web[home] = anchors()
  const { report, refused } = await crawlSite(site, [site])
  expect(refused).toMatchObject({ reason: 'bot-protection', url: `${origin}/robots.txt` })
  expect(report.pages).toEqual([])
  expect(requested).toEqual([`${origin}/robots.txt`])
})

test('a refusal by web.archive.org stops the step for every site', async () => {
  const arch: Site = { ...site, mode: 'archive' }
  vi.mocked(cdx).mockResolvedValue([row('20210901000000')])
  web[archiveUrl('20210901000000', `${origin}/robots.txt`, { raw: true })] = { skip: 'rate-limited', detail: 'HTTP 429' }
  await expect(crawlSite(arch, [arch])).rejects.toBeInstanceOf(ArchiveRefusedError)
})

test('robots and http-error skips are failures; only requests made use the budget', async () => {
  web[home] = anchors('/blocked', '/missing', '/hearing-aids')
  web[`${origin}/blocked`] = { skip: 'robots', detail: 'disallowed by robots.txt' }
  web[`${origin}/hearing-aids`] = anchors()
  const { report } = await crawlSite(site, [site], { budget: 3 })
  expect(report.failures).toEqual(
    expect.arrayContaining([
      { url: `${origin}/blocked`, reason: 'robots', detail: 'disallowed by robots.txt' },
      { url: `${origin}/missing`, reason: 'http-error', detail: 'HTTP 404' },
    ]),
  )
  // home + hearing-aids + missing = 3 requests; the robots refusal was free, so nothing was left unfetched.
  expect(report.pages.map((p) => p.url)).toEqual([home, `${origin}/hearing-aids`])
})

test('archive mode reads the latest 200 copy and keeps its timestamp on every link', async () => {
  const arch: Site = { ...site, mode: 'archive' }
  vi.mocked(cdx).mockResolvedValue([row('20190301000000'), row('20210601000000'), row('20210901000000'), row('20230101000000', home, '404')])
  const copy = (ts: string, path = '') => archiveUrl(ts, `${origin}${path || '/'}`, { raw: true })
  web[copy('20190301000000')] = anchors('/old')
  web[copy('20210901000000')] = anchors('/hearing-aids', `${archiveUrl('20210901000000', 'https://elsewhere.test/p')}`)
  web[copy('20210901000000', '/hearing-aids')] = anchors()
  web[archiveUrl('20210901000000', `${origin}/robots.txt`, { raw: true })] = 'User-agent: *\nDisallow: /x\n'
  const { report } = await crawlSite(arch, [arch])
  expect(vi.mocked(cdx).mock.calls[0][0]).toMatchObject({ url: home, filters: ['statuscode:200'], from: '2018', collapse: 'timestamp:8' })
  expect(report.pages.map((p) => p.url)).toEqual([copy('20190301000000'), copy('20210901000000'), copy('20210901000000', '/hearing-aids')])
  expect(report.pages[1].archiveTimestamp).toBe('20210901000000')
  expect(requested).not.toContain(`${origin}/robots.txt`)
  expect(report.robots.archived).toMatchObject({ groups: [{ userAgents: ['*'], disallow: ['/x'] }] })
  expect(report.robots.ref).toBeNull()
  expect(report.outbound.map((o) => o.domain)).toEqual(['elsewhere.test'])
  expect(report.urls).toContain(`${origin}/hearing-aids`)
  expect(report.archive.sections[0]).toEqual({ url: home, byYear: { '2019': 1, '2021': 2 }, latest: '20210901000000' })
})

test('archive coverage covers the start, sitemap sections and brand URLs, up to the limit', async () => {
  web[`${origin}/sitemap.xml`] = `<urlset><url><loc>${origin}/products/1</loc></url></urlset>`
  web[home] = anchors()
  web[`${origin}/products/1`] = anchors()
  vi.mocked(cdx).mockResolvedValue([row('20200101000000')])
  const brand = { scraper: { catalogUrls: [`${origin}/catalog`], supportUrls: [`${origin}/help`] } } as never
  const { report } = await crawlSite(site, [site], { brands: [brand] })
  expect(report.archive.sections.map((s) => s.url)).toEqual([home, `${origin}/products`, `${origin}/catalog`, `${origin}/help`])
})

test('a rate-limited CDX answer stops the step; another CDX failure is recorded', async () => {
  web[home] = anchors()
  vi.mocked(cdx).mockRejectedValue(new WaybackError('rate-limited', 'HTTP 429'))
  await expect(crawlSite(site, [site])).rejects.toBeInstanceOf(ArchiveRefusedError)
  await expect(crawlSite(site, [site])).rejects.toMatchObject({ reason: 'rate-limited' })
  vi.mocked(cdx).mockRejectedValue(new WaybackError('robots', 'no'))
  const { report } = await crawlSite(site, [site])
  expect(report.failures.at(-1)).toMatchObject({ url: home, reason: 'robots' })
})

test('observed edges: a redirect to another domain, a PDF host, a link to a listed site', async () => {
  web[home] = anchors('/moved', 'https://www.other.test/page', 'https://apps.apple.com/us/app/x/id1', '/doc.pdf', 'https://cdn.docs.test/m.pdf')
  web[`${origin}/moved`] = { url: 'https://www.new.test/moved', html: anchors() }
  const known: Site[] = [site, other, { ...other, domain: 'apps.apple.com', start: 'https://apps.apple.com/' }]
  const { report, graph } = await crawlSite(site, known)
  expect(report.redirects).toEqual([{ from: `${origin}/moved`, to: 'https://www.new.test/moved', ref: { url: `${origin}/moved`, fetchedAt: FETCHED_AT } }])
  const g = Graph.parse(graph({ entities: [], edges: [] }))
  expect(g.edges.map((e) => `${e.from} ${e.kind} ${e.to}`).sort()).toEqual([
    'domain:brand.test links-to domain:other.test',
    'domain:brand.test redirects-to domain:new.test',
    'domain:cdn.docs.test hosts-documents-for domain:brand.test',
  ])
  for (const edge of g.edges) {
    expect(edge).toMatchObject({ visibility: 'internal', status: 'observed' })
    expect(edge.sources[0]).toMatchObject({ kind: 'crawl', fetchedAt: FETCHED_AT })
  }
})

test('report urls are sorted and capped; the cut keeps the pages read and examples of every template', async () => {
  const many = Array.from({ length: 3100 }, (_, i) => `/p/${String(i).padStart(5, '0')}`)
  // A locale that sorts after the cut.
  const locale = ['/zz-en/hearing-aids/a', '/zz-en/hearing-aids/b', '/zz-en/hearing-aids/c']
  web[home] = anchors(...many, '/zz-hearing', ...locale)
  web[`${origin}/zz-hearing`] = anchors()
  const { report } = await crawlSite(site, [site], { budget: 2 })
  expect(report.urls).toHaveLength(3000)
  expect(report.urls).toEqual([...report.urls].sort())
  expect(report.templates[0]).toMatchObject({ pattern: `${origin}/p/{slug}`, count: 3100 })
  expect(report.templates.map((t) => t.pattern)).toContain(`${origin}/zz-en/hearing-aids/{slug}`)
  expect(report.urls).toEqual(expect.arrayContaining([home, `${origin}/zz-hearing`, ...locale.map((path) => `${origin}${path}`)]))
})

test('parseRobotsTxt reads groups, the wildcard Crawl-delay and sitemaps', () => {
  const parsed = parseRobotsTxt('User-agent: a\nUser-agent: b\nDisallow: /a # c\n\nUser-agent: *\nCrawl-delay: 2\nAllow: /ok\nDisallow:\nSitemap: https://x.test/s.xml\n')
  expect(parsed).toEqual({
    groups: [
      { userAgents: ['a', 'b'], allow: [], disallow: ['/a'] },
      { userAgents: ['*'], allow: ['/ok'], disallow: [] },
    ],
    sitemaps: ['https://x.test/s.xml'],
    crawlDelaySec: 2,
  })
})

test('an off-site redirect is recorded with its edge but the landing page is not this site\'s page', async () => {
  web[home] = anchors('/moved', '/app')
  web[`${origin}/moved`] = { url: 'https://www.new.test/moved', html: anchors('https://other.test/nav') }
  web[`${origin}/app`] = { url: 'https://apps.apple.com/us/app/x/id1', html: anchors() }
  const { report, graph } = await crawlSite(site, [site, other])
  expect(report.pages.map((p) => p.url)).toEqual([home])
  expect(report.urls).not.toContain('https://www.new.test/moved')
  expect(report.outbound.map((o) => o.domain)).not.toContain('other.test')
  expect(report.redirects.map((r) => r.to).sort()).toEqual(['https://apps.apple.com/us/app/x/id1', 'https://www.new.test/moved'])
  const g = Graph.parse(graph({ entities: [], edges: [] }))
  expect(g.edges.map((e) => `${e.from} ${e.kind} ${e.to}`)).toEqual(['domain:brand.test redirects-to domain:new.test'])
})

test('a same-host redirect is not listed', async () => {
  web[home] = anchors('/a')
  web[`${origin}/a`] = { url: `${origin}/a/`, html: anchors() }
  const { report } = await crawlSite(site, [site])
  expect(report.redirects).toEqual([])
  expect(report.pages).toHaveLength(2)
})
