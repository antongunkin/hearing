// @vitest-environment node
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import ModelPage, { generateMetadata } from '@/app/hearing-aids/[slug]/page'
import type { Dataset } from '@/src/lib/data/load'
import { Model } from '@/src/lib/schema/model'

const data = vi.hoisted(() => ({ value: undefined as unknown as Dataset }))
vi.mock('@/src/lib/data/load', () => ({ loadDataset: async () => data.value }))

const cited = <T>(value: T, sourceUrl = 'https://old.example/p') => ({
  value, sourceUrl, quote: 'q', fetchedAt: '2026-11-26T10:00:00.000Z', sourceType: 'official' as const,
})
const brand = (status: 'active' | 'gone') => ({
  slug: 'old', name: 'Old', group: 'Old', website: 'https://www.old.example', imageLicense: 'none' as const, defaultType: 'rx' as const,
  status, scraper: { catalogUrls: [], modelUrlPattern: '', render: false },
})
const model = (slug: string, fields: Record<string, unknown> = {}) =>
  Model.parse({ slug, brand: 'old', name: slug.toUpperCase(), aliases: [], type: 'rx', sameHardwareAs: [], variants: [], ...fields })
const load = (status: 'active' | 'gone', models: Model[]) => {
  data.value = { brands: [brand(status)], models, reviews: [], events: [], pending: [], rejections: [], blocklist: [], comparePairs: [], graph: { entities: [], edges: [] } }
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) })
const render = async (slug: string) => renderToStaticMarkup(createElement('div', null, await ModelPage(params(slug))))

test('a discontinued page without 3 rows or a document is noindex, follow', async () => {
  load('active', [model('old-x', { discontinued: { lastListed: '2022-09', source: cited('X') } })])
  expect((await generateMetadata(params('old-x'))).robots).toEqual({ index: false, follow: true })

  load('active', [model('old-x', {
    discontinued: { source: cited('X') },
    documents: [{ kind: 'datasheet', title: 'Datasheet', url: 'https://old.example/a.pdf', fetchedAt: '2026-11-26T10:00:00.000Z' }],
  })])
  expect((await generateMetadata(params('old-x'))).robots).toBeUndefined()
})

test('shows the banner, the manuals, the lineage and the brand fate of a gone brand', async () => {
  load('gone', [
    model('old-x', {
      discontinued: { lastListed: '2022-09', source: cited('X') },
      predecessor: { slug: 'old-w', source: cited('W') },
      successor: { slug: 'old-y', source: cited('Y') },
      documents: [{ kind: 'datasheet', title: 'Datasheet', url: 'https://web.archive.org/web/20190512id_/https://old.example/a.pdf', fetchedAt: '2026-11-26T10:00:00.000Z' }],
    }),
    model('old-w'),
    model('old-y'),
  ])
  const html = await render('old-x')
  expect(html).toContain('Discontinued — last listed by Old in Sep 2022')
  expect(html).toContain('Manuals &amp; datasheets')
  expect(html).toContain('archived copy, May 2019, via Internet Archive')
  expect(html).toContain('href="/hearing-aids/old-w"')
  expect(html).toContain('href="/hearing-aids/old-y"')
  expect(html).toContain('Old no longer sells hearing aids under its own name.')
  expect(html).toContain('href="/brands/old#what-happened"')
  expect(html).not.toMatch(/AggregateRating|"@type":"Review"/)
})

test('a model on sale shows none of it', async () => {
  load('active', [model('old-x')])
  const html = await render('old-x')
  expect(html).not.toContain('Discontinued')
  expect(html).not.toContain('Manuals')
  expect(html).not.toContain('no longer sells')
})
