import { describe, expect, test } from 'vitest'
import { Model } from '@/src/lib/schema/model'
import { isIndexable } from '@/src/lib/site/indexing'

const cited = <T>(value: T) => ({
  value,
  sourceUrl: 'https://maker.example/spec',
  quote: 'q',
  fetchedAt: '2026-11-26T00:00:00.000Z',
  sourceType: 'official' as const,
})

const old = (fields: Record<string, unknown> = {}) =>
  Model.parse({
    slug: 'acme-old',
    brand: 'acme',
    name: 'Old',
    aliases: [],
    type: 'otc',
    sameHardwareAs: [],
    discontinued: { source: cited('Old') },
    variants: [],
    ...fields,
  })

describe('isIndexable', () => {
  test('a model on sale always is', () => {
    expect(isIndexable(old({ discontinued: undefined }))).toBe(true)
  })

  test('a discontinued page needs 3 sourced rows or 1 document', () => {
    expect(isIndexable(old())).toBe(false)
    expect(isIndexable(old({ platform: cited('Core'), tinnitus: cited(true) }))).toBe(false)
    expect(isIndexable(old({ platform: cited('Core'), tinnitus: cited(true), colors: cited(['Black']) }))).toBe(true)
    const document = { kind: 'datasheet', title: 'Sheet', url: 'https://maker.example/s.pdf', fetchedAt: '2026-11-26T00:00:00.000Z' }
    expect(isIndexable(old({ documents: [document] }))).toBe(true)
  })
})
