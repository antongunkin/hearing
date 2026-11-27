// The budgeted crawl of one site: robots.txt, sitemaps, a breadth-first walk of its pages, Web Archive
// coverage, and the domain edges the walk observed. Every request goes through fetchPage (or cdx, which does).
import { config } from '@/pipeline/config'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { linksIn } from '@/pipeline/fetch/html'
import { cdx, copiesPerYear, lastCopyPerYear, WaybackError, type CdxRow } from '@/pipeline/sources/wayback'
import { archiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import type { Brand } from '@/src/lib/schema/brand'
import type { Edge, Graph } from '@/src/lib/schema/graph'
import { isInternal, pageFacts, parseSitemap, sections, urlTemplates, type OkPage } from './facts'
import { upsertEdge, upsertEntity } from './graph-store'
import type { PageFacts, RobotsGroup, Site, SiteReport } from './schema'

/** The step stops: the site (or the archive) asked us to slow down or keep out. Resumable. */
export class SiteRefusedError extends Error {
  readonly domain: string
  readonly url: string
  readonly reason: 'rate-limited' | 'bot-protection'

  constructor(domain: string, url: string, reason: 'rate-limited' | 'bot-protection') {
    super(`${domain} refused ${url}: ${reason}`)
    this.name = 'SiteRefusedError'
    this.domain = domain
    this.url = url
    this.reason = reason
  }
}

type Ref = { url: string; fetchedAt: string }
type Failure = SiteReport['failures'][number]
type Skipped = Extract<FetchResult, { status: 'skipped' }>

export type CrawlOptions = {
  refresh?: boolean
  /** Pages to request; `config.atlas.pageBudget` when omitted. */
  budget?: number
  /** The site's brands, for the archive coverage of their catalog and support URLs. */
  brands?: Brand[]
}

/** Paths that probably lead to product and support pages are requested first within a level. */
const CATALOG_LIKE = /hearing|product|aid|support|guide|manual|download|document|app|catalog/i
/** Files that are not pages: never requested, and not listed as pages either. */
const ASSET = /\.(?:jpe?g|png|gif|svg|webp|ico|zip|docx?|xlsx?|pptx?|mp[34]|mov|css|js|json|xml)$/i
const PDF = /\.pdf$/i
const APP_STORES = ['apps.apple.com', 'itunes.apple.com', 'play.google.com']
const SAMPLE_LIMIT = 3
const ENTITY_KEY = /^[a-z0-9][a-z0-9.-]*$/

const bare = (host: string) => host.replace(/^www\./, '')

/** App store hosts are facts about apps, not candidate sites or domain edges. */
export const isAppStoreHost = (host: string) => APP_STORES.some((store) => host === store || host.endsWith(`.${store}`))

const hostOf = (url: string) => URL.parse(url)?.hostname ?? ''

/** Robots.txt: its groups, the Crawl-delay of the `*` group and every `Sitemap:` line. */
export function parseRobotsTxt(text: string): { groups: RobotsGroup[]; sitemaps: string[]; crawlDelaySec?: number } {
  const groups: (RobotsGroup & { delay?: number })[] = []
  const sitemaps: string[] = []
  let current: (RobotsGroup & { delay?: number }) | undefined
  let hasRules = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (field === 'sitemap') {
      if (value) sitemaps.push(value)
    } else if (field === 'user-agent') {
      if (!current || hasRules) {
        current = { userAgents: [], allow: [], disallow: [] }
        groups.push(current)
        hasRules = false
      }
      current.userAgents.push(value)
    } else if (current && (field === 'allow' || field === 'disallow' || field === 'crawl-delay')) {
      hasRules = true
      if (field === 'crawl-delay') {
        const delay = Number(value)
        if (Number.isFinite(delay) && delay >= 0) current.delay = delay
      } else if (value) current[field].push(value)
    }
  }
  const star = groups.find((group) => group.userAgents.includes('*'))
  return {
    groups: groups.map(({ userAgents, allow, disallow }) => ({ userAgents, allow, disallow })),
    sitemaps,
    ...(star?.delay !== undefined && { crawlDelaySec: star.delay }),
  }
}

/** Sitemap URLs and section keys: the first URL of each section seeds the crawl. */
const sectionOf = (url: string) => sections([url])[0]?.path ?? '/'

