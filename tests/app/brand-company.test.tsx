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
  expect(html).not.toContain('https://parked.example"')
  expect(html).toContain('href="https://web.archive.org/web/20190301/https://parked.example/products"')
  expect(await render('active', [])).toContain('href="https://parked.example"')
})

test('the Company block shows public verified edges only', async () => {
  expect(await render('active', [edge({})])).toContain('Owned by GN')
  expect(await render('active', [edge({ visibility: 'internal', status: 'proposed' })])).not.toContain('Company')
})
