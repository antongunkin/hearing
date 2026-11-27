import { z } from 'zod'
import { HttpUrl, IsoDateTime } from './field'

export const EntityKind = z.enum(['company', 'brand', 'domain', 'app', 'fda-applicant', 'sec-filer'])
export type EntityKind = z.infer<typeof EntityKind>

const EntityKey = /^[a-z0-9][a-z0-9.-]*$/

/** `id` is `<kind>:<key>`: `brand:<slug>`, `company:<slug>`, `domain:<host>`, `app:<slug>`, ... */
export const Entity = z
  .strictObject({
    id: z.string(),
    kind: EntityKind,
    name: z.string().min(1),
    iosId: z.string().regex(/^\d+$/).optional(),
    androidId: z.string().min(1).optional(),
    cik: z.string().regex(/^\d{10}$/).optional(),
  })
  .refine(
    (entity) => {
      const colon = entity.id.indexOf(':')
      return colon > 0 && entity.id.slice(0, colon) === entity.kind && EntityKey.test(entity.id.slice(colon + 1))
    },
    { path: ['id'], message: 'id must be "<kind>:<key>", with the kind of the entity and a lowercase key' },
  )
export type Entity = z.infer<typeof Entity>

export const EdgeKind = z.enum(['owns', 'makes-for', 'operates', 'publishes', 'files-as', 'renamed-to', 'redirects-to', 'links-to', 'hosts-documents-for'])
export type EdgeKind = z.infer<typeof EdgeKind>

/** Edges from the crawl between a brand and a domain. They are internal and never verified. */
export const DOMAIN_EDGE_KINDS = ['redirects-to', 'links-to', 'hosts-documents-for'] as const

export const SourceKind = z.enum(['crawl', 'company-page', 'press-release', 'sec-filing', 'fda-record', 'app-store', 'third-party'])
export type SourceKind = z.infer<typeof SourceKind>

export const EdgeSource = z.strictObject({
  url: HttpUrl,
  quote: z.string().min(1).optional(),
  fetchedAt: IsoDateTime,
  kind: SourceKind,
})
export type EdgeSource = z.infer<typeof EdgeSource>

const Period = z.string().regex(/^\d{4}(-\d{2})?$/)

export const Edge = z
  .strictObject({
    from: z.string(),
    to: z.string(),
    kind: EdgeKind,
    since: Period.optional(),
    until: Period.optional(),
    visibility: z.enum(['public', 'internal']),
    status: z.enum(['observed', 'proposed', 'verified']),
    sources: z.array(EdgeSource).min(1),
  })
  .superRefine((edge, ctx) => {
    const domain = (DOMAIN_EDGE_KINDS as readonly EdgeKind[]).includes(edge.kind)
    const issue = (path: 'visibility' | 'status' | 'sources', message: string) => ctx.addIssue({ code: 'custom', path: [path], message })

    if (edge.visibility === 'public' && edge.status !== 'verified') issue('visibility', 'a public edge must be verified')
    if (domain && edge.visibility !== 'internal') issue('visibility', `${edge.kind} edges are internal`)
    if (domain && edge.status === 'verified') issue('status', `${edge.kind} edges are observed or proposed`)
    if (domain && edge.sources.some((source) => source.kind !== 'crawl')) issue('sources', `${edge.kind} edges come from the crawl`)
    if (edge.status === 'observed' && !domain) issue('status', 'an observed edge must be a domain edge')
    if (edge.status === 'observed' && edge.sources.some((source) => source.kind !== 'crawl')) {
      issue('sources', 'an observed edge comes from the crawl only')
    }
    if (edge.status === 'verified') {
      const primary = edge.sources.some(
        (source) => source.quote !== undefined && source.kind !== 'crawl' && (source.kind !== 'third-party' || edge.kind === 'makes-for'),
      )
      if (!primary) issue('status', 'a verified edge needs a quoted primary source')
    }
    if (edge.sources.some((source) => source.kind === 'third-party' && edge.kind !== 'makes-for')) {
      issue('sources', 'a third-party source is only for makes-for')
    }
  })
export type Edge = z.infer<typeof Edge>

export function edgeKey(edge: Pick<Edge, 'from' | 'kind' | 'to'>): string {
  return `${edge.from} ${edge.kind} ${edge.to}`
}

export const Graph = z
  .strictObject({ entities: z.array(Entity), edges: z.array(Edge) })
  .superRefine((graph, ctx) => {
    const ids = new Set<string>()
    graph.entities.forEach((entity, i) => {
      if (ids.has(entity.id)) ctx.addIssue({ code: 'custom', path: ['entities', i, 'id'], message: `duplicate entity ${entity.id}` })
      ids.add(entity.id)
    })

    const keys = new Set<string>()
    graph.edges.forEach((edge, i) => {
      for (const end of ['from', 'to'] as const) {
        if (!ids.has(edge[end])) ctx.addIssue({ code: 'custom', path: ['edges', i, end], message: `unknown entity ${edge[end]}` })
      }
      const key = edgeKey(edge)
      if (keys.has(key)) ctx.addIssue({ code: 'custom', path: ['edges', i], message: `duplicate edge ${key}` })
      keys.add(key)
    })
  })
export type Graph = z.infer<typeof Graph>
