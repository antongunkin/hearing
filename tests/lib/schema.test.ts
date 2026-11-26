import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { sourced } from '@/src/lib/schema/field'
import { Model } from '@/src/lib/schema/model'
import { CandidateChange, PendingChange } from '@/src/lib/schema/pending'

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
    expect(Model.parse(model)).toEqual(model)
  })

  test.each([
    ['an exact price', 799],
    ['a per-pair price range', { min: 2000, max: 4000, perPair: true }],
  ])('accepts %s', (_label, value) => {
    const input = withVariant({ priceUsd: { ...official, value } })
    expect(Model.parse(input)).toEqual(input)
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
