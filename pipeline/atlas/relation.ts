// A relation between companies, brands and apps that a page states: written to the graph as internal and
// proposed, and queued for /review, where approval alone makes it public and verified.
import { join } from 'node:path'
import { z } from 'zod'
import { enqueue, route } from '@/pipeline/apply'
import { readJson, type Dataset } from '@/src/lib/data/load'
import { normalizeName, slugify } from '@/src/lib/data/slug'
import type { Brand } from '@/src/lib/schema/brand'
import { edgeKey, type Edge, type Entity } from '@/src/lib/schema/graph'
import type { CandidateChange, CheckResult } from '@/src/lib/schema/pending'
import { readGraph, upsertEdge, upsertEntity, writeGraph } from './graph-store'

export type ProposedRelation = { edge: Edge; entities: Entity[]; checks: Record<string, CheckResult[]> }

/** The graph node for a name: a known brand by its slug, anything else by the slug of the name. */
export function entityFor(name: string, kind: 'brand' | 'company' | 'app', brands: Brand[]): Entity {
  const known = kind === 'brand' ? brands.find((brand) => normalizeName(brand.name) === normalizeName(name)) : undefined
  if (known) return { id: `brand:${known.slug}`, kind: 'brand', name: known.name }
  return { id: `${kind}:${slugify(name)}`, kind, name: name.trim() }
}

/**
 * Upserts the edge as internal and proposed into `<dataDir>/graph/` and queues a `relation` change. An edge
 * already verified is left alone, and so is one that `route` drops (rejected before). The graph and the
 * rejections are read from disk first: /review may have decided something since the run loaded `dataset`,
 * which is brought up to date.
 */
export async function queueRelation(rel: ProposedRelation, dataset: Dataset, dataDir: string): Promise<'queued' | 'dropped'> {
  dataset.graph = await readGraph(dataDir)
  dataset.rejections = await readJson(join(dataDir, 'rejections.json'), z.array(z.string()))
  const edge: Edge = { ...rel.edge, visibility: 'internal', status: 'proposed' }
  const key = edgeKey(edge)
  if (dataset.graph.edges.some((stored) => edgeKey(stored) === key && stored.status === 'verified')) return 'dropped'

  const change: CandidateChange = {
    kind: 'relation',
    modelSlug: null,
    path: `graph/${key}`,
    after: { edge, entities: rel.entities },
    checks: rel.checks,
    refs: [...new Set(edge.sources.map((source) => source.url))],
  }
  if (route(change, dataset.rejections) === 'drop') return 'dropped'

  dataset.graph = upsertEdge(rel.entities.reduce(upsertEntity, dataset.graph), edge)
  await writeGraph(dataset.graph, dataDir)
  await enqueue(change, dataDir)
  return 'queued'
}
