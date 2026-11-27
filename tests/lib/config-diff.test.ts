import { describe, expect, test } from 'vitest'
import { configDiff } from '@/src/lib/review/config-diff'

describe('configDiff', () => {
  test('lists changed leaves only', () => {
    expect(configDiff({ scraper: { render: false, catalogUrls: ['a'] } }, { scraper: { render: false, catalogUrls: ['a', 'b'] } })).toEqual([
      { path: 'scraper.catalogUrls', before: ['a'], after: ['a', 'b'] },
    ])
  })

  test('added and removed leaves have one side only', () => {
    expect(configDiff({ a: 1, b: { c: 2 } }, { a: 1, b: { d: 3 }, e: 'x' })).toEqual([
      { path: 'b.c', before: 2 },
      { path: 'b.d', after: 3 },
      { path: 'e', after: 'x' },
    ])
  })

  test('equal values give no changes, whatever the key order', () => {
    expect(configDiff({ a: [{ x: 1, y: 2 }] }, { a: [{ y: 2, x: 1 }] })).toEqual([])
  })
})
