import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { upsertEdge, upsertEntity, writeGraph } from '@/pipeline/atlas/graph-store'
import { groupMismatches } from '@/src/lib/data/consistency'
import { loadDataset } from '@/src/lib/data/load'
import { Brand } from '@/src/lib/schema/brand'
import { Edge, EdgeSource, Entity, Graph, edgeKey } from '@/src/lib/schema/graph'

const src = {
  url: 'https://www.gnhearing.com/about',
  quote: 'GN Store Nord owns Phonak',
  fetchedAt: '2026-11-26T10:00:00Z',
  kind: 'company-page',
} as EdgeSource
const crawl = { url: 'https://www.phonak.com/en-us', fetchedAt: '2026-11-26T10:00:00Z', kind: 'crawl' } as EdgeSource

const owns = {
  from: 'company:gn-store-nord',
  to: 'brand:phonak',
  kind: 'owns',
  visibility: 'internal',
  status: 'proposed',
  sources: [src],
} as Edge
const verifiedOwns = { ...owns, visibility: 'public', status: 'verified' } as Edge
const makesFor = { ...owns, kind: 'makes-for', to: 'brand:acme' } as Edge

const company = { id: 'company:gn-store-nord', kind: 'company', name: 'GN Store Nord' } as Entity
const phonak = { id: 'brand:phonak', kind: 'brand', name: 'Phonak' } as Entity
const domain = { id: 'domain:phonak.com', kind: 'domain', name: 'phonak.com' } as Entity

const brandPhonak = Brand.parse({
  slug: 'phonak',
  name: 'Phonak',
  group: 'Sonova',
  website: 'https://www.phonak.com',
  imageLicense: 'none',
  defaultType: 'rx',
  status: 'active',
  scraper: { catalogUrls: [], modelUrlPattern: '', render: false },
})

const graphOwnedBy = (name: string) => ({
  entities: [{ ...company, name }, phonak],
  edges: [verifiedOwns],
})

describe('Entity', () => {
  test('the id is "<kind>:<key>" with the entity kind and a lowercase key', () => {
    expect(Entity.safeParse(company).success).toBe(true)
    expect(Entity.safeParse({ ...company, id: 'brand:gn-store-nord' }).success).toBe(false)
    expect(Entity.safeParse({ ...company, id: 'company:GN Store' }).success).toBe(false)
    expect(Entity.safeParse({ ...company, id: 'company:' }).success).toBe(false)
  })

  test('the optional ids have their formats', () => {
    expect(Entity.safeParse({ ...phonak, iosId: '1234' }).success).toBe(true)
    expect(Entity.safeParse({ ...phonak, iosId: 'abc' }).success).toBe(false)
    expect(Entity.safeParse({ id: 'sec-filer:0001234567', kind: 'sec-filer', name: 'X', cik: '0001234567' }).success).toBe(true)
    expect(Entity.safeParse({ id: 'sec-filer:1', kind: 'sec-filer', name: 'X', cik: '1' }).success).toBe(false)
  })
})

describe('Edge', () => {
  test('a public edge must be verified, and verified needs a quoted primary source', () => {
    expect(Edge.safeParse({ ...owns, visibility: 'public', status: 'proposed' }).success).toBe(false)
    expect(Edge.safeParse({ ...owns, status: 'verified', sources: [{ ...src, quote: undefined }] }).success).toBe(false)
    expect(Edge.safeParse({ ...owns, status: 'verified', sources: [{ ...src, kind: 'third-party' }] }).success).toBe(false)
    expect(Edge.safeParse({ ...makesFor, status: 'verified', sources: [{ ...src, kind: 'third-party' }] }).success).toBe(true)
  })

  test('domain edges are observed or proposed, internal, from the crawl', () => {
    const redirect = {
      from: 'brand:phonak',
      to: 'domain:phonak.com',
      kind: 'redirects-to',
      visibility: 'internal',
      status: 'observed',
      sources: [crawl],
    }
    expect(Edge.safeParse(redirect).success).toBe(true)
    expect(Edge.safeParse({ ...redirect, status: 'proposed' }).success).toBe(true)
    expect(Edge.safeParse({ ...redirect, visibility: 'public', status: 'proposed' }).success).toBe(false)
    expect(Edge.safeParse({ ...redirect, visibility: 'public', status: 'verified', sources: [src] }).success).toBe(false)
    expect(Edge.safeParse({ ...redirect, status: 'proposed', sources: [src] }).success).toBe(false)
  })

  test('an observed edge is a domain edge from the crawl only', () => {
    expect(Edge.safeParse({ ...owns, status: 'observed', sources: [crawl] }).success).toBe(false)
    expect(Edge.safeParse({ ...owns, status: 'observed', sources: [src] }).success).toBe(false)
  })

  test('a third-party source is only for makes-for', () => {
    expect(Edge.safeParse({ ...owns, sources: [{ ...src, kind: 'third-party' }] }).success).toBe(false)
  })

  test('edgeKey joins from, kind and to', () => {
    expect(edgeKey(verifiedOwns)).toBe('company:gn-store-nord owns brand:phonak')
  })
})

