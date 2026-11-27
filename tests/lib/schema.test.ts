import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { Brand } from '@/src/lib/schema/brand'
import { Event } from '@/src/lib/schema/event'
import { sourced } from '@/src/lib/schema/field'
import { Model } from '@/src/lib/schema/model'
import { CandidateChange, PendingChange } from '@/src/lib/schema/pending'
import { Reviews } from '@/src/lib/schema/reviews'

const meta = {
  sourceUrl: 'https://x.com',
  quote: '0.07 oz',
  fetchedAt: '2026-11-26T00:00:00Z',
}
const official = { ...meta, sourceType: 'official' }

describe('sourced', () => {
  const schema = sourced(z.number())

  test('derived field without derivation is rejected', () => {
    expect(schema.safeParse({ ...meta, value: 2.1, sourceType: 'derived' }).success).toBe(false)
  })

  test('derived field with derivation is accepted', () => {
    const field = { ...meta, value: 2, unit: 'g', sourceType: 'derived', derivation: { op: 'oz-to-g', input: '0.07 oz' } }
    expect(schema.parse(field)).toEqual(field)
  })

  test.each([
    ['empty quote', { quote: '' }],
    ['missing value', { value: undefined }],
    ['non-http source url', { sourceUrl: 'javascript:alert(1)' }],
    ['non-datetime fetchedAt', { fetchedAt: 'yesterday' }],
    ['unknown source type', { sourceType: 'rumor' }],
  ])('rejects %s', (_label, override) => {
    expect(schema.safeParse({ ...official, value: 2.1, ...override }).success).toBe(false)
  })
})

describe('Model', () => {
  const model = {
    slug: 'phonak-x',
    brand: 'phonak',
    name: 'X',
    aliases: [],
    type: 'rx',
    sameHardwareAs: [],
    variants: [{ id: 'ric-90', formFactor: 'RIC' }],
  }
  const withVariant = (extra: object) => ({ ...model, variants: [{ ...model.variants[0], ...extra }] })

  test('accepts a model whose spec fields are all absent', () => {
    expect(Model.parse(model)).toEqual({ ...model, documents: [] })
  })

  test.each([
    ['an exact price', 799],
    ['a per-pair price range', { min: 2000, max: 4000, perPair: true }],
  ])('accepts %s', (_label, value) => {
    const input = withVariant({ priceUsd: { ...official, value } })
    expect(Model.parse(input)).toEqual({ ...input, documents: [] })
  })

  test('rejects a bare spec value without a source', () => {
    expect(Model.safeParse(withVariant({ weightG: 2.1 })).success).toBe(false)
  })

  test('rejects an unknown form factor', () => {
    expect(Model.safeParse(withVariant({ formFactor: 'XYZ' })).success).toBe(false)
  })
})

describe('pending changes', () => {
  const change = { modelSlug: null, path: 'variants.0.weightG', after: 2.1, checks: { 'variants.0.weightG': [{ name: 'range', ok: true }] } }
  const pending = { ...change, id: 'p1', kind: 'spec-change', createdAt: '2026-11-26T00:00:00Z' }

  test('accepts a pending change and a candidate change', () => {
    expect(PendingChange.parse(pending)).toEqual(pending)
    expect(CandidateChange.parse({ ...change, kind: 'price' })).toEqual({ ...change, kind: 'price' })
  })

  test('rejects a change without `after`', () => {
    const { after: _, ...withoutAfter } = pending
    expect(PendingChange.safeParse(withoutAfter).success).toBe(false)
  })
})

const brand = {
  slug: 'phonak',
  name: 'Phonak',
  group: 'Sonova',
  website: 'https://www.phonak.com',
  imageLicense: 'none',
  defaultType: 'rx',
  status: 'active',
  scraper: { catalogUrls: ['https://www.phonak.com/en-us'], modelUrlPattern: '/hearing-aids/', render: false },
}
const model = {
  slug: 'phonak-x',
  brand: 'phonak',
  name: 'X',
  aliases: [],
  type: 'rx',
  sameHardwareAs: [{ slug: 'unitron-y', source: { ...official, value: 'same platform' } }],
  app: { name: 'myPhonak', androidUrl: 'https://play.google.com/store/apps/details?id=x' },
  variants: [{ id: 'ric-90', formFactor: 'RIC', weightG: { ...official, value: 2.1 } }],
  documents: [{ kind: 'user-guide', title: 'myPhonak guide', url: 'https://www.phonak.com/guide.pdf', fetchedAt: meta.fetchedAt }],
}
const reviews = {
  slug: 'phonak-x',
  customer: [{ sourceUrl: 'https://x.com', rating: 4.5, count: 10, fetchedAt: meta.fetchedAt }],
  complaintThemes: [],
  prosCons: { pros: [{ text: 'small', sources: ['https://x.com'] }], cons: [{ text: 'dear', sources: ['https://x.com'] }] },
  videos: [{ id: 'dQw4w9WgXcQ_A', channel: 'c', title: 't' }],
}
const event = {
  id: 'e-1',
  type: 'new-model',
  modelSlug: 'phonak-x',
  date: '2026-11-26',
  key: 'k',
  text: 't',
  sources: ['https://x.com'],
}
const pending = {
  id: 'p-1',
  kind: 'spec-change',
  modelSlug: 'phonak-x',
  path: 'name',
  after: 'Y',
  checks: { name: [{ name: 'literal', ok: true }] },
  createdAt: meta.fetchedAt,
}

