import { afterEach, describe, expect, test, vi } from 'vitest'
import robots from '@/app/robots'
import type { Dataset } from '@/src/lib/data/load'
import { Brand } from '@/src/lib/schema/brand'
import { Event } from '@/src/lib/schema/event'
import { Model } from '@/src/lib/schema/model'
import { Reviews } from '@/src/lib/schema/reviews'
import { buildSitemapEntries } from '@/src/lib/site/sitemap-entries'

afterEach(() => {
  vi.unstubAllEnvs()
})

const BASE = 'https://site.example'

const cited = <T>(value: T, fetchedAt: string) => ({
  value,
  sourceUrl: 'https://maker.example/spec',
  quote: 'q',
  fetchedAt,
  sourceType: 'official' as const,
})

const model = (slug: string, fields: Record<string, unknown> = {}) =>
  Model.parse({ slug, brand: 'acme', name: slug, aliases: [], type: 'otc', sameHardwareAs: [], variants: [], ...fields })

/** Twelve equal models: each is compared with the ten first of the others, so m-10 and m-11 are not. */
const models = Array.from({ length: 12 }, (_, i) => model(`m-${String(i).padStart(2, '0')}`))

const dataset = (fields: Partial<Dataset> = {}): Dataset => ({
  brands: [
    Brand.parse({
      slug: 'acme',
      name: 'Acme',
      group: 'Acme',
      website: 'https://maker.example',
      imageLicense: 'none',
      defaultType: 'rx',
      status: 'active',
      scraper: { catalogUrls: [], modelUrlPattern: '/x/', render: false },
    }),
  ],
  models,
  reviews: [],
  events: [],
  pending: [],
  rejections: [],
  blocklist: [],
  comparePairs: [],
  graph: { entities: [], edges: [] },
  ...fields,
})

const urls = (data: Dataset) => buildSitemapEntries(data, BASE).map((entry) => entry.url)

