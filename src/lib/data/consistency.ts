import type { Brand } from '../schema/brand'
import type { Graph } from '../schema/graph'
import type { Dataset } from './load'
import { isArchiveHostUrl, originalUrl } from '../archive-url'
import { normalizeName } from './slug'

/** One message per brand whose current verified owner (a company) is not the brand's group. */
export function groupMismatches(brands: Brand[], graph: Graph): string[] {
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]))
  const messages: string[] = []
  for (const brand of brands) {
    const owner = graph.edges
      .filter((edge) => edge.kind === 'owns' && edge.status === 'verified' && edge.until === undefined && edge.to === `brand:${brand.slug}`)
      .map((edge) => entities.get(edge.from))
      .find((entity) => entity?.kind === 'company' && normalizeName(entity.name) !== normalizeName(brand.group))
    if (owner) messages.push(`${brand.slug}: group "${brand.group}" but the verified owner is "${owner.name}"`)
  }
  return messages
}

const hostOf = (url: string): string => URL.parse(url)?.hostname.replace(/^www\./, '').replace(/\.$/, '').toLowerCase() ?? ''

/** The hosts of a brand's own site: its website, catalog, support and archive catalog pages, without `www.`. A Web Archive copy URL counts as its original; the Web Archive itself is never a host. */
export function ownHosts(brand: Pick<Brand, 'website' | 'scraper' | 'archive'>): string[] {
  const urls = [brand.website, ...(brand.scraper?.catalogUrls ?? []), ...(brand.scraper?.supportUrls ?? []), ...(brand.archive?.catalogUrls ?? [])]
  const originals = urls.map(originalUrl).filter((url) => !isArchiveHostUrl(url))
  return [...new Set(originals.map(hostOf).filter((host) => host !== ''))]
}

/** Every link in the value, at any depth: a `sourceUrl`, a document `url`, an entry of `sources`. */
function linksOf(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return []
  if (Array.isArray(node)) return node.flatMap(linksOf)
  return Object.entries(node).flatMap(([key, child]) => {
    if ((key === 'sourceUrl' || key === 'url') && typeof child === 'string') return [child]
    if (key === 'sources' && Array.isArray(child)) return [...child.filter((c): c is string => typeof c === 'string'), ...linksOf(child)]
    return linksOf(child)
  })
}

/**
 * Every link of the data that points at a gone brand's own site (its website, catalog or support hosts, with or
 * without `www.`, or a subdomain of them): the site no longer answers, so links go to Web Archive copies. Every
 * model file is looked at (a twin or a third-party price of another brand may cite it too), every reviews file and
 * every brand's history.
 */
export function liveLinksOfGoneBrands(dataset: Pick<Dataset, 'brands' | 'models'> & Partial<Pick<Dataset, 'reviews'>>): string[] {
  const gone = dataset.brands.filter((b) => b.status === 'gone').flatMap(ownHosts)
  if (gone.length === 0) return []
  const isGone = (url: string) => {
    const host = hostOf(url)
    return host !== '' && gone.some((domain) => host === domain || host.endsWith(`.${domain}`))
  }
  const links = [...dataset.models, ...(dataset.reviews ?? []), ...dataset.brands.map((brand) => brand.history)].flatMap(linksOf).filter(isGone)
  return [...new Set(links)]
}
