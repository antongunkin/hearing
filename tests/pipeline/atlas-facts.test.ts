// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { visibleText } from '@/pipeline/fetch/html'
import { isInternal, needsRender, pageFacts, parseSitemap, sections, urlTemplates, type OkPage } from '@/pipeline/atlas/facts'
import { Sites, type Site } from '@/pipeline/atlas/schema'

const site: Site = {
  domain: 'brand.test',
  start: 'https://brand.test/',
  kind: 'brand',
  mode: 'live',
  brands: ['brand-one'],
}

const page = (url: string, html: string): OkPage => ({
  status: 'ok',
  url,
  text: visibleText(html),
  html,
  contentHash: 'hash',
  fetchedAt: '2026-11-27T10:00:00.000Z',
  contentType: 'text/html',
})

describe('atlas page facts', () => {
  test('urlTemplates groups sibling paths of three or more', () => {
    expect(urlTemplates(['/hearing-aids/a', '/hearing-aids/b', '/hearing-aids/c', '/about'].map((p) => `https://x.test${p}`))).toEqual([
      { pattern: 'https://x.test/hearing-aids/{slug}', count: 3, examples: ['https://x.test/hearing-aids/a', 'https://x.test/hearing-aids/b', 'https://x.test/hearing-aids/c'] },
    ])
  })

  test('urlTemplates turns a digits-only parent segment into {n}', () => {
    const urls = ['/news/2020/a', '/news/2021/b', '/news/2022/c'].map((p) => `https://x.test${p}`)
    expect(urlTemplates(urls)).toEqual([
      { pattern: 'https://x.test/news/{n}/{slug}', count: 3, examples: ['https://x.test/news/2020/a', 'https://x.test/news/2021/b', 'https://x.test/news/2022/c'] },
    ])
  })

  test('needsRender: little text and mostly script', () => {
    expect(needsRender(`<div id=app></div><script>${'x'.repeat(5000)}</script>`, '')).toBe(true)
    expect(needsRender('<p>…long article…</p>', 'a'.repeat(3000))).toBe(false)
    const externals = [1, 2, 3, 4, 5].map((n) => `<script src="/s${n}.js"></script>`).join('')
    expect(needsRender(`<p>short</p>${externals}`, 'short')).toBe(true)
  })

  test('pageFacts splits internal and external links, PDFs, app links and JSON-LD types', () => {
    const html = `<html><head><title>Brand Pro</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product"}</script>
      <script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":["Brand","Thing"]}]}</script>
      </head><body>
      <a href="/hearing-aids/a">A</a>
      <a href="https://brand.test/support#faq">Support</a>
      <a href="https://shop.example/p">Shop</a>
      <a href="/manual.pdf">Manual</a>
      <a href="https://apps.apple.com/us/app/brand/id1000000000">iOS</a>
      <a href="https://play.google.com/store/apps/details?id=com.brand.app">Android</a>
      </body></html>`
    expect(pageFacts(page('https://brand.test/', html), site)).toEqual({
      url: 'https://brand.test/',
      ref: { url: 'https://brand.test/', fetchedAt: '2026-11-27T10:00:00.000Z' },
      title: 'Brand Pro',
      internalLinks: 2,
      external: [
        'https://shop.example/p',
        'https://apps.apple.com/us/app/brand/id1000000000',
        'https://play.google.com/store/apps/details?id=com.brand.app',
      ],
      pdfs: ['https://brand.test/manual.pdf'],
      apps: { ios: ['1000000000'], android: ['com.brand.app'] },
      jsonLdTypes: ['Product', 'Organization', 'Brand', 'Thing'],
      needsRender: false,
    })
  })

  test('pageFacts of an archive copy resolves links against the original URL', () => {
    const archived = 'https://web.archive.org/web/20200101000000id_/https://brand.test/hearing-aids/'
    const html = `<html><body>
      <a href="/hearing-aids/a">A</a>
      <a href="https://web.archive.org/web/2019/https://brand.test/about">About</a>
      <a href="https://shop.example/p">Shop</a>
      <a href="/guide.pdf">Guide</a>
      </body></html>`
    const facts = pageFacts(page(archived, html), site)
    expect(facts.archiveTimestamp).toBe('20200101000000')
    expect(facts.ref).toEqual({ url: archived, fetchedAt: '2026-11-27T10:00:00.000Z' })
    expect(facts.internalLinks).toBe(2)
    expect(facts.external).toEqual(['https://shop.example/p'])
    expect(facts.pdfs).toEqual(['https://brand.test/guide.pdf'])
  })

  test('parseSitemap tells an index from a URL set', () => {
    const set = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://brand.test/a?x=1&amp;y=2</loc></url><url><loc>https://brand.test/b</loc></url></urlset>`
    expect(parseSitemap(set)).toEqual({ urls: ['https://brand.test/a?x=1&y=2', 'https://brand.test/b'], sitemaps: [] })
    const index = `<sitemapindex><sitemap><loc>https://brand.test/s1.xml</loc></sitemap><sitemap><loc>https://brand.test/s2.xml</loc></sitemap></sitemapindex>`
    expect(parseSitemap(index)).toEqual({ urls: [], sitemaps: ['https://brand.test/s1.xml', 'https://brand.test/s2.xml'] })
  })

  test('parseSitemap reads a loc written as CDATA', () => {
    const set = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc><![CDATA[https://brand.test/a?x=1&y=2]]></loc></url>
      <url><loc> <![CDATA[ https://brand.test/b ]]> </loc></url></urlset>`
    expect(parseSitemap(set)).toEqual({ urls: ['https://brand.test/a?x=1&y=2', 'https://brand.test/b'], sitemaps: [] })
    expect(parseSitemap(`<sitemapindex><sitemap><loc><![CDATA[https://brand.test/s.xml]]></loc></sitemap></sitemapindex>`).sitemaps).toEqual(['https://brand.test/s.xml'])
  })

  test('parseSitemap ignores image, video and news locations', () => {
    const images = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc>https://brand.test/hearing-aids/a</loc>
        <image:image><image:loc>https://cdn.brand.test/a.jpg</image:loc></image:image></url></urlset>`
    expect(parseSitemap(images)).toEqual({ urls: ['https://brand.test/hearing-aids/a'], sitemaps: [] })
  })

  test('parseSitemap keeps a loc under a prefix bound to the sitemap namespace', () => {
    const prefixed = `<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://brand.test/p</sm:loc></sm:url></sm:urlset>`
    expect(parseSitemap(prefixed)).toEqual({ urls: ['https://brand.test/p'], sitemaps: [] })
  })

  test('parseSitemap does not throw on a numeric entity outside Unicode', () => {
    const bad = `<urlset><url><loc>https://brand.test/a&#99999999;b</loc></url><url><loc>https://brand.test/ok</loc></url></urlset>`
    expect(() => parseSitemap(bad)).not.toThrow()
    expect(parseSitemap(bad).urls).toContain('https://brand.test/ok')
  })

  test('sections counts URLs by first path segment, most first', () => {
    expect(sections(['https://brand.test/', 'https://brand.test/hearing-aids/a', 'https://brand.test/hearing-aids/b', 'https://brand.test/about'])).toEqual([
      { path: '/hearing-aids', count: 2 },
      { path: '/', count: 1 },
      { path: '/about', count: 1 },
    ])
  })

  test('isInternal accepts the domain and its subdomains only', () => {
    expect(isInternal(new URL('https://shop.brand.test/x'), site)).toBe(true)
    expect(isInternal(new URL('https://brand.test/x'), site)).toBe(true)
    expect(isInternal(new URL('https://notbrand.test/x'), site)).toBe(false)
  })

  test('Sites rejects a duplicate domain', () => {
    expect(Sites.safeParse([site]).success).toBe(true)
    expect(Sites.safeParse([site, { ...site, kind: 'group' }]).success).toBe(false)
  })
})
