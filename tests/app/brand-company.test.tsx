// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import BrandPage from '@/app/brands/[brand]/page'
import type { Dataset } from '@/src/lib/data/load'
import type { Edge } from '@/src/lib/schema/graph'

const data = vi.hoisted(() => ({ value: undefined as unknown as Dataset }))
vi.mock('@/src/lib/data/load', () => ({ loadDataset: async () => data.value }))

const brand = (status: 'active' | 'gone') => ({
  slug: 'old',
  name: 'Old',
  group: 'Old',
  website: 'https://parked.example',
  imageLicense: 'none' as const,
  defaultType: 'rx' as const,
  status,
  scraper: { catalogUrls: [], modelUrlPattern: '', render: false },
  ...(status === 'gone' && { archive: { catalogUrls: ['https://web.archive.org/web/20190301id_/https://parked.example/products'] } }),
})
const src = { url: 'https://gn.example/about', quote: 'GN owns Old', fetchedAt: '2026-11-26T10:00:00.000Z', kind: 'company-page' as const }
const edge = (extra: Partial<Edge>): Edge => ({ from: 'company:gn', to: 'brand:old', kind: 'owns', visibility: 'public', status: 'verified', sources: [src], ...extra })
const render = async (status: 'active' | 'gone', edges: Edge[]) => {
  data.value = {
    brands: [brand(status)], models: [], reviews: [], events: [], pending: [], rejections: [], blocklist: [], comparePairs: [],
    graph: { entities: [{ id: 'company:gn', kind: 'company', name: 'GN' }, { id: 'brand:old', kind: 'brand', name: 'Old' }], edges },
  }
  return renderToStaticMarkup(await BrandPage({ params: Promise.resolve({ brand: 'old' }) }))
}

test('a gone brand never links its live website; only an archive copy', async () => {
  const html = await render('gone', [])
  expect(html).not.toContain('href="https://parked.example')
  expect(html).toContain('href="https://web.archive.org/web/*/https://parked.example"')
  expect(html).toContain('href="https://web.archive.org/web/20190301/https://parked.example/products"')
  expect(await render('active', [])).toContain('href="https://parked.example"')
})

test('the Company block shows public verified edges only', async () => {
  expect(await render('active', [edge({})])).toContain('Owned by GN')
  expect(await render('active', [edge({ visibility: 'internal', status: 'proposed' })])).not.toContain('Company')
})

test('a gone brand\'s Company block does not link a source on its own domain', async () => {
  const html = await render('gone', [edge({ sources: [{ ...src, url: 'https://parked.example/about' }] })])
  expect(html).toContain('Owned by GN')
  expect(html).not.toContain('href="https://parked.example/about"')
})

test('the brand page shows What happened with dated, sourced facts and the app status, for any status', async () => {
  const facts = [
    { date: '2019-03', text: 'Old was sold to Big.', sourceUrl: 'https://web.archive.org/web/20190301id_/https://news.example/a', quote: 'Big buys Old', fetchedAt: '2026-11-26T10:00:00.000Z' },
    { date: '2020', text: 'The brand was retired.', sourceUrl: 'https://shop.parked.example/b', quote: 'retired', fetchedAt: '2026-11-26T10:00:00.000Z' },
    { date: '2021-05', text: 'The site closed.', sourceUrl: 'https://news.example/c', quote: 'closed', fetchedAt: '2026-11-26T10:00:00.000Z' },
  ]
  const app = { name: 'Old App', iosId: '1', available: false, checkedAt: '2026-11-26T10:00:00.000Z', sourceUrl: 'https://itunes.apple.com/lookup?id=1' }
  const withHistory = async (status: 'active' | 'gone', history: unknown) => {
    data.value = {
      brands: [{ ...brand(status), history } as never], models: [], reviews: [], events: [], pending: [], rejections: [], blocklist: [], comparePairs: [],
      graph: { entities: [], edges: [] },
    }
    return renderToStaticMarkup(await BrandPage({ params: Promise.resolve({ brand: 'old' }) }))
  }
  const html = await withHistory('gone', { facts, app })
  expect(html).toContain('id="what-happened"')
  expect(html).toContain('What happened to Old')
  expect(html).toContain('Mar 2019')
  expect(html).toContain('href="https://web.archive.org/web/20190301/https://news.example/a"')
  expect(html).toContain('href="https://news.example/c"')
  // A live page on the gone brand's own domain is named, not linked.
  expect(html).not.toContain('href="https://shop.parked.example/b"')
  expect(html).toContain('Old App is no longer on the App Store (checked Nov 26, 2026).')
  expect(html).toContain('No longer sold under this name')
  expect(html).toContain('Archived website (Internet Archive)')
  expect(html).not.toContain('This brand’s website is gone')

  const active = await withHistory('active', { facts, app: { ...app, available: true } })
  expect(active).toContain('What happened to Old')
  expect(active).toContain('Old App is on the App Store')
  expect((await withHistory('gone', undefined))).not.toContain('What happened')
})
