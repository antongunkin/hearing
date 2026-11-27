import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Brand } from '@/src/lib/schema/brand'
import { Model } from '@/src/lib/schema/model'
import { buildCatalogIndex, filterCatalog, latestFirst, type CatalogItem } from '@/src/lib/site/catalog-index'
import { formatDate, formatPrice } from '@/src/lib/site/format'
import { productJsonLd } from '@/src/lib/site/jsonld'
import { pressImage } from '@/src/lib/site/press-image'
import { specColumns, specRows } from '@/src/lib/site/spec-rows'

const cited = <T>(value: T, extra: Record<string, unknown> = {}) => ({
  value,
  sourceUrl: 'https://maker.example/spec',
  quote: 'q',
  fetchedAt: '2026-11-26T00:00:00.000Z',
  sourceType: 'official' as const,
  ...extra,
})

const model = (fields: Record<string, unknown> = {}) =>
  Model.parse({
    slug: 'acme-one',
    brand: 'acme',
    name: 'One',
    aliases: [],
    type: 'otc',
    sameHardwareAs: [],
    variants: [{ id: 'one-ric', formFactor: 'RIC' }],
    ...fields,
  })

const brand = Brand.parse({
  slug: 'acme',
  name: 'Acme',
  group: 'Acme Group',
  website: 'https://maker.example',
  imageLicense: 'none',
  defaultType: 'rx',
  status: 'active',
  scraper: { catalogUrls: [], modelUrlPattern: '/x/', render: false },
})

const full = model({
  releaseDate: cited('2025-03-15'),
  platform: cited('Core'),
  connectivity: cited({ mfi: true, asha: false, auracast: true }),
  variants: [
    {
      id: 'one-ric',
      formFactor: 'RIC',
      techLevel: 'I90',
      weightG: cited(2.5, { unit: 'g' }),
      dimensionsMm: cited({ l: 27, w: 8, h: 12 }, { unit: 'mm' }),
      power: cited({ type: 'rechargeable', batteryHours: 24, chargingCase: true }),
      priceUsd: cited(1695),
    },
    { id: 'one-bte', formFactor: 'BTE', weightG: cited(1.9), power: cited({ type: '13' }), priceUsd: cited(1495) },
  ],
})

const item = (fields: Partial<CatalogItem> & { slug: string }): CatalogItem => ({
  brand: 'acme',
  name: fields.slug,
  type: 'otc',
  formFactors: [],
  powerTypes: [],
  connectivity: {},
  ...fields,
})

describe('specRows', () => {
  const row = (rows: ReturnType<typeof specRows>, label: string) => rows.find((r) => r.label === label)

  test('a row with no value in any column is left out; a missing value is a null cell, not undefined', () => {
    const empty = model({ type: 'rx', variants: [{ id: 'a', formFactor: 'RIC' }, { id: 'b', formFactor: 'BTE' }] })
    expect(specRows([empty])).toEqual([])

    const rows = specRows([empty, model({ slug: 'acme-two', variants: [{ id: 'two', formFactor: 'CIC', ipRating: cited('IP68') }] })])
    expect(rows.map((r) => r.label)).toEqual(['Water and dust rating'])
    expect(row(rows, 'Water and dust rating')?.cells).toStrictEqual([null, null, { text: 'IP68', source: cited('IP68') }])
  })

  test('has one column per variant, across models, each cell carrying its source', () => {
    const rows = specRows([full, model({ slug: 'acme-two', variants: [{ id: 'two', formFactor: 'CIC' }] })])

    expect(row(rows, 'Price')?.cells.map((c) => c?.text ?? null)).toEqual(['$1,695', '$1,495', null])
    expect(row(rows, 'Weight')?.cells[0]).toEqual({ text: '2.5 g', source: full.variants[0].weightG })
    expect(row(rows, 'Dimensions (L × W × H)')?.cells[0]?.text).toBe('27 × 8 × 12 mm')
    expect(row(rows, 'Battery')?.cells.map((c) => c?.text ?? null)).toEqual(['Rechargeable', 'Size 13 disposable', null])
    expect(row(rows, 'Battery life')?.cells.map((c) => c?.text ?? null)).toEqual(['24 hours', null, null])
    expect(row(rows, 'Charging case')?.cells[0]?.text).toBe('Included')
    // A model-wide value stands in every column of its model; a flag the source does not state is unknown.
    expect(row(rows, 'Made for iPhone')?.cells.map((c) => c?.text ?? null)).toEqual(['Yes', 'Yes', null])
    expect(row(rows, 'Android streaming (ASHA)')?.cells[0]?.text).toBe('No')
    // No column states LE Audio: the row is left out.
    expect(row(rows, 'Bluetooth LE Audio')).toBeUndefined()
    expect(row(rows, 'Released')?.cells[0]?.text).toBe('Mar 15, 2025')
  })

  test('shows a per-pair price range of a third party', () => {
    const price = cited({ min: 3000, max: 5000, perPair: true }, { sourceType: 'third-party' })
    const rows = specRows([model({ type: 'rx', variants: [{ id: 'a', formFactor: 'RIC', priceUsd: price }] })])

    expect(row(rows, 'Price')?.cells[0]).toEqual({ text: '$3,000–$5,000 per pair', source: price })
  })

  test('labels the columns by form factor and tech level, telling twins apart', () => {
    const labels = (m: Model) => specColumns([m]).map((c) => c.label)

    expect(labels(full)).toEqual(['RIC I90', 'BTE'])
    expect(labels(model({ variants: [{ id: 'r', formFactor: 'RIC' }, { id: 's', formFactor: 'RIC' }] }))).toEqual(['RIC (r)', 'RIC (s)'])
  })

  test('keeps a column for a model with no variants, so its model-wide values show', () => {
    const bare = model({ variants: [], platform: cited('Core') })

    expect(specColumns([bare]).map((c) => c.label)).toEqual(['All versions'])
    expect(row(specRows([bare]), 'Platform')?.cells[0]?.text).toBe('Core')
  })
})

