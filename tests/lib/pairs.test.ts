import { describe, expect, test } from 'vitest'
import type { CatalogItem } from '@/src/lib/site/catalog-index'
import { competitorsOf, pairSlug, parsePairSlug, selectCuratedPairs } from '@/src/lib/site/pairs'

const item = (slug: string, fields: Partial<CatalogItem> = {}): CatalogItem => ({
  slug,
  brand: 'acme',
  name: slug,
  type: 'otc',
  formFactors: [],
  powerTypes: [],
  connectivity: {},
  ...fields,
})

/** Twelve models of three types and two styles, so that scores differ and tie. */
const many = Array.from({ length: 12 }, (_, i) =>
  item(`m-${String(i).padStart(2, '0')}`, {
    type: (['otc', 'rx', 'consumer'] as const)[i % 3],
    formFactors: [i % 2 ? 'RIC' : 'BTE'],
  }),
)

describe('competitorsOf', () => {
  test('each model has min(k, n-1) competitors', () => {
    for (const [n, k, expected] of [[12, 10, 10], [12, 3, 3], [4, 10, 3], [2, 10, 1], [1, 10, 0]]) {
      const items = many.slice(0, n)
      for (const { slug } of items) {
        const competitors = competitorsOf(slug, items, k)
        expect(competitors).toHaveLength(expected)
        expect(new Set(competitors).size).toBe(expected)
        expect(competitors).not.toContain(slug)
      }
    }
    expect(competitorsOf('m-00', many)).toHaveLength(10)
  })

  test('knows no competitors of a model that is not listed', () => {
    expect(competitorsOf('nope', many)).toEqual([])
  })

  test('scores type 3, a shared style 2, and ties go by slug', () => {
    const items = [
      item('me', { formFactors: ['RIC', 'BTE'] }),
      item('d-nothing', { type: 'rx' }),
      item('c-style', { type: 'rx', formFactors: ['BTE', 'CIC'] }),
      item('b-type'),
      item('a-both', { formFactors: ['RIC'] }),
      item('a-nothing', { type: 'rx', formFactors: ['ITE'] }),
    ]

    expect(competitorsOf('me', items)).toEqual(['a-both', 'b-type', 'c-style', 'a-nothing', 'd-nothing'])
  })

  /** Whether the rule under test gives `other` a point: a point puts it before the slug-earlier blank. */
  const scores = (me: Partial<CatalogItem>, other: Partial<CatalogItem>) =>
    competitorsOf('me', [item('me', me), item('a-blank'), item('z-other', other)])[0] === 'z-other'

  test('scores 1 for prices within 30% of the lower one', () => {
    expect(scores({ priceMin: 1000 }, { priceMin: 1300 })).toBe(true)
    expect(scores({ priceMin: 1300 }, { priceMin: 1000 })).toBe(true)
    expect(scores({ priceMin: 1000 }, { priceMin: 1301 })).toBe(false)
    // 30% of the higher price would reach this one; of the lower it does not.
    expect(scores({ priceMin: 1000 }, { priceMin: 700 })).toBe(false)
    expect(scores({ priceMin: 1000 }, {})).toBe(false)
    expect(scores({}, { priceMin: 1000 })).toBe(false)
  })

  test('scores 1 for releases at most 12 calendar months apart', () => {
    expect(scores({ releaseDate: '2025-03-31' }, { releaseDate: '2024-03-01' })).toBe(true)
    expect(scores({ releaseDate: '2024-03' }, { releaseDate: '2025-03-31' })).toBe(true)
    expect(scores({ releaseDate: '2025-03-01' }, { releaseDate: '2024-02-29' })).toBe(false)
    expect(scores({ releaseDate: '2025-03' }, {})).toBe(false)
    expect(scores({}, { releaseDate: '2025-03' })).toBe(false)
    expect(scores({ releaseDate: 'spring 2025' }, { releaseDate: 'spring 2025' })).toBe(false)
  })

  test('adds the price and date points to the others', () => {
    const items = [
      item('me', { priceMin: 1000, releaseDate: '2025-01' }),
      item('a-plain'),
      item('b-priced', { priceMin: 1100 }),
      item('c-priced-and-dated', { priceMin: 1100, releaseDate: '2025-06' }),
    ]

    expect(competitorsOf('me', items)).toEqual(['c-priced-and-dated', 'b-priced', 'a-plain'])
  })
})

describe('selectCuratedPairs', () => {
  test('pairs are deduped and alphabetically ordered', () => {
    const pairs = selectCuratedPairs(many, 3)
    const keys = pairs.map(([a, b]) => `${a} ${b}`)

    expect(new Set(keys).size).toBe(keys.length)
    for (const [a, b] of pairs) expect(a < b).toBe(true)
    expect(keys).toEqual([...keys].sort())
    expect(pairs.length).toBeLessThanOrEqual(many.length * 3)
  })

  test('is the union of the competitors of every model', () => {
    const pairs = selectCuratedPairs(many, 2).map(([a, b]) => pairSlug(a, b))
    const expected = many.flatMap(({ slug }) => competitorsOf(slug, many, 2).map((other) => pairSlug(slug, other)))

    expect(new Set(pairs)).toEqual(new Set(expected))
  })

  test('selection is deterministic', () => {
    expect(selectCuratedPairs([...many].reverse())).toEqual(selectCuratedPairs(many))
    expect(competitorsOf('m-05', [...many].reverse())).toEqual(competitorsOf('m-05', many))
  })

  test('has no pairs for fewer than two models', () => {
    expect(selectCuratedPairs([])).toEqual([])
    expect(selectCuratedPairs([item('alone')])).toEqual([])
  })
})

describe('pair slugs', () => {
  test('pairSlug puts the two in alphabetical order', () => {
    expect(pairSlug('b-two', 'a-one')).toBe('a-one-vs-b-two')
    expect(pairSlug('a-one', 'b-two')).toBe('a-one-vs-b-two')
  })

  test('parsePairSlug reads what pairSlug writes', () => {
    expect(parsePairSlug('a-one-vs-b-two')).toEqual(['a-one', 'b-two'])
    expect(parsePairSlug(pairSlug('phonak-lumity-90', 'oticon-real-1'))).toEqual(['oticon-real-1', 'phonak-lumity-90'])
  })

  test('parsePairSlug rejects malformed and self-pairs', () => {
    for (const bad of [
      '',
      'a-one',
      '-vs-',
      'a-vs-',
      '-vs-b',
      'a-vs-b-vs-c',
      'a-vs-vs-b',
      'a-vs-a',
      'b-vs-a', // not the canonical order
      'A-vs-b',
      'a-vs-b_c',
      'a--x-vs-b',
      'a-vs-b-',
      'a%20-vs-b',
    ]) {
      expect(parsePairSlug(bad), bad).toBeNull()
    }
  })
})
