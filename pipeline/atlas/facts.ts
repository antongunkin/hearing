import { JSDOM, VirtualConsole } from 'jsdom'
import { appStoreLinks, jsonLd, linksIn, pageTitle } from '@/pipeline/fetch/html'
import type { FetchResult } from '@/pipeline/fetch/fetcher'
import { parseArchiveUrl } from '@/src/lib/archive-url'
import type { PageFacts, Site, UrlTemplate } from './schema'

/** A successful `fetchPage` result. */
export type OkPage = Extract<FetchResult, { status: 'ok' }>

/** Whether the URL's host is the site's domain or a subdomain of it. */
export function isInternal(url: URL, site: Site): boolean {
  const host = url.hostname
  return host === site.domain || host.endsWith(`.${site.domain}`)
}

/** A link inside a Web Archive copy points at the page it archives. */
const unwrap = (link: string) => parseArchiveUrl(link)?.original ?? link

/** The `@type` values of every JSON-LD node, including those inside `@graph`. */
function typesOf(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) typesOf(item, out)
    return
  }
  if (node === null || typeof node !== 'object') return
  const { '@type': type, '@graph': graph } = node as Record<string, unknown>
  for (const value of [type].flat()) if (typeof value === 'string') out.add(value)
  if (graph !== undefined) typesOf(graph, out)
}

/**
 * Whether the page is mostly script with little text, so that a plain fetch misses its content:
 * under 1500 characters of text and either inline script of at least half the page's bytes or five
 * or more external scripts.
 */
export function needsRender(html: string, text: string): boolean {
  if (text.length >= 1500) return false
  const { document } = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window
  const inline = [...document.querySelectorAll('script:not([src])')].reduce(
    (bytes, script) => bytes + Buffer.byteLength(script.textContent ?? ''),
    0,
  )
  const external = document.querySelectorAll('script[src]').length
  return inline >= Buffer.byteLength(html) / 2 || external >= 5
}

/** What one fetched page says about the site: its links, documents, companion apps and structured data. */
export function pageFacts(page: OkPage, site: Site): PageFacts {
  const archive = parseArchiveUrl(page.url)
  // Links of an archive copy resolve against the page the copy archives, not against the archive.
  const base = archive?.original ?? page.url
  const html = page.html
  const facts: PageFacts = {
    url: page.url,
    ref: { url: page.url, fetchedAt: page.fetchedAt },
    ...(archive && { archiveTimestamp: archive.timestamp }),
    internalLinks: 0,
    external: [],
    pdfs: [],
    apps: { ios: [], android: [] },
    jsonLdTypes: [],
    needsRender: false,
  }
  if (html === undefined) return facts

  const title = pageTitle(html)
  if (title !== undefined) facts.title = title

  const targets = [...new Set(linksIn(html, base).map(unwrap))]
  for (const target of targets) {
    const url = URL.parse(target)
    if (!url) continue
    if (/\.pdf$/i.test(url.pathname)) facts.pdfs.push(target)
    else if (isInternal(url, site)) facts.internalLinks++
    else facts.external.push(target)
  }

  facts.apps = appStoreLinks(html, base)

  const types = new Set<string>()
  for (const block of jsonLd(html)) typesOf(block, types)
  facts.jsonLdTypes = [...types]

  facts.needsRender = needsRender(html, page.text)
  return facts
}

const isDigits = (segment: string) => /^\d+$/.test(segment)

/**
 * Patterns for the URLs that sit as siblings: the URLs of one host whose paths share every segment but
 * the last. A group of at least `minCount` becomes `<parent>/{slug}`; a digits-only parent segment becomes
 * `{n}`. Largest group first.
 */
export function urlTemplates(urls: string[], minCount = 3): UrlTemplate[] {
  const groups = new Map<string, string[]>()
  for (const raw of new Set(urls)) {
    const url = URL.parse(raw)
    if (!url) continue
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length === 0) continue
    const parent = segments.slice(0, -1).map((segment) => (isDigits(segment) ? '{n}' : segment))
    const pattern = `${url.origin}${parent.map((segment) => `/${segment}`).join('')}/{slug}`
    groups.set(pattern, [...(groups.get(pattern) ?? []), raw])
  }
  return [...groups]
    .filter(([, members]) => members.length >= minCount)
    .map(([pattern, members]) => ({
      pattern,
      count: members.length,
      examples: members.sort().slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern))
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** The `<loc>` values of a sitemap, entities decoded, HTTP(S) URLs only. */
function locs(xml: string): string[] {
  const values = [...xml.matchAll(/<(?:\w+:)?loc>\s*([^<]*?)\s*<\/(?:\w+:)?loc>/g)].map((match) =>
    match[1].replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, name: string) => {
      if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10))
      return XML_ENTITIES[name.toLowerCase()] ?? entity
    }),
  )
  return values.filter((value) => {
    const url = URL.parse(value)
    return url !== null && /^https?:$/.test(url.protocol)
  })
}

/** A sitemap index lists sitemaps; a URL set lists pages. Anything else yields nothing. */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  if (/<(?:\w+:)?sitemapindex[\s>]/i.test(xml)) return { urls: [], sitemaps: locs(xml) }
  if (/<(?:\w+:)?urlset[\s>]/i.test(xml)) return { urls: locs(xml), sitemaps: [] }
  return { urls: [], sitemaps: [] }
}

/** The URLs grouped by their first path segment, most URLs first. A URL with no path segment is `/`. */
export function sections(urls: string[]): { path: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const raw of urls) {
    const url = URL.parse(raw)
    if (!url) continue
    const first = url.pathname.split('/').filter(Boolean)[0]
    const path = first === undefined ? '/' : `/${first}`
    counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  return [...counts]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
}
