// What the site says about companies and brands: only public, verified edges of the graph ever reach it.
import { citableArchiveUrl } from '@/src/lib/archive-url'
import type { Brand } from '@/src/lib/schema/brand'
import type { Edge, EdgeSource, Entity, Graph } from '@/src/lib/schema/graph'

export type CompanyBlockData = {
  owner?: { name: string; since?: string; sources: EdgeSource[] }
  /** Slugs of the other brands of the owner. */
  siblings: string[]
  makers: { name: string; sources: EdgeSource[] }[]
  apps: { name: string; iosId?: string; androidId?: string; sources: EdgeSource[] }[]
}

export type OwnershipRow = {
  company: string
  brands: { slug: string; name: string; since?: string; sources: EdgeSource[] }[]
}

/** An edge with an `until` has ended: it is history, never shown as current. */
export const isCurrent = (edge: Edge) => edge.until === undefined

/** The only edges the site shows. */
export const publicEdges = (graph: Graph): Edge[] =>
  graph.edges.filter((edge) => edge.visibility === 'public' && edge.status === 'verified')

const byName = (a: string, b: string) => a.localeCompare(b, 'en')
const brandSlug = (id: string) => (id.startsWith('brand:') ? id.slice('brand:'.length) : undefined)

export function companyBlock(brandSlugOf: string, graph: Graph): CompanyBlockData | null {
  const id = `brand:${brandSlugOf}`
  const edges = publicEdges(graph).filter(isCurrent)
  const entity = (entityId: string): Entity | undefined => graph.entities.find((e) => e.id === entityId)
  const nameOf = (entityId: string) => entity(entityId)?.name ?? entityId

  const ownerEdge = edges.find((edge) => edge.kind === 'owns' && edge.to === id)
  const makers = edges
    .filter((edge) => edge.kind === 'makes-for' && edge.to === id)
    .map((edge) => ({ name: nameOf(edge.from), sources: edge.sources }))
    .sort((a, b) => byName(a.name, b.name))
  const apps = edges
    .filter((edge) => edge.kind === 'publishes' && edge.from === id)
    .flatMap((edge) => {
      const app = entity(edge.to)
      return app ? [{ name: app.name, iosId: app.iosId, androidId: app.androidId, sources: edge.sources }] : []
    })
    .map(({ iosId, androidId, ...rest }) => ({ ...rest, ...(iosId && { iosId }), ...(androidId && { androidId }) }))
    .sort((a, b) => byName(a.name, b.name))
  if (!ownerEdge && makers.length === 0 && apps.length === 0) return null

  const siblings = ownerEdge
    ? edges
        .filter((edge) => edge.kind === 'owns' && edge.from === ownerEdge.from && edge.to !== id)
        .flatMap((edge) => brandSlug(edge.to) ?? [])
        .sort(byName)
    : []
  return {
    ...(ownerEdge && {
      owner: { name: nameOf(ownerEdge.from), ...(ownerEdge.since && { since: ownerEdge.since }), sources: ownerEdge.sources },
    }),
    siblings,
    makers,
    apps,
  }
}

/** Companies by name with the brands they own, by name. A brand the site has no page for is left out. */
export function ownershipTable(graph: Graph, brands: Brand[]): OwnershipRow[] {
  const rows = new Map<string, OwnershipRow>()
  for (const edge of publicEdges(graph)) {
    if (edge.kind !== 'owns' || !isCurrent(edge)) continue
    const brand = brands.find((b) => `brand:${b.slug}` === edge.to)
    const company = graph.entities.find((e) => e.id === edge.from)
    if (!brand || !company) continue
    const row = rows.get(company.id) ?? { company: company.name, brands: [] }
    row.brands.push({ slug: brand.slug, name: brand.name, ...(edge.since && { since: edge.since }), sources: edge.sources })
    rows.set(company.id, row)
  }
  return [...rows.values()]
    .map((row) => ({ ...row, brands: row.brands.sort((a, b) => byName(a.name, b.name)) }))
    .sort((a, b) => byName(a.company, b.company))
}

/** For `SourceNote`. A Web Archive copy is cited without the archive's raw flag. */
export function edgeSourceNote(source: EdgeSource) {
  return {
    sourceUrl: citableArchiveUrl(source.url),
    sourceType: source.kind === 'third-party' ? ('third-party' as const) : ('official' as const),
  }
}
