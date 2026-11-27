import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { CompanyBlock } from '@/src/components/CompanyBlock'
import { Brand } from '@/src/lib/schema/brand'
import type { CompanyBlockData } from '@/src/lib/site/companies'

const at = '2026-11-26T10:00:00.000Z'
const brand = (slug: string, name: string) =>
  Brand.parse({ slug, name, group: name, website: `https://${slug}.example`, imageLicense: 'none', defaultType: 'rx', status: 'active', scraper: { catalogUrls: [], modelUrlPattern: '', render: false } })
const html = (data: CompanyBlockData) => parse(renderToStaticMarkup(<CompanyBlock data={data} brands={[brand('beta', 'Beta')]} />))
const parse = (markup: string) => new DOMParser().parseFromString(markup, 'text/html')

test('a third-party maker source reads "According to <host>"', () => {
  const doc = html({
    siblings: [],
    makers: [{ name: 'Maker Co', sources: [{ url: 'https://www.hearingtracker.com/x', quote: 'q', fetchedAt: at, kind: 'third-party' }] }],
    apps: [],
  })
  expect(doc.body.textContent).toContain('According to www.hearingtracker.com')
})

test('an archived source is linked as an archive copy with its month; owner, siblings and apps are linked', () => {
  const doc = html({
    owner: { name: 'GN', since: '2019', sources: [{ url: 'https://web.archive.org/web/20190301id_/https://gn.example/about', quote: 'q', fetchedAt: at, kind: 'company-page' }] },
    siblings: ['beta'],
    makers: [],
    apps: [{ name: 'App', iosId: '42', androidId: 'com.x', sources: [{ url: 'https://apps.apple.com/app/id42', quote: 'q', fetchedAt: at, kind: 'app-store' }] }],
  })
  const hrefs = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'))
  expect(doc.body.textContent).toContain('Owned by GN since 2019')
  expect(doc.body.textContent).toContain('archived copy, 2019-03')
  expect(hrefs).toContain('https://web.archive.org/web/20190301/https://gn.example/about')
  expect(hrefs).toContain('/brands/beta')
  expect(hrefs).toContain('https://apps.apple.com/app/id42')
  expect(hrefs).toContain('https://play.google.com/store/apps/details?id=com.x')
  expect(doc.body.innerHTML).not.toContain('ld+json')
})

test('crawl and unquoted sources are not shown; a gone brand\'s own host is named, not linked', () => {
  const doc = html({
    siblings: [],
    makers: [],
    apps: [],
    owner: {
      name: 'GN',
      sources: [
        { url: 'https://www.parked.example/about', quote: 'q', fetchedAt: at, kind: 'company-page' },
        { url: 'https://crawl.example/x', fetchedAt: at, kind: 'crawl' },
        { url: 'https://web.archive.org/web/20190301/https://www.parked.example/about', quote: 'q', fetchedAt: at, kind: 'company-page' },
      ],
    },
  })
  const withHost = parse(renderToStaticMarkup(<CompanyBlock data={{ siblings: [], makers: [], apps: [], owner: { name: 'GN', sources: [
    { url: 'https://www.parked.example/about', quote: 'q', fetchedAt: at, kind: 'company-page' },
    { url: 'https://crawl.example/x', fetchedAt: at, kind: 'crawl' },
    { url: 'https://web.archive.org/web/20190301/https://www.parked.example/about', quote: 'q', fetchedAt: at, kind: 'company-page' },
  ] } }} brands={[]} goneHost="parked.example" />))
  expect(doc.body.innerHTML).not.toContain('crawl.example')
  expect([...withHost.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://web.archive.org/web/20190301/https://www.parked.example/about'])
  expect(withHost.body.textContent).toContain('Source: www.parked.example')
})

test('a source on a subdomain of a gone brand\'s host is named, not linked; another domain ending the same way is linked', () => {
  const sources = [
    { url: 'https://shop.parked.example/about', quote: 'q', fetchedAt: at, kind: 'company-page' as const },
    { url: 'https://notparked.example/about', quote: 'q', fetchedAt: at, kind: 'press-release' as const },
  ]
  const doc = parse(renderToStaticMarkup(<CompanyBlock data={{ siblings: [], makers: [], apps: [], owner: { name: 'GN', sources } }} brands={[]} goneHost="www.parked.example" />))
  expect([...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://notparked.example/about'])
  expect(doc.body.textContent).toContain('Source: shop.parked.example')
})