/** Archive requests that were refused for rate or protection stop the step; the rest is a failure entry. */
const isRefusal = (reason: string): reason is 'rate-limited' | 'bot-protection' => reason === 'rate-limited' || reason === 'bot-protection'

type Item = { original: string; request: string }

export async function crawlSite(
  site: Site,
  known: Site[],
  opts: CrawlOptions = {},
): Promise<{ report: SiteReport; graph: (g: Graph) => Graph }> {
  const budget = opts.budget ?? config.atlas.pageBudget
  const refresh = opts.refresh
  const archive = site.mode === 'archive'
  const include = site.include === undefined ? undefined : new RegExp(site.include)
  const origin = new URL(site.start).origin
  const sinceYear = config.onSaleSince.slice(0, 4)
  const failures: Failure[] = []
  const urls = new Set<string>()
  const pages: PageFacts[] = []

  /** One request through the fetcher. A refusal for rate or protection stops the step. */
  const load = async (url: string): Promise<FetchResult> => {
    const result = await fetchPage(url, { refresh })
    if (result.status === 'skipped' && isRefusal(result.reason)) throw new SiteRefusedError(site.domain, url, result.reason)
    return result
  }
  const fail = (url: string, result: Skipped) =>
    failures.push({ url, reason: result.reason, ...(result.detail !== undefined && { detail: result.detail }) })
  const cdxRows = async (url: string): Promise<CdxRow[] | undefined> => {
    try {
      return await cdx({ url, filters: ['statuscode:200'], from: sinceYear, collapse: 'timestamp:8' }, { refresh })
    } catch (error) {
      if (!(error instanceof WaybackError)) throw error
      if (isRefusal(error.reason)) throw new SiteRefusedError(site.domain, url, error.reason)
      failures.push({ url, reason: error.reason, detail: error.message })
      return undefined
    }
  }

  // 4. Archive mode: one copy of the start page per year; the latest is where the walk begins.
  let timestamp: string | undefined
  let startRows: CdxRow[] | undefined
  let copies: CdxRow[] = []
  if (archive) {
    startRows = await cdxRows(site.start)
    copies = lastCopyPerYear(startRows ?? [], Number(sinceYear))
    if (startRows && copies.length === 0) failures.push({ url: site.start, reason: 'no-archive-copy' })
    timestamp = copies.at(-1)?.timestamp
  }
  const requestFor = (original: string) => (timestamp === undefined ? original : archiveUrl(timestamp, original, { raw: true }))

  // 1. robots.txt
  const robots: SiteReport['robots'] = { ref: null, status: null, sitemaps: [], groups: [] }
  if (!archive) {
    const file = await load(`${origin}/robots.txt`)
    if (file.status === 'ok') {
      Object.assign(robots, { ref: { url: file.url, fetchedAt: file.fetchedAt }, status: 200 }, parseRobotsTxt(file.text))
    } else {
      fail(`${origin}/robots.txt`, file)
      const status = /HTTP (\d{3})/.exec(file.detail ?? '')?.[1]
      if (status) robots.status = Number(status)
    }
  } else if (timestamp !== undefined) {
    const file = await load(archiveUrl(timestamp, `${origin}/robots.txt`, { raw: true }))
    if (file.status === 'ok') {
      robots.archived = { ref: { url: file.url, fetchedAt: file.fetchedAt }, groups: parseRobotsTxt(file.text).groups }
    } else fail(`${origin}/robots.txt`, file)
  }

  // 2. Sitemaps: counted, never fetched page by page.
  const sitemapRefs: Ref[] = []
  const listed = new Set<string>()
  if (!archive) {
    const queue = robots.sitemaps.length > 0 ? [...robots.sitemaps] : [`${origin}/sitemap.xml`]
    const queued = new Set(queue)
    for (let fetched = 0; queue.length > 0 && fetched < config.atlas.sitemapBudget; ) {
      const url = queue.shift()!
      if (/\.gz$/i.test(URL.parse(url, origin)?.pathname ?? url)) {
        failures.push({ url, reason: 'unsupported', detail: 'gzipped sitemap' })
        continue
      }
      fetched++
      const file = await load(url)
      if (file.status !== 'ok') {
        fail(url, file)
        continue
      }
      sitemapRefs.push({ url: file.url, fetchedAt: file.fetchedAt })
      const parsed = parseSitemap(file.html ?? file.text)
      for (const next of parsed.sitemaps) if (!queued.has(next)) (queued.add(next), queue.push(next))
      for (const entry of parsed.urls) {
        const target = URL.parse(entry)
        if (target && isInternal(target, site) && (!include || include.test(target.href))) listed.add(target.href)
      }
    }
  }
  for (const url of listed) urls.add(url)
  const sitemapSections = sections([...listed])

  // 3. Breadth-first walk.
  const startUrl = archive ? (copies.at(-1)?.original ?? site.start) : site.start
  const seeds = new Map<string, string>()
  for (const url of listed) if (!seeds.has(sectionOf(url))) seeds.set(sectionOf(url), url)

  const seen = new Set<string>()
  const outbound = new Map<string, { count: number; examples: string[] }>()
  const pdfs = new Set<string>()
  const linkRefs = new Map<string, Ref>()
  const pdfRefs = new Map<string, Ref>()
  const redirects: SiteReport['redirects'] = []
  const redirectEdges: { to: string; ref: Ref }[] = []
  let requests = 0

  const note = (map: Map<string, { count: number; examples: string[] }>, host: string, url: string) => {
    const entry = map.get(host) ?? { count: 0, examples: [] }
    entry.count++
    if (entry.examples.length < SAMPLE_LIMIT && !entry.examples.includes(url)) entry.examples.push(url)
    map.set(host, entry)
  }
  const pdfHosts = new Map<string, { count: number; examples: string[] }>()

  /** Records one page's facts; returns the internal links the walk may follow. */
  const record = (page: OkPage): string[] => {
    const facts = pageFacts(page, site)
    pages.push(facts)
    const parsed = parseArchiveUrl(page.url)
    urls.add(parsed?.original ?? page.url)
    for (const target of facts.external) {
      const host = bare(hostOf(target))
      if (!host || config.archiveHosts.includes(host)) continue
      note(outbound, host, target)
      if (!linkRefs.has(host)) linkRefs.set(host, facts.ref)
    }
    for (const target of facts.pdfs) {
      pdfs.add(target)
      urls.add(target)
      const host = bare(hostOf(target))
      note(pdfHosts, host, target)
      if (!pdfRefs.has(host)) pdfRefs.set(host, facts.ref)
    }
    if (page.html === undefined) return []
    const base = parsed?.original ?? page.url
    const follow: string[] = []
    for (const link of linksIn(page.html, base)) {
      const target = URL.parse(parseArchiveUrl(link)?.original ?? link)
      if (!target || !isInternal(target, site) || PDF.test(target.pathname) || ASSET.test(target.pathname)) continue
      if (include && !include.test(target.href)) continue
      urls.add(target.href)
      follow.push(target.href)
    }
    return follow
  }

  /** Fetches one page of the walk; undefined when it gave nothing. */
  const visit = async (item: Item, counted: boolean): Promise<OkPage | undefined> => {
    const result = await load(item.request)
    // A request that was made counts, whatever it answered; a refusal by robots or the blocklist is not one.
    if (counted && (result.status === 'ok' || result.reason === 'http-error')) requests++
    if (result.status !== 'ok') {
      fail(item.original, result)
      return undefined
    }
    return result
  }

  const early = copies.slice(0, -1)
  for (const copy of early) {
    // The yearly samples are only recorded; they do not use the page budget.
    const page = await visit({ original: copy.original, request: archiveUrl(copy.timestamp, copy.original, { raw: true }) }, false)
    if (page) record(page)
  }

  if (!archive || timestamp !== undefined) {
    const first: Item = { original: new URL(startUrl).href, request: requestFor(new URL(startUrl).href) }
    seen.add(first.original)
    let level: Item[] = [first]
    for (const url of seeds.values()) {
      if (seen.has(url)) continue
      seen.add(url)
      level.push({ original: url, request: requestFor(url) })
    }
    let firstLevel = true
    while (level.length > 0 && requests < budget) {
      const head = firstLevel ? level.splice(0, 1) : []
      const rank = (item: Item) => (CATALOG_LIKE.test(new URL(item.original).pathname) ? 0 : 1)
      level = [...head, ...[...level].sort((a, b) => rank(a) - rank(b))]
      firstLevel = false
      const next: Item[] = []
      for (const item of level) {
        if (requests >= budget) break
        const page = await visit(item, true)
        if (!page) continue
        const finalUrl = parseArchiveUrl(page.url)?.original ?? page.url
        seen.add(finalUrl)
        const landed = URL.parse(page.url)
        if (!archive && landed && landed.hostname !== new URL(item.request).hostname) {
          const ref = { url: item.request, fetchedAt: page.fetchedAt }
          redirects.push({ from: item.request, to: page.url, ref })
          if (!isInternal(landed, site)) {
            // Someone else's page: not this site's page, and its links are not this site's links.
            const host = bare(landed.hostname)
            if (ENTITY_KEY.test(host) && !isAppStoreHost(host)) redirectEdges.push({ to: host, ref })
            continue
          }
        }
        for (const link of record(page)) {
          if (seen.has(link)) continue
          seen.add(link)
          next.push({ original: link, request: requestFor(link) })
        }
      }
      level = next
    }
  }

  // 5. Archive coverage of the key URLs.
  const keyUrls = [site.start]
  for (const { path } of sitemapSections) if (path !== '/') keyUrls.push(`${origin}${path}`)
  for (const brand of opts.brands ?? []) keyUrls.push(...brand.scraper.catalogUrls, ...(brand.scraper.supportUrls ?? []))
  const coverage: SiteReport['archive']['sections'] = []
  for (const url of [...new Set(keyUrls)].slice(0, config.atlas.cdxSections)) {
    const rows = url === site.start && startRows ? startRows : await cdxRows(url)
    if (!rows) continue
    const latest = rows.filter((row) => row.statusCode === '200').at(-1)?.timestamp
    coverage.push({ url, byYear: copiesPerYear(rows, Number(sinceYear)), ...(latest !== undefined && { latest }) })
  }

  // 6. Summaries.
  const all = [...urls]
  const byCount = (a: { count: number; name: string }, b: { count: number; name: string }) =>
    b.count - a.count || a.name.localeCompare(b.name)
  const report: SiteReport = {
    domain: site.domain,
    generatedAt: new Date().toISOString(),
    mode: site.mode,
    start: site.start,
    budget,
    robots,
    sitemap: { refs: sitemapRefs, urlCount: listed.size, sections: sitemapSections },
    pages,
    templates: urlTemplates(all),
    outbound: [...outbound]
      .map(([domain, v]) => ({ domain, ...v }))
      .sort((a, b) => byCount({ ...a, name: a.domain }, { ...b, name: b.domain })),
    redirects,
    pdfHosts: [...pdfHosts]
      .map(([host, v]) => ({ host, ...v }))
      .sort((a, b) => byCount({ ...a, name: a.host }, { ...b, name: b.host })),
    archive: { sections: coverage },
    failures,
    urls: all.sort().slice(0, config.atlas.maxReportUrls),
  }

  // 7. Observed edges.
  const edges: { from: string; to: string; kind: Edge['kind']; ref: Ref }[] = []
  const self = site.domain
  for (const { to, ref } of redirectEdges) edges.push({ from: self, to, kind: 'redirects-to', ref })
  for (const [host, ref] of pdfRefs) {
    const url = URL.parse(`https://${host}`)
    if (url && ENTITY_KEY.test(host) && !isInternal(url, site) && !isAppStoreHost(host)) edges.push({ from: host, to: self, kind: 'hosts-documents-for', ref })
  }
  for (const [host, ref] of linkRefs) {
    if (isAppStoreHost(host)) continue
    const target = known.find((other) => other.domain !== self && (host === other.domain || host.endsWith(`.${other.domain}`)))
    if (target) edges.push({ from: self, to: target.domain, kind: 'links-to', ref })
  }

  const graph = (g: Graph): Graph => {
    let next = g
    for (const { from, to, kind, ref } of edges) {
      for (const domain of [from, to]) next = upsertEntity(next, { id: `domain:${domain}`, kind: 'domain', name: domain })
      next = upsertEdge(next, {
        from: `domain:${from}`,
        to: `domain:${to}`,
        kind,
        visibility: 'internal',
        status: 'observed',
        sources: [{ url: ref.url, fetchedAt: ref.fetchedAt, kind: 'crawl' }],
      })
    }
    return next
  }
  return { report, graph }
}