describe('catalog', () => {
  test('buildCatalogIndex summarises the variants', () => {
    expect(buildCatalogIndex([full])).toStrictEqual([
      {
        slug: 'acme-one',
        brand: 'acme',
        name: 'One',
        type: 'otc',
        formFactors: ['RIC', 'BTE'],
        powerTypes: ['rechargeable', '13'],
        connectivity: { mfi: true, asha: false, auracast: true },
        priceMin: 1495,
        priceSource: { sourceUrl: 'https://maker.example/spec', sourceType: 'official' },
        releaseDate: '2025-03-15',
        weightGMin: 1.9,
      },
    ])
  })

  test('buildCatalogIndex leaves unknown values out and takes the low end of a price range', () => {
    const rx = model({
      type: 'rx',
      variants: [{ id: 'a', formFactor: 'RIC', priceUsd: cited({ min: 3000, max: 5000, perPair: true }) }],
    })
    const [index] = buildCatalogIndex([rx])

    expect(index.priceMin).toBe(3000)
    expect(index).toMatchObject({ powerTypes: [], connectivity: {} })
    expect('releaseDate' in index).toBe(false)
    expect('weightGMin' in index).toBe(false)
  })

  test('buildCatalogIndex keeps the source of the lowest price, the official one of two equals', () => {
    const rx = (...prices: [number, 'official' | 'third-party'][]) =>
      model({
        type: 'rx',
        variants: prices.map(([value, sourceType], i) => ({
          id: `v${i}`,
          formFactor: 'RIC',
          priceUsd: cited(value, { sourceType, sourceUrl: `https://${sourceType}.example/${i}` }),
        })),
      })
    const source = (...prices: Parameters<typeof rx>) => buildCatalogIndex([rx(...prices)])[0].priceSource?.sourceUrl

    expect(source([2000, 'official'], [1000, 'third-party'])).toBe('https://third-party.example/1')
    expect(source([1000, 'third-party'], [1000, 'official'])).toBe('https://official.example/1')
  })

  const items = [
    item({ slug: 'known', formFactors: ['RIC'], powerTypes: ['312'], priceMin: 900, connectivity: { auracast: true } }),
    item({ slug: 'unknown' }),
    item({ slug: 'other', brand: 'zed', type: 'rx', formFactors: ['BTE'], powerTypes: ['13'], priceMin: 3000, connectivity: { auracast: false } }),
  ]
  const slugs = (f: Parameters<typeof filterCatalog>[1]) => filterCatalog(items, f).map((i) => i.slug)

  test('filterCatalog keeps model without weight when filtering by formFactor', () => {
    expect(items[0].weightGMin).toBeUndefined()
    expect(slugs({ formFactor: ['RIC'] })).toEqual(['known', 'unknown'])
  })

  test('filterCatalog drops only known mismatches', () => {
    expect(slugs({ power: ['312'] })).toEqual(['known', 'unknown'])
    expect(slugs({ type: ['rx'] })).toEqual(['other'])
    expect(slugs({ brand: ['zed'] })).toEqual(['other'])
    expect(slugs({ formFactor: ['RIC', 'BTE'] })).toEqual(['known', 'unknown', 'other'])
  })

  test('filterCatalog drops models without a value for priceMax and auracast', () => {
    expect(slugs({ priceMax: 900 })).toEqual(['known'])
    expect(slugs({ auracast: true })).toEqual(['known'])
  })

  test('filterCatalog ignores empty and off filters', () => {
    expect(slugs({ type: [], formFactor: [], power: [], brand: [], auracast: false })).toEqual(['known', 'unknown', 'other'])
  })

  test('latestFirst orders by release date, else the date the model was added, undated last', () => {
    const dated = [
      { slug: 'a' },
      { slug: 'b', releaseDate: '2024-01' },
      { slug: 'c', releaseDate: '2025-06-01' },
      { slug: 'd', addedOn: '2024-06-01' },
    ]

    expect([...dated].sort(latestFirst).map((i) => i.slug)).toEqual(['c', 'd', 'b', 'a'])
  })

  test('the date a model was added comes from its new-model event, and is never its release date', () => {
    const added = { id: 'e', type: 'new-model' as const, modelSlug: full.slug, date: '2026-11-27', key: full.slug, text: 'Added.', sources: [] }
    const other = { ...added, id: 'f', type: 'price-change' as const, date: '2026-12-01' }
    const undated = model({ slug: 'acme-undated' })
    const [withDate, withoutDate] = buildCatalogIndex([full, undated], [added, other, { ...added, id: 'g', modelSlug: undated.slug }])

    expect(withDate).toMatchObject({ releaseDate: '2025-03-15', addedOn: '2026-11-27' })
    expect(withoutDate.releaseDate).toBeUndefined()
    expect(withoutDate.addedOn).toBe('2026-11-27')
    expect(buildCatalogIndex([undated])[0].addedOn).toBeUndefined()
  })
})

