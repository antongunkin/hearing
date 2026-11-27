import { expect, test } from 'vitest'
import { loadDataset } from '@/src/lib/data/load'

test('every brand file is migrated', async () => {
  const { brands } = await loadDataset('data')
  const bySlug = Object.fromEntries(brands.map((b) => [b.slug, b]))
  expect(bySlug.phonak.scraper.supportUrls).toEqual([
    'https://www.phonak.com/en-us/support/datasheets',
    'https://www.phonak.com/en-us/support/user-guides/infinio',
    'https://www.phonak.com/en-us/support/user-guides/eon',
  ])
  expect(bySlug.phonak.scraper.catalogUrls).toEqual(['https://www.phonak.com/en-us/hearing-devices/hearing-aids'])
  expect(bySlug.phonak.scraper.documentUrlPattern).toBeDefined()
  expect([bySlug.eargo.status, bySlug.lexie.status]).toEqual(['gone', 'gone'])
  expect(brands.filter((b) => b.status === 'gone').map((b) => b.slug)).toEqual(['eargo', 'lexie'])
})
