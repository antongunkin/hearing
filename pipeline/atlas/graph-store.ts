// Adds entities and edges to the company graph. Writes go through writeJson, so readers never see a partial file.
import { join } from 'node:path'
import { z } from 'zod'
import { readJson } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'
import { Edge, edgeKey, Entity, Graph } from '@/src/lib/schema/graph'

/** An entity already stored keeps its name and its values; missing ids are filled in. */
export function upsertEntity(graph: Graph, entity: Entity): Graph {
  if (!graph.entities.some((stored) => stored.id === entity.id)) {
    return { ...graph, entities: [...graph.entities, entity] }
  }
  return { ...graph, entities: graph.entities.map((stored) => (stored.id === entity.id ? { ...entity, ...stored } : stored)) }
}

const STATUS_RANK: Record<Edge['status'], number> = { observed: 0, proposed: 1, verified: 2 }

/** An edge with the same key merges its sources, keeps the higher status and public visibility only when earned. */
export function upsertEdge(graph: Graph, edge: Edge): Graph {
  const key = edgeKey(edge)
  const stored = graph.edges.find((candidate) => edgeKey(candidate) === key)
  if (!stored) return { ...graph, edges: [...graph.edges, edge] }

  const sources = [...stored.sources]
  for (const source of edge.sources) {
    if (!sources.some((known) => known.url === source.url && known.fetchedAt === source.fetchedAt)) sources.push(source)
  }
  const merged: Edge = {
    ...stored,
    status: STATUS_RANK[edge.status] > STATUS_RANK[stored.status] ? edge.status : stored.status,
    visibility: stored.visibility === 'public' || (edge.visibility === 'public' && edge.status === 'verified') ? 'public' : 'internal',
    sources,
  }
  const since = stored.since ?? edge.since
  const until = stored.until ?? edge.until
  if (since !== undefined) merged.since = since
  if (until !== undefined) merged.until = until

  return { ...graph, edges: graph.edges.map((candidate) => (candidate === stored ? merged : candidate)) }
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The two graph files as stored (paths relative to the data directory): entities by id, edges by key. */
export function graphFiles(graph: Graph): { path: string; value: unknown }[] {
  const valid = Graph.parse(graph)
  return [
    { path: 'graph/entities.json', value: [...valid.entities].sort((a, b) => byText(a.id, b.id)) },
    { path: 'graph/edges.json', value: [...valid.edges].sort((a, b) => byText(edgeKey(a), edgeKey(b))) },
  ]
}

/** Writes `graph/entities.json` (by id) and `graph/edges.json` (by key) under the data directory. */
export async function writeGraph(graph: Graph, dir = 'data'): Promise<void> {
  for (const { path, value } of graphFiles(graph)) await writeJson(join(dir, path), value)
}

/** The graph as stored under the data directory now; a missing file holds nothing. */
export async function readGraph(dir = 'data'): Promise<Graph> {
  const read = async <T>(name: string, schema: z.ZodType<T>): Promise<T[]> => {
    try {
      return await readJson(join(dir, 'graph', name), z.array(schema))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  return Graph.parse({ entities: await read('entities.json', Entity), edges: await read('edges.json', Edge) })
}
