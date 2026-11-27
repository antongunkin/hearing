import type { MetadataRoute } from 'next'
import { loadDataset } from '@/src/lib/data/load'
import { buildSitemapEntries } from '@/src/lib/site/sitemap-entries'
import { absoluteUrl } from '@/src/lib/site/url'

/** Empty while the site URL is unset: a sitemap holds absolute URLs only. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = absoluteUrl('')
  return base ? buildSitemapEntries(await loadDataset(), base) : []
}