const records = { brand, model, reviews, event, pending }
const schemas = { brand: Brand, model: Model, reviews: Reviews, event: Event, pending: PendingChange }
type Kind = keyof typeof records

/** A copy of the record with one nested value replaced. */
function withValue(kind: Kind, path: string, value: unknown) {
  const copy = structuredClone(records[kind]) as Record<string, any>
  const keys = path.split('.')
  const last = keys.pop()!
  keys.reduce((node, key) => node[key], copy)[last] = value
  return copy
}

test.each(Object.keys(records) as Kind[])('accepts a fully filled %s', (kind) => {
  expect(schemas[kind].parse(records[kind])).toEqual(records[kind])
})

test.each<[Kind, string]>([
  ['brand', 'extra'],
  ['brand', 'scraper.extra'],
  ['model', 'extra'],
  ['model', 'app.extra'],
  ['model', 'sameHardwareAs.0.extra'],
  ['model', 'variants.0.wieghtG'],
  ['model', 'variants.0.weightG.extra'],
  ['reviews', 'extra'],
  ['reviews', 'customer.0.extra'],
  ['reviews', 'prosCons.extra'],
  ['reviews', 'prosCons.pros.0.extra'],
  ['reviews', 'videos.0.extra'],
  ['event', 'extra'],
  ['pending', 'extra'],
  ['pending', 'checks.name.0.extra'],
])('%s rejects the unknown key %s', (kind, path) => {
  expect(schemas[kind].safeParse(withValue(kind, path, 1)).success).toBe(false)
})

test.each([
  ['dimensionsMm', { l: 1, w: 1, h: 1 }],
  ['power', { type: '312' }],
  ['priceUsd', { min: 1, max: 2, perPair: true }],
])('rejects an unknown key inside the %s value', (key, value) => {
  const field = (extra: object) => withValue('model', `variants.0.${key}`, { ...official, value: { ...value, ...extra } })
  expect(Model.safeParse(field({})).success).toBe(true)
  expect(Model.safeParse(field({ extra: 1 })).success).toBe(false)
})

test.each([
  ['connectivity', { mfi: true }],
  ['fda', { status: 'cleared' }],
])('rejects an unknown key inside the %s value', (key, value) => {
  const field = (extra: object) => withValue('model', key, { ...official, value: { ...value, ...extra } })
  expect(Model.safeParse(field({})).success).toBe(true)
  expect(Model.safeParse(field({ extra: 1 })).success).toBe(false)
})

test('rejects an unknown key in a derivation', () => {
  const field = { ...meta, value: 2, sourceType: 'derived', derivation: { op: 'oz-to-g', input: '1', extra: 1 } }
  expect(sourced(z.number()).safeParse(field).success).toBe(false)
})

test('candidate change rejects unknown keys', () => {
  const { id: _id, createdAt: _createdAt, ...change } = pending
  expect(CandidateChange.safeParse({ ...change, extra: 1 }).success).toBe(false)
})

const slugFields: [Kind, string][] = [
  ['brand', 'slug'],
  ['model', 'slug'],
  ['model', 'variants.0.id'],
  ['model', 'sameHardwareAs.0.slug'],
  ['reviews', 'slug'],
  ['event', 'id'],
  ['event', 'modelSlug'],
  ['pending', 'id'],
  ['pending', 'modelSlug'],
]

describe.each(['../etc', 'Upper', 'a_b', 'a--b', '-a', 'a-', ''])('malformed slug %j', (bad) => {
  test.each(slugFields)('is rejected in %s %s', (kind, path) => {
    expect(schemas[kind].safeParse(withValue(kind, path, bad)).success).toBe(false)
  })
})

test.each<[Kind, string]>([
  ['brand', 'website'],
  ['brand', 'scraper.catalogUrls.0'],
  ['model', 'app.androidUrl'],
  ['event', 'sources.0'],
  ['reviews', 'customer.0.sourceUrl'],
  ['reviews', 'prosCons.pros.0.sources.0'],
  ['reviews', 'prosCons.cons.0.sources.0'],
])('%s requires an http(s) URL at %s', (kind, path) => {
  for (const bad of ['not a url', 'javascript:alert(1)']) {
    expect(schemas[kind].safeParse(withValue(kind, path, bad)).success).toBe(false)
  }
})