describe('Graph', () => {
  test('an edge to an unknown entity is refused', () => {
    expect(Graph.safeParse({ entities: [phonak], edges: [verifiedOwns] }).success).toBe(false)
  })

  test('entity ids are unique and edge keys are unique', () => {
    expect(Graph.safeParse({ entities: [phonak, phonak], edges: [] }).success).toBe(false)
    expect(Graph.safeParse({ entities: [company, phonak], edges: [verifiedOwns, verifiedOwns] }).success).toBe(false)
  })

  test('an operates edge may point at a domain entity', () => {
    const operates = {
      from: 'company:gn-store-nord',
      to: 'domain:phonak.com',
      kind: 'operates',
      visibility: 'public',
      status: 'verified',
      sources: [src],
    }
    expect(Graph.safeParse({ entities: [company, domain], edges: [operates] }).success).toBe(true)
  })
})

describe('upsertEntity', () => {
  test('keeps the stored name and fills missing ids', () => {
    const graph = upsertEntity({ entities: [phonak], edges: [] }, { ...phonak, name: 'PHONAK', iosId: '1234' })
    expect(graph.entities).toEqual([{ ...phonak, iosId: '1234' }])
  })

  test('adds a new entity', () => {
    expect(upsertEntity({ entities: [], edges: [] }, phonak).entities).toEqual([phonak])
  })
})

describe('upsertEdge', () => {
  const empty = { entities: [], edges: [] }
  const other = { url: 'https://www.gnhearing.com/press', quote: 'Phonak joined GN', fetchedAt: '2026-11-27T10:00:00Z', kind: 'press-release' } as EdgeSource

  test('upsertEdge merges sources and never lowers the status', () => {
    const merged = upsertEdge(upsertEdge(empty, verifiedOwns), { ...verifiedOwns, status: 'proposed', visibility: 'internal', sources: [other] })
    expect(merged.edges[0]).toMatchObject({ status: 'verified', visibility: 'public' })
    expect(merged.edges[0].sources).toHaveLength(2)
  })

  test('a source already stored (same url and fetchedAt) is not added twice', () => {
    const once = upsertEdge(empty, owns)
    expect(upsertEdge(once, owns).edges[0].sources).toHaveLength(1)
  })

  test('keeps since and until when they are set', () => {
    const dated: Edge = { ...owns, since: '2020', until: '2024-06' }
    const merged = upsertEdge(upsertEdge(empty, dated), { ...owns, since: '2010', sources: [other] })
    expect(merged.edges[0]).toMatchObject({ since: '2020', until: '2024-06' })
  })
})

describe('writeGraph', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hearing-graph-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('writes entities by id and edges by key, and loads back', async () => {
    await writeFile(join(dir, 'rejections.json'), '[]')
    await writeFile(join(dir, 'blocklist.json'), '[]')
    const graph = { entities: [phonak, company], edges: [verifiedOwns] }
    await writeGraph(graph, dir)

    const entities = JSON.parse(await readFile(join(dir, 'graph', 'entities.json'), 'utf8'))
    expect(entities.map((e: { id: string }) => e.id)).toEqual(['brand:phonak', 'company:gn-store-nord'])
    expect((await loadDataset(dir)).graph).toEqual({ entities: [phonak, company], edges: [verifiedOwns] })
  })

  test('refuses a graph that is not valid', async () => {
    await expect(writeGraph({ entities: [], edges: [verifiedOwns] }, dir)).rejects.toThrow()
  })
})

describe('groupMismatches', () => {
  test('names a brand whose group differs from its verified owner', () => {
    expect(groupMismatches([{ ...brandPhonak, group: 'Sonova' }], graphOwnedBy('GN Store Nord'))).toEqual([
      'phonak: group "Sonova" but the verified owner is "GN Store Nord"',
    ])
  })

  test('a group that matches the owner, ignoring case and "hearing aids", is no mismatch', () => {
    expect(groupMismatches([{ ...brandPhonak, group: 'gn store nord hearing aids' }], graphOwnedBy('GN Store Nord'))).toEqual([])
  })

  test('a proposed owner is not checked', () => {
    const graph = { entities: [company, phonak], edges: [owns] }
    expect(groupMismatches([brandPhonak], graph)).toEqual([])
  })
})
