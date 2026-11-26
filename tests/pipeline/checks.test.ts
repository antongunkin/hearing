import { describe, expect, test } from 'vitest'
import type { Event } from '@/src/lib/schema/event'
import type { Sourced } from '@/src/lib/schema/field'
import { isDuplicateEvent } from '@/pipeline/checks/dedupe'
import { forbiddenCheck } from '@/pipeline/checks/forbidden'
import { literalCheck } from '@/pipeline/checks/literal'
import { rangeCheck } from '@/pipeline/checks/ranges'

const meta = { sourceUrl: 'https://example.com/spec', fetchedAt: '2026-11-26T00:00:00Z' }

function field(over: { value: unknown; quote: string; sourceType?: 'official' | 'third-party' }): Sourced<unknown> {
  return { ...meta, sourceType: 'official', ...over }
}

function derived(over: { value: unknown; quote: string; input: string }): Sourced<unknown> {
  return {
    ...meta,
    value: over.value,
    quote: over.quote,
    sourceType: 'derived',
    derivation: { op: 'oz-to-g', input: over.input },
  }
}

function ev(date: string, over: Partial<Event> = {}): Event {
  return {
    id: 'price-change-1',
    type: 'price-change',
    modelSlug: 'model-a',
    date,
    key: 'price:model-a',
    text: 'Price changed',
    sources: ['https://example.com/price'],
    ...over,
  }
}

describe('literalCheck', () => {
  test('accepts a number quoted in the source', () => {
    expect(literalCheck(field({ value: 2.1, quote: 'weighs 2.1 g' }), 'The device weighs 2.1 g per ear').ok).toBe(true)
  })

  test('rejects a number that differs from the quote', () => {
    expect(literalCheck(field({ value: 2.4, quote: 'weighs 2.1 g' }), 'The device weighs 2.1 g').ok).toBe(false)
  })

  test('rejects a quote that is not in the source', () => {
    expect(literalCheck(field({ value: 2.1, quote: 'weighs 2.1 g' }), 'unrelated page').ok).toBe(false)
  })

  test('accepts a trailing zero in the quote ("2.10 g" for 2.1)', () => {
    expect(literalCheck(field({ value: 2.1, quote: 'weighs 2.10 g' }), 'weighs 2.10 g').ok).toBe(true)
  })

  test('does not match a number inside a larger number', () => {
    expect(literalCheck(field({ value: 2, quote: '12 g' }), '12 g').ok).toBe(false)
  })

  test('reads thousands separators in quoted numbers', () => {
    const rx = field({ value: { min: 1200, max: 1400, perPair: true }, quote: 'between $1,200 and $1,400 per pair' })
    expect(literalCheck(rx, 'between $1,200 and $1,400 per pair').ok).toBe(true)
  })

  test('normalises case and whitespace', () => {
    expect(literalCheck(field({ value: 2.1, quote: 'Weighs  2.1 g' }), 'weighs 2.1 g').ok).toBe(true)
  })

  test('rejects a whitespace-only quote', () => {
    expect(literalCheck(field({ value: 2.1, quote: '   ' }), '   ').ok).toBe(false)
  })

  test('checks string values as substrings of the quote', () => {
    const quote = 'Rechargeable battery'
    expect(literalCheck(field({ value: 'rechargeable', quote }), quote).ok).toBe(true)
    expect(literalCheck(field({ value: 'lithium', quote }), quote).ok).toBe(false)
  })

  test('derived field needs its derivation input in the quote', () => {
    expect(literalCheck(derived({ value: 1.98, quote: 'only 0.07 oz', input: '0.07 oz' }), 'only 0.07 oz').ok).toBe(true)
    expect(literalCheck(derived({ value: 1.98, quote: 'only 0.07 oz', input: '0.08 oz' }), 'only 0.07 oz').ok).toBe(false)
  })
})