describe('third-party sources', () => {
  const thirdParty = { ...official, sourceType: 'third-party' }
  const range = { min: 2000, max: 4000, perPair: true }
  const withPrice = (type: string, value: unknown) => ({
    ...withValue('model', 'variants.0.priceUsd', { ...thirdParty, value }),
    type,
  })

  test.each([
    ['a price range', range],
    ['a single price', 3000],
  ])('are accepted for %s on an Rx model', (_label, value) => {
    expect(Model.safeParse(withPrice('rx', value)).success).toBe(true)
  })

  test('are accepted for sameHardwareAs', () => {
    const input = withValue('model', 'sameHardwareAs.0.source', { ...thirdParty, value: 'same platform' })
    expect(Model.safeParse(input).success).toBe(true)
  })

  test.each(['otc', 'consumer'])('are rejected for the price of a %s model', (type) => {
    expect(Model.safeParse(withPrice(type, 799)).error?.issues).toMatchObject([
      { path: ['variants', 0, 'priceUsd', 'sourceType'] },
    ])
  })

  test.each<[string, unknown]>([
    ['variants.0.weightG', 2.1],
    ['variants.0.ipRating', 'IP68'],
    ['platform', 'ERA'],
    ['app.iosVersion', '1.0'],
  ])('are rejected for %s, naming the path', (path, value) => {
    const input = withValue('model', path, { ...thirdParty, value })
    const keys = path.split('.').map((key) => (/^\d+$/.test(key) ? Number(key) : key))

    expect(Model.safeParse(input).error?.issues).toMatchObject([{ path: [...keys, 'sourceType'] }])
  })
})

test('a brand needs a status and no longer takes datasheetUrlPattern', () => {
  expect(Brand.safeParse({ ...brand, status: undefined }).success).toBe(false)
  expect(Brand.safeParse({ ...brand, scraper: { ...brand.scraper, datasheetUrlPattern: 'x' } }).success).toBe(false)
  expect(Brand.parse({ ...brand, archive: { catalogUrls: ['https://www.eargo.com/products-hearing-aids'] } }).archive?.catalogUrls).toHaveLength(1)
})

describe('archive fields', () => {
  const model = {
    slug: 'phonak-x',
    brand: 'phonak',
    name: 'X',
    aliases: [],
    type: 'rx',
    sameHardwareAs: [],
    variants: [{ id: 'ric-90', formFactor: 'RIC' }],
  }
  const listed = { ...official, value: 'Paradise' }
  const fact = { date: '2019-03', text: 'Phonak launched the Paradise platform.', sourceUrl: 'https://www.phonak.com/news', quote: 'Paradise', fetchedAt: meta.fetchedAt }

  test('a model may be discontinued with or without a month, and lists documents', () => {
    const withDocument = {
      ...model,
      discontinued: { source: listed },
      documents: [{ kind: 'user-guide', title: 'Paradise user guide', url: 'https://www.phonak.com/x.pdf', fetchedAt: meta.fetchedAt }],
    }
    expect(Model.parse(withDocument).discontinued?.lastListed).toBeUndefined()
    expect(Model.parse({ ...model, discontinued: { lastListed: '2023-10', source: listed } }).discontinued?.lastListed).toBe('2023-10')
    expect(Model.parse(model).documents).toEqual([])
    expect(Model.safeParse({ ...model, discontinued: { lastListed: '2023-13', source: listed } }).success).toBe(false)
  })

  test('predecessor and successor need a source', () => {
    expect(Model.safeParse({ ...model, successor: 'phonak-lumity' }).success).toBe(false)
    expect(Model.safeParse({ ...model, successor: { slug: 'phonak-lumity', source: { ...official, value: 'Lumity' } } }).success).toBe(true)
  })

  test('a brand history has 3 to 5 sourced facts', () => {
    const history = (count: number) => ({ facts: Array.from({ length: count }, () => fact) })
    expect(Brand.safeParse({ ...brand, history: history(3) }).success).toBe(true)
    expect(Brand.safeParse({ ...brand, history: history(5) }).success).toBe(true)
    expect(Brand.safeParse({ ...brand, history: history(2) }).success).toBe(false)
    expect(Brand.safeParse({ ...brand, history: history(6) }).success).toBe(false)
    expect(Brand.safeParse({ ...brand, history: { facts: [fact, fact, { ...fact, date: '2019' }] } }).success).toBe(false)
  })

  test('a derived release date may cite the earliest archive copy', () => {
    const field = { ...meta, value: '2018-03', sourceType: 'derived', derivation: { op: 'earliest-archive-copy', input: '20180315120000' } }
    expect(sourced(z.string()).parse(field)).toEqual(field)
  })
})
