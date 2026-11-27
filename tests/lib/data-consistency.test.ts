import { describe, expect, test } from 'vitest'
import { groupMismatches, liveLinksOfGoneBrands } from '@/src/lib/data/consistency'
import type { Brand } from '@/src/lib/schema/brand'
import type { Edge, Graph } from '@/src/lib/schema/graph'
import { loadDataset, type Dataset } from '@/src/lib/data/load'
import type { Model } from '@/src/lib/schema/model'

test('brand groups agree with the approved owns relations in data/', async () => {
  const { brands, graph } = await loadDataset('data')
  expect(groupMismatches(brands, graph)).toEqual([])
})

test('an ended owner is not compared with the group', () => {
  const brand = { slug: 'phonak', group: 'Sonova' } as Brand
  const edge = (until?: string) => ({ from: 'company:gn', to: 'brand:phonak', kind: 'owns', visibility: 'public', status: 'verified', sources: [], ...(until && { until }) }) as unknown as Edge
  const graph = (e: Edge): Graph => ({ entities: [{ id: 'company:gn', kind: 'company', name: 'GN' }], edges: [e] })
  expect(groupMismatches([brand], graph(edge()))).toHaveLength(1)
  expect(groupMismatches([brand], graph(edge('2021')))).toEqual([])
})

describe('liveLinksOfGoneBrands', () => {
  const brand = (status: 'active' | 'gone') => ({ slug: 'acme', website: 'https://www.acme.test', status }) as Brand
  const field = (sourceUrl: string) => ({ value: 'x', quote: 'x', sourceUrl, fetchedAt: '2026-11-27T10:00:00.000Z', sourceType: 'official' })
  const model = (urls: string[], docs: string[] = []) =>
    ({ brand: 'acme', slug: 'acme-zed', releaseDate: field(urls[0]), variants: [{ weightG: field(urls[1] ?? urls[0]) }], documents: docs.map((url) => ({ url })) }) as unknown as Model

  test('names a live link of a gone brand, with or without www and on a subdomain, and no archive copy', () => {
    const archived = 'https://web.archive.org/web/2020/https://www.acme.test/p'
    const dataset = { brands: [brand('gone')], models: [model(['https://acme.test/p', archived], ['https://shop.acme.test/g.pdf', 'https://example.org/g.pdf'])] }
    expect(liveLinksOfGoneBrands(dataset as unknown as Dataset)).toEqual(['https://acme.test/p', 'https://shop.acme.test/g.pdf'])
  })

  test('names a gone brand\'s live link in a reviews file, in another brand\'s twin source and on its support host', () => {
    const goneBrand = { ...brand('gone'), scraper: { catalogUrls: [], supportUrls: ['https://support.acme-help.test/'], modelUrlPattern: '', render: false } } as unknown as Brand
    const other = { brand: 'zeta', slug: 'zeta-one', variants: [], documents: [], sameHardwareAs: [{ slug: 'acme-zed', source: field('https://acme.test/twin') }] } as unknown as Model
    const reviews = {
      slug: 'acme-zed',
      customer: [{ sourceUrl: 'https://www.acme.test/shop/zed', rating: 4, count: 10, fetchedAt: '2026-11-27T10:00:00.000Z' }],
      complaintThemes: [],
      prosCons: { pros: [{ text: 'x', sources: ['https://support.acme-help.test/faq', 'https://review.example/zed'] }], cons: [] },
      videos: [],
    }
    const dataset = { brands: [goneBrand], models: [other], reviews: [reviews] }
    expect(liveLinksOfGoneBrands(dataset as unknown as Dataset).sort()).toEqual(
      ['https://support.acme-help.test/faq', 'https://acme.test/twin', 'https://www.acme.test/shop/zed'].sort(),
    )
  })

  test('an active brand may link its own site', () => {
    const dataset = { brands: [brand('active')], models: [model(['https://www.acme.test/p'])] }
    expect(liveLinksOfGoneBrands(dataset as unknown as Dataset)).toEqual([])
  })
})

test('data/ has no live link of a gone brand', async () => {
  expect(liveLinksOfGoneBrands(await loadDataset('data'))).toEqual([])
})
