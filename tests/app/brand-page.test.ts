// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { generateMetadata } from '@/app/brands/[brand]/page'
import type { Dataset } from '@/src/lib/data/load'
import { Model } from '@/src/lib/schema/model'

const data = vi.hoisted(() => ({ value: undefined as unknown as Dataset }))
vi.mock('@/src/lib/data/load', () => ({ loadDataset: async () => data.value }))

const brand = (slug: string) => ({
  slug,
  name: slug,
  group: slug,
  website: `https://${slug}.example`,
  imageLicense: 'none' as const,
  defaultType: 'rx' as const,
  scraper: { catalogUrls: [], modelUrlPattern: '', render: false },
})

test('a brand page with no models is not indexed; one with models is', async () => {
  const model = Model.parse({ slug: 'full-one', brand: 'full', name: 'One', aliases: [], type: 'rx', sameHardwareAs: [], variants: [] })
  data.value = { brands: [brand('full'), brand('empty')], models: [model], reviews: [], events: [], pending: [], rejections: [], blocklist: [], comparePairs: [] }
  const metadata = (slug: string) => generateMetadata({ params: Promise.resolve({ brand: slug }) })

  expect((await metadata('empty')).robots).toEqual({ index: false, follow: true })
  expect((await metadata('full')).robots).toBeUndefined()
})
