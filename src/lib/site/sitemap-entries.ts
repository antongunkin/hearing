// Every page for search engines: not /compare (a noindex tool), its data file, or the owner's /review.
import type { Dataset } from '@/src/lib/data/load'
import { buildCatalogIndex } from './catalog-index'
import { ownershipTable } from './companies'
import { isIndexable } from './indexing'
import { pairSlug, publishedPairs } from './pairs'
import { SERVICE_PAGES } from './service-pages'

export type SitemapEntry = { url: string; lastModified?: string }

/** When the sourced values anywhere inside `node` were fetched. */
function fetchDates(node: unknown): string[] {
  if (node === null || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([key, child]) =>
    key === 'fetchedAt' && typeof child === 'string' ? [child] : fetchDates(child),
  )
}

/**
 * `baseUrl` is the site URL without a trailing slash. A page is dated only by what its data says: the
 * latest fetch of what it shows, or an event's date. Never by the time of the build.
 */
export function buildSitemapEntries(dataset: Dataset, baseUrl: string): SitemapEntry[] {
  const { brands, models, reviews, events, comparePairs, graph } = dataset
  const entry = (path: string, dates: string[] = []): SitemapEntry => {
    const lastModified = [...dates].sort().at(-1)
    return { url: `${baseUrl}${path}`, ...(lastModified && { lastModified }) }
  }
  /** What a model's own page shows: the model and its reviews. */
  const pageDates = (slug: string) =>
    fetchDates([models.find((m) => m.slug === slug), reviews.find((r) => r.slug === slug)])
  const modelDates = fetchDates(models)
  const eventDates = events.map((event) => event.date)

  return [
    entry('/', [...modelDates, ...eventDates]),
    entry('/hearing-aids', modelDates),
    ...models.filter(isIndexable).map(({ slug }) => entry(`/hearing-aids/${slug}`, pageDates(slug))),
    ...publishedPairs(buildCatalogIndex(models, events), comparePairs).map(([a, b]) =>
      entry(`/compare/${pairSlug(a, b)}`, [...pageDates(a), ...pageDates(b)]),
    ),
    // A brand page without models is not indexed (see its metadata).
    ...brands.flatMap(({ slug }) => {
      const own = models.filter((m) => m.brand === slug)
      return own.length === 0 ? [] : [entry(`/brands/${slug}`, fetchDates(own))]
    }),
    entry('/platforms', modelDates),
    entry('/news', eventDates),
    ...events.map((event) => entry(`/news/${event.id}`, [event.date])),
    // Only with a verified ownership record; dated by the newest source of the table.
    ...(ownershipTable(graph, brands).length === 0
      ? []
      : [entry('/companies', fetchDates(ownershipTable(graph, brands)))]),
    ...SERVICE_PAGES.map(([path]) => entry(path)),
  ]
}