describe('buildSitemapEntries', () => {
  test('a brand page with no models is left out', () => {
    const empty = Brand.parse({ ...dataset().brands[0], slug: 'empty', name: 'Empty' })
    const listed = urls(dataset({ brands: [...dataset().brands, empty] }))

    expect(listed).toContain(`${BASE}/brands/acme`)
    expect(listed).not.toContain(`${BASE}/brands/empty`)
  })

  test('sitemap includes curated pair, excludes non-curated pair and /compare tool', () => {
    const listed = urls(dataset())

    expect(listed).toContain(`${BASE}/compare/m-00-vs-m-01`)
    expect(listed).not.toContain(`${BASE}/compare/m-10-vs-m-11`)
    expect(listed).not.toContain(`${BASE}/compare`)
    expect(listed.filter((url) => url.includes('models.json'))).toEqual([])
  })

  test('keeps a recorded pair while both its models exist', () => {
    const listed = urls(dataset({ comparePairs: ['m-10-vs-m-11', 'm-11-vs-m-gone'] }))

    expect(listed).toContain(`${BASE}/compare/m-10-vs-m-11`)
    expect(listed).not.toContain(`${BASE}/compare/m-11-vs-m-gone`)
  })

  test('/companies is in the sitemap only with a verified ownership record', () => {
    const src = { url: 'https://gn.example/about', quote: 'q', fetchedAt: '2026-05-01T00:00:00.000Z', kind: 'company-page' as const }
    const entities = [
      { id: 'company:gn', kind: 'company' as const, name: 'GN' },
      { id: 'brand:acme', kind: 'brand' as const, name: 'Acme' },
    ]
    const edge = { from: 'company:gn', to: 'brand:acme', kind: 'owns' as const, visibility: 'public' as const, status: 'verified' as const, sources: [src] }

    expect(urls(dataset())).not.toContain(`${BASE}/companies`)
    expect(urls(dataset({ graph: { entities, edges: [{ ...edge, visibility: 'internal', status: 'proposed' }] } }))).not.toContain(`${BASE}/companies`)
    const listed = buildSitemapEntries(dataset({ graph: { entities, edges: [edge] } }), BASE)
    expect(listed.find((e) => e.url === `${BASE}/companies`)).toEqual({ url: `${BASE}/companies`, lastModified: src.fetchedAt })
  })

  test('sitemap never includes /review', () => {
    expect(urls(dataset()).filter((url) => url.includes('/review'))).toEqual([])
  })

  test('lists every page once: home, catalog, models, brands, platforms, news, events and the service pages', () => {
    const event = Event.parse({
      id: 'e-1',
      type: 'new-model',
      modelSlug: 'm-00',
      date: '2026-03-02',
      key: 'm-00',
      text: 'Added.',
      sources: [],
    })
    const listed = urls(dataset({ events: [event] }))

    for (const path of [
      '/',
      '/hearing-aids',
      '/hearing-aids/m-00',
      '/hearing-aids/m-11',
      '/brands/acme',
      '/platforms',
      '/news',
      '/news/e-1',
      '/methodology',
      '/not-medical-advice',
      '/corrections',
      '/privacy',
      '/about-bot',
    ]) {
      expect(listed).toContain(`${BASE}${path}`)
    }
    expect(new Set(listed).size).toBe(listed.length)
  })

  test('dates come from the data only: the latest fetch of what a page shows, or the event date', () => {
    const data = dataset({
      models: [
        model('old', { platform: cited('P', '2026-01-05T00:00:00.000Z') }),
        model('new', {
          platform: cited('P', '2026-02-01T00:00:00.000Z'),
          tinnitus: cited(true, '2026-02-07T00:00:00.000Z'),
        }),
        model('bare'),
      ],
      reviews: [
        Reviews.parse({
          slug: 'old',
          customer: [{ sourceUrl: 'https://shop.example/a', rating: 4, count: 3, fetchedAt: '2026-04-01T00:00:00.000Z' }],
          complaintThemes: [],
          prosCons: null,
          videos: [],
        }),
      ],
      events: [
        Event.parse({ id: 'e-1', type: 'new-model', modelSlug: null, date: '2026-03-02', key: 'a', text: 'A.', sources: [] }),
        Event.parse({ id: 'e-2', type: 'new-model', modelSlug: null, date: '2026-05-09', key: 'b', text: 'B.', sources: [] }),
      ],
    })
    const dates = new Map(buildSitemapEntries(data, BASE).map((entry) => [entry.url.slice(BASE.length), entry.lastModified]))

    expect(dates.get('/hearing-aids/old')).toBe('2026-04-01T00:00:00.000Z')
    expect(dates.get('/hearing-aids/new')).toBe('2026-02-07T00:00:00.000Z')
    expect(dates.get('/compare/new-vs-old')).toBe('2026-04-01T00:00:00.000Z')
    // The brand page lists models and shows no review figures.
    expect(dates.get('/brands/acme')).toBe('2026-02-07T00:00:00.000Z')
    expect(dates.get('/news/e-1')).toBe('2026-03-02')
    expect(dates.get('/news')).toBe('2026-05-09')
    expect(dates.get('/')).toBe('2026-05-09')
    expect(dates.get('/hearing-aids/bare')).toBeUndefined()
    expect(dates.get('/privacy')).toBeUndefined()
  })

  test('with no models and no events there are no dates at all', () => {
    const entries = buildSitemapEntries(dataset({ models: [] }), BASE)

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) expect(Object.keys(entry)).toEqual(['url'])
  })
})

describe('robots', () => {
  test('closes the review page and the compare tool queries and data, and names the sitemap', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', `${BASE}/`)

    expect(robots()).toEqual({
      rules: { userAgent: '*', allow: '/', disallow: ['/review', '/compare?', '/compare/models.json'] },
      sitemap: `${BASE}/sitemap.xml`,
    })
  })

  test('names no sitemap while the site URL is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')

    expect(robots()).not.toHaveProperty('sitemap')
  })
})

describe('discontinued models in the sitemap', () => {
  const bare = (slug: string) =>
    model(slug, { discontinued: { source: { ...cited('Old', '2026-11-26T00:00:00.000Z') } } })

  test('are left out, with their pairs, unless indexed', () => {
    const thin = bare('thin')
    const document = { kind: 'user-guide', title: 'Guide', url: 'https://maker.example/g.pdf', fetchedAt: '2026-11-26T00:00:00.000Z' }
    const documented = { ...bare('documented'), documents: [document] } as Model
    const listed = urls(dataset({ models: [...models.slice(0, 2), thin, documented] }))

    expect(listed).toContain(`${BASE}/hearing-aids/documented`)
    expect(listed).not.toContain(`${BASE}/hearing-aids/thin`)
    expect(listed.filter((url) => url.includes('thin'))).toEqual([])
  })

  test('a lineage pair with an unindexed page is left out', () => {
    const thin = Model.parse({ ...bare('thin'), successor: { slug: 'm-00', source: cited('New', '2026-11-26T00:00:00.000Z') } })
    const listed = urls(dataset({ models: [...models.slice(0, 2), thin] }))

    expect(listed.filter((url) => url.includes('thin'))).toEqual([])
    expect(listed).toContain(`${BASE}/compare/m-00-vs-m-01`)
  })
})
