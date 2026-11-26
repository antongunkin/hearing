import { describe, expect, test } from 'vitest'
import { canonicalUnit, findNumbers, parseMeasurement, toGrams, toMm, unitFollows } from '@/pipeline/units'

describe('parseMeasurement', () => {
  test('reads value and unit from spec text', () => {
    expect(parseMeasurement('Weight: 2.1 g')).toEqual({ value: 2.1, unit: 'g' })
  })

  test('accepts no space between number and unit', () => {
    expect(parseMeasurement('Size 2.5mm')).toEqual({ value: 2.5, unit: 'mm' })
  })

  test('recognises every supported unit', () => {
    expect(parseMeasurement('0.07 oz')).toEqual({ value: 0.07, unit: 'oz' })
    expect(parseMeasurement('12 mg')).toEqual({ value: 12, unit: 'mg' })
    expect(parseMeasurement('10 cm')).toEqual({ value: 10, unit: 'cm' })
    expect(parseMeasurement('3 in')).toEqual({ value: 3, unit: 'in' })
  })

  test('maps "inch" and "inches" to "in"', () => {
    expect(parseMeasurement('Diameter 25 inches')).toEqual({ value: 25, unit: 'in' })
  })

  test('unit match is case-insensitive and returns the lowercase unit', () => {
    expect(parseMeasurement('2.1 G')).toEqual({ value: 2.1, unit: 'g' })
  })

  test('returns null when there is no measurement', () => {
    expect(parseMeasurement('IP68 rated, no numbers in units')).toBeNull()
    expect(parseMeasurement('no numbers here')).toBeNull()
  })

  test('returns null for an unsupported unit', () => {
    expect(parseMeasurement('5 lbs')).toBeNull()
  })

  test('reads leading-dot decimals', () => {
    expect(parseMeasurement('Weight: .07 oz')).toEqual({ value: 0.07, unit: 'oz' })
  })

  test('reads thousands separators', () => {
    expect(parseMeasurement('1,200 mg')).toEqual({ value: 1200, unit: 'mg' })
  })

  test.each([
    ['2 ounces', 2, 'oz'],
    ['5 grams', 5, 'g'],
    ['12 millimeters', 12, 'mm'],
    ['12 millimetres', 12, 'mm'],
    ['0.5 inches', 0.5, 'in'],
    ['0.5"', 0.5, 'in'],
    ['24 hours', 24, 'h'],
    ['24 hr', 24, 'h'],
  ])('accepts the synonym in "%s"', (text, value, unit) => {
    expect(parseMeasurement(text)).toEqual({ value, unit })
  })

  test('accepts a hyphen between number and unit', () => {
    expect(parseMeasurement('24-hour battery')).toEqual({ value: 24, unit: 'h' })
  })
})

describe('canonicalUnit', () => {
  test('maps synonyms to the canonical unit, case-insensitively', () => {
    expect(canonicalUnit('grams')).toBe('g')
    expect(canonicalUnit('Inches')).toBe('in')
    expect(canonicalUnit('hr')).toBe('h')
  })

  test('returns undefined for a unit outside the measurement table', () => {
    expect(canonicalUnit('USD')).toBeUndefined()
  })
})

describe('findNumbers', () => {
  test('reads leading-dot decimals', () => {
    expect(findNumbers('only .07 oz').map((n) => n.value)).toEqual([0.07])
  })

  test('reads thousands separators and returns each number', () => {
    expect(findNumbers('1,200 to 1,400').map((n) => n.value)).toEqual([1200, 1400])
  })
})

describe('unitFollows', () => {
  const firstEnd = (text: string) => findNumbers(text)[0].end

  test.each(['27 x 8 x 12 mm', '27 × 8 × 12 mm', '27 by 8 by 12 mm', '27x8x12 mm'])(
    'one trailing unit covers the dimension chain in "%s"',
    (text) => {
      expect(unitFollows(text, firstEnd(text), 'mm')).toBe(true)
    },
  )

  test('does not let a chain skip a non-number word', () => {
    expect(unitFollows('2.1 each, 5 g', firstEnd('2.1 each, 5 g'), 'g')).toBe(false)
  })

  test('accepts a hyphen between number and unit', () => {
    expect(unitFollows('24-hour battery', firstEnd('24-hour battery'), 'h')).toBe(true)
  })
})

describe('toGrams', () => {
  test('converts ounces', () => {
    expect(toGrams(0.07, 'oz')).toBeCloseTo(1.98, 2)
  })

  test('converts milligrams and keeps grams', () => {
    expect(toGrams(2000, 'mg')).toBeCloseTo(2, 10)
    expect(toGrams(3, 'g')).toBe(3)
  })

  test('throws for a non-mass unit', () => {
    expect(() => toGrams(1, 'mm')).toThrow()
  })
})

describe('toMm', () => {
  test('converts cm, inches and keeps mm', () => {
    expect(toMm(2, 'cm')).toBe(20)
    expect(toMm(1, 'in')).toBe(25.4)
    expect(toMm(5, 'mm')).toBe(5)
  })

  test('throws for a non-length unit', () => {
    expect(() => toMm(1, 'oz')).toThrow()
  })
})