describe('format', () => {
  test('formatPrice', () => {
    expect(formatPrice(1695)).toBe('$1,695')
    expect(formatPrice(99.5)).toBe('$99.50')
    expect(formatPrice({ min: 2000, max: 2000, perPair: true })).toBe('$2,000 per pair')
  })

  test('formatDate keeps the precision of the source and passes other text through', () => {
    expect(formatDate('2025-03')).toBe('Mar 2025')
    expect(formatDate('2025-03-01')).toBe('Mar 1, 2025')
    expect(formatDate('2026-11-26T23:59:00.000Z')).toBe('Nov 26, 2026')
    expect(formatDate('spring 2025')).toBe('spring 2025')
  })
})

describe('productJsonLd', () => {
  afterEach(() => vi.unstubAllEnvs())

  test('productJsonLd has no aggregateRating or review keys', () => {
    const json = JSON.stringify(productJsonLd(full, brand))

    expect(json).not.toMatch(/aggregateRating|"review|Rating"/i)
  })

  test('describes the first variant of the product with an absolute URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example/')

    expect(productJsonLd(full, brand)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Acme One',
      brand: { '@type': 'Brand', name: 'Acme' },
      url: 'https://site.example/hearing-aids/acme-one',
      weight: { '@type': 'QuantitativeValue', value: 2.5, unitCode: 'GRM' },
      depth: { '@type': 'QuantitativeValue', value: 27, unitCode: 'MMT' },
      width: { '@type': 'QuantitativeValue', value: 8, unitCode: 'MMT' },
      height: { '@type': 'QuantitativeValue', value: 12, unitCode: 'MMT' },
    })
  })

  test('leaves out what is unknown, including the URL of an unset site', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')

    expect(Object.keys(productJsonLd(model(), brand))).toEqual(['@context', '@type', 'name', 'brand'])
  })
})

describe('pressImage', () => {
  let dir: string
  afterEach(() => rm(dir, { recursive: true, force: true }))

  async function images(...names: string[]) {
    dir = await mkdtemp(join(tmpdir(), 'images-'))
    await mkdir(dir, { recursive: true })
    for (const name of names) await writeFile(join(dir, name), '')
    return dir
  }
  const licensed = { ...brand, imageLicense: 'press-kit-editorial' as const }

  test('gives the image of a model of a licensed brand', async () => {
    expect(await pressImage('acme-one', licensed, await images('acme-one.webp'))).toBe('/images/acme-one.webp')
  })

  test('gives none without the licence, whatever files there are', async () => {
    expect(await pressImage('acme-one', brand, await images('acme-one.webp'))).toBeUndefined()
  })

  test("gives none for another model's file, a non-image or a missing directory", async () => {
    const found = await images('acme-one-plus.jpg', 'acme-one.txt')

    expect(await pressImage('acme-one', licensed, found)).toBeUndefined()
    expect(await pressImage('acme-one', licensed, join(found, 'nope'))).toBeUndefined()
  })
})
