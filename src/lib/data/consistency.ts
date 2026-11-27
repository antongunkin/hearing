import type { Brand } from '../schema/brand'
import type { Graph } from '../schema/graph'
import type { Dataset } from './load'
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

const hostOf = (url: string): string | null => URL.parse(url)?.hostname.replace(/^www\./, '').toLowerCase() ?? null

/** Every `sourceUrl` in the value, at any depth. */
function sourceUrls(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return []
  if (Array.isArray(node)) return node.flatMap(sourceUrls)
  return Object.entries(node).flatMap(([key, child]) => (key === 'sourceUrl' && typeof child === 'string' ? [child] : sourceUrls(child)))
}

/**
 * Every sourced `sourceUrl` and document `url` of a gone brand's models that points at the brand's own website
 * (its host with or without `www.`, or a subdomain of it): the site no longer answers, so links go to Web Archive copies.
 */
export function liveLinksOfGoneBrands(dataset: Pick<Dataset, 'brands' | 'models'>): string[] {
  const links: string[] = []
  for (const brand of dataset.brands.filter((b) => b.status === 'gone')) {
    const own = hostOf(brand.website)
    if (own === null) continue
    const isOwn = (url: string) => {
      const host = URL.parse(url)?.hostname.toLowerCase().replace(/^www\./, '')
      return host !== undefined && (host === own || host.endsWith(`.${own}`))
    }
    for (const model of dataset.models.filter((m) => m.brand === brand.slug)) {
      for (const url of [...sourceUrls(model), ...model.documents.map((d) => d.url)]) if (isOwn(url)) links.push(url)
    }
  }
  return [...new Set(links)]
}