describe('rangeCheck', () => {
  test('rejects weight above 10 g', () => {
    expect(rangeCheck('variants.0.weightG', 40).ok).toBe(false)
  })

  test('accepts weight at the range bounds and rejects just outside', () => {
    expect(rangeCheck('variants.0.weightG', 0.5).ok).toBe(true)
    expect(rangeCheck('variants.0.weightG', 10).ok).toBe(true)
    expect(rangeCheck('variants.0.weightG', 0.4).ok).toBe(false)
  })

  test('checks every dimension', () => {
    expect(rangeCheck('variants.0.dimensionsMm', { l: 10, w: 8, h: 5 }).ok).toBe(true)
    expect(rangeCheck('variants.0.dimensionsMm', { l: 70, w: 8, h: 5 }).ok).toBe(false)
  })

  test('checks a single dimension addressed by its own path', () => {
    expect(rangeCheck('variants.0.dimensionsMm.l', 70).ok).toBe(false)
  })

  test('checks battery hours inside a power object', () => {
    expect(rangeCheck('variants.0.power', { type: 'rechargeable', batteryHours: 0 }).ok).toBe(false)
    expect(rangeCheck('variants.0.power', { type: 'rechargeable', batteryHours: 24 }).ok).toBe(true)
  })

  test('checks OTC price, a number in 50–5000', () => {
    expect(rangeCheck('variants.0.priceUsd', 49).ok).toBe(false)
    expect(rangeCheck('variants.0.priceUsd', 50).ok).toBe(true)
    expect(rangeCheck('variants.0.priceUsd', 5000).ok).toBe(true)
    expect(rangeCheck('variants.0.priceUsd', 5001).ok).toBe(false)
  })

  test('checks Rx price pair, both ends in 500–10000 and min ≤ max', () => {
    expect(rangeCheck('variants.0.priceUsd', { min: 4000, max: 2000, perPair: true }).ok).toBe(false)
    expect(rangeCheck('variants.0.priceUsd', { min: 600, max: 1200, perPair: true }).ok).toBe(true)
    expect(rangeCheck('variants.0.priceUsd', { min: 400, max: 1200, perPair: true }).ok).toBe(false)
    expect(rangeCheck('variants.0.priceUsd', { min: 600, max: 12000, perPair: true }).ok).toBe(false)
  })

  test('passes paths without a rule', () => {
    expect(rangeCheck('variants.0.ipRating', 'IP68')).toEqual({ name: 'range', ok: true })
    expect(rangeCheck('name', 'anything').ok).toBe(true)
  })
})

describe('isDuplicateEvent', () => {
  test('same type, model and key within 30 days is a duplicate', () => {
    expect(isDuplicateEvent(ev('2026-11-01'), [ev('2026-11-20')])).toBe(true)
  })

  test('exactly 30 days apart is a duplicate, 31 days is not', () => {
    expect(isDuplicateEvent(ev('2026-12-01'), [ev('2026-11-01')])).toBe(true)
    expect(isDuplicateEvent(ev('2026-12-02'), [ev('2026-11-01')])).toBe(false)
  })

  test('compares date-time values with date values', () => {
    expect(isDuplicateEvent(ev('2026-11-20T12:00:00Z'), [ev('2026-11-01')])).toBe(true)
  })

  test('different type, model or key is not a duplicate', () => {
    const base = ev('2026-11-20')
    expect(isDuplicateEvent(ev('2026-11-01'), [{ ...base, type: 'app-update' }])).toBe(false)
    expect(isDuplicateEvent(ev('2026-11-01'), [{ ...base, modelSlug: 'model-b' }])).toBe(false)
    expect(isDuplicateEvent(ev('2026-11-01'), [{ ...base, key: 'price:other' }])).toBe(false)
  })

  test('returns false for an empty list', () => {
    expect(isDuplicateEvent(ev('2026-11-01'), [])).toBe(false)
  })
})

describe('forbiddenCheck', () => {
  test('rejects "tested" as a word', () => {
    expect(forbiddenCheck('We tested it for two weeks').ok).toBe(false)
  })

  test.each([
    ['hands-on review'],
    ['we wore it all day'],
    ['In our testing, the sound was clear'],
    ['Our audiologist recommends it'],
    ['Our expert team measured it'],
  ])('rejects forbidden phrase: %s', (text) => {
    expect(forbiddenCheck(text).ok).toBe(false)
  })

  test('matches case-insensitively and across repeated whitespace', () => {
    expect(forbiddenCheck('WE  WORE it').ok).toBe(false)
  })

  test('accepts neutral text', () => {
    expect(forbiddenCheck('The device weighs 2.1 g per ear.').ok).toBe(true)
  })
})
