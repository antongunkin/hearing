import { describe, expect, test } from 'vitest'
import { parseMeasurement, toGrams, toMm } from '@/pipeline/units'

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
