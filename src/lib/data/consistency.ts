import type { Brand } from '../schema/brand'
import type { Graph } from '../schema/graph'
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
