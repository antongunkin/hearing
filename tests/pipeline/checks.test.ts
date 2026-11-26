import { describe, expect, test } from 'vitest'
import type { Event } from '@/src/lib/schema/event'
import type { Sourced } from '@/src/lib/schema/field'
import { isDuplicateEvent } from '@/pipeline/checks/dedupe'
import { forbiddenCheck } from '@/pipeline/checks/forbidden'
import { literalCheck } from '@/pipeline/checks/literal'
import { rangeCheck } from '@/pipeline/checks/ranges'

const meta = { sourceUrl: 'https://example.com/spec', fetchedAt: '2026-11-26T00:00:00Z' }

function field(over: { value: unknown; quote: string; unit?: string; sourceType?: 'official' | 'third-party' }): Sourced<unknown> {
  return { ...meta, sourceType: 'official', ...over }
}

function derived(over: { value: unknown; quote: string; input: string; unit?: string }): Sourced<unknown> {
  return {
    ...meta,
    value: over.value,
    quote: over.quote,
    unit: over.unit,
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

  describe('ISO date values', () => {
    test.each([
      ['2024-03-01', 'March 1, 2024', true],
      ['2024-03-01', 'Mar 1, 2024', true],
      ['2024-03-01', '1 March 2024', true],
      ['2024-03-01', '03/01/2024', true],
      ['2024-03-01', '2024-03-01', true],
      ['2024-03-01', 'March 2, 2024', false],
      ['2024-03-01', 'Mar 2024', false],
      ['2024-03', 'Mar 2024', true],
      ['2024-03', 'March 2024', true],
      ['2024-03', 'Mar 2023', false],
    ])('value %s against "%s" is %s', (value, quote, expected) => {
      expect(literalCheck(field({ value, quote }), quote).ok).toBe(expected)
    })
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

  describe('unit verification', () => {
    test('rejects a unit that differs from the quote ("2.1 oz" for g)', () => {
      const result = literalCheck(field({ value: 2.1, unit: 'g', quote: '2.1 oz' }), '2.1 oz')
      expect(result.ok).toBe(false)
      expect(result.detail).toMatch(/unit "g"/)
    })

    test('accepts a synonym of the unit ("2.1 grams" for g)', () => {
      expect(literalCheck(field({ value: 2.1, unit: 'g', quote: '2.1 grams' }), '2.1 grams').ok).toBe(true)
    })

    test.each([
      ['g', 2.1, '2.1 g'],
      ['g', 2.1, '2.1 gram'],
      ['g', 2.1, '2.1g'],
      ['mg', 250, '250 mg'],
      ['oz', 0.07, '0.07 oz'],
      ['oz', 0.07, '0.07 ounces'],
      ['mm', 12, '12 mm'],
      ['mm', 12, '12 millimeters'],
      ['mm', 12, '12 millimetres'],
      ['cm', 1.2, '1.2 cm'],
      ['in', 0.5, '0.5 in'],
      ['in', 0.5, '0.5 inches'],
      ['in', 0.5, '0.5"'],
      ['h', 24, '24 h'],
      ['h', 24, '24 hr'],
      ['h', 24, '24 hours'],
    ])('accepts unit %s with quote "%s"', (unit, value, quote) => {
      expect(literalCheck(field({ value, unit, quote }), quote).ok).toBe(true)
    })

    test('rejects a unit that is not right after the number', () => {
      expect(literalCheck(field({ value: 2.1, unit: 'g', quote: '2.1 each, 5 g' }), '2.1 each, 5 g').ok).toBe(false)
    })

    test('rejects a unit that only continues a longer word', () => {
      expect(literalCheck(field({ value: 2.1, unit: 'g', quote: '2.1 gigs' }), '2.1 gigs').ok).toBe(false)
    })

    test('accepts a correct unit when another occurrence of the number has a different unit', () => {
      const quote = 'was 2.1 oz, now 2.1 g'
      expect(literalCheck(field({ value: 2.1, unit: 'g', quote }), quote).ok).toBe(true)
    })

    test('rejects an empty unit string', () => {
      expect(literalCheck(field({ value: 2.1, unit: '', quote: '2.1, each' }), '2.1, each').ok).toBe(false)
    })

    test('fails a unit field whose value has no number', () => {
      expect(literalCheck(field({ value: 'lithium', unit: 'g', quote: 'lithium battery' }), 'lithium battery').ok).toBe(false)
    })

    test('checks the unit after every number of a pair', () => {
      const value = { min: 1200, max: 1400, perPair: true }
      expect(literalCheck(field({ value, unit: 'g', quote: 'between 1,200 g and 1,400 g' }), 'between 1,200 g and 1,400 g').ok).toBe(true)
      expect(literalCheck(field({ value, unit: 'g', quote: 'between 1,200 g and 1,400 oz' }), 'between 1,200 g and 1,400 oz').ok).toBe(false)
    })

    test('does not check units when the field has none', () => {
      expect(literalCheck(field({ value: 2.1, quote: '2.1 oz' }), '2.1 oz').ok).toBe(true)
    })

    test('reads a leading-dot decimal as written ("only .07 oz" is 0.07, not 7)', () => {
      expect(literalCheck(field({ value: 0.07, unit: 'oz', quote: 'only .07 oz' }), 'only .07 oz').ok).toBe(true)
      expect(literalCheck(field({ value: 7, unit: 'oz', quote: 'only .07 oz' }), 'only .07 oz').ok).toBe(false)
    })

    test.each(['27 x 8 x 12 mm', '27 × 8 × 12 mm', '27 by 8 by 12 mm'])(
      'one trailing unit covers a dimension chain: "%s"',
      (quote) => {
        expect(literalCheck(field({ value: { l: 27, w: 8, h: 12 }, unit: 'mm', quote }), quote).ok).toBe(true)
      },
    )

    test('a dimension chain still fails when a dimension has no unit', () => {
      expect(literalCheck(field({ value: { l: 27, w: 8, h: 12 }, unit: 'mm', quote: '27 x 8 x 12' }), '27 x 8 x 12').ok).toBe(false)
    })

    test('checks only the number for a unit outside the measurement table', () => {
      expect(literalCheck(field({ value: 999, unit: 'USD', quote: '$999' }), '$999').ok).toBe(true)
      expect(literalCheck(field({ value: 999, unit: 'USD', quote: '$1,999' }), '$1,999').ok).toBe(false)
    })

    test('accepts a hyphen between number and unit ("24-hour battery" for h)', () => {
      expect(literalCheck(field({ value: 24, unit: 'h', quote: '24-hour battery' }), '24-hour battery').ok).toBe(true)
    })

    test('does not check units on derived fields', () => {
      const result = literalCheck(derived({ value: 1.98, unit: 'g', quote: 'only 0.07 oz', input: '0.07 oz' }), 'only 0.07 oz')
      expect(result.ok).toBe(true)
    })
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

  test('accepts "your audiologist" (second person, not an expert claim)', () => {
    expect(forbiddenCheck('Ask your audiologist about fitting.').ok).toBe(true)
  })

  test('accepts neutral text', () => {
    expect(forbiddenCheck('The device weighs 2.1 g per ear.').ok).toBe(true)
  })
})
