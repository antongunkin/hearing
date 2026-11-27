// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { Brand } from '@/src/lib/schema/brand'
import type { Edge, Entity, Graph } from '@/src/lib/schema/graph'
import { companyBlock, edgeSourceNote, ownershipTable, publicEdges } from '@/src/lib/site/companies'

const src = { url: 'https://www.gn.example/about', quote: 'GN owns Phonak', fetchedAt: '2026-11-26T10:00:00.000Z', kind: 'company-page' } as const
const edge = (from: string, kind: Edge['kind'], to: string, extra: Partial<Edge> = {}): Edge => ({
  from,
  to,
  kind,
  visibility: 'public',
  status: 'verified',
  sources: [src],
  ...extra,
})
const ent = (id: string, name: string, extra: Partial<Entity> = {}) => ({ id, kind: id.split(':')[0], name, ...extra }) as Entity
const brand = (slug: string, name: string) =>
  Brand.parse({ slug, name, group: name, website: `https://${slug}.example`, imageLicense: 'none', defaultType: 'rx', status: 'active', scraper: { catalogUrls: [], modelUrlPattern: '', render: false } })
const brands = [brand('phonak', 'Phonak'), brand('acme', 'Acme'), brand('beta', 'Beta')]
const entities = [
  ent('company:gn', 'GN'),
  ent('company:maker', 'Maker Co'),
  ent('brand:phonak', 'Phonak'),
  ent('brand:acme', 'Acme'),
  ent('brand:beta', 'Beta'),
  ent('app:phonak-app', 'Phonak App', { iosId: '123', androidId: 'com.phonak' }),
]
const graphWith = (edges: Edge[]): Graph => ({ entities, edges })
const owns = edge('company:gn', 'owns', 'brand:phonak', { since: '2019' })

test('internal or proposed edges never reach the block or /companies', () => {
  for (const hidden of [
    { ...owns, visibility: 'internal', status: 'proposed' },
    { ...owns, visibility: 'internal', status: 'verified' },
    { ...owns, visibility: 'internal', status: 'observed' },
  ] as Edge[]) {
    const graph = graphWith([hidden])
    expect(publicEdges(graph)).toEqual([])
    expect(companyBlock('phonak', graph)).toBeNull()
    expect(ownershipTable(graph, brands)).toEqual([])
  }
})

test('the block gives owner, since, siblings, makers and apps of public edges', () => {
  const graph = graphWith([
    owns,
    edge('company:gn', 'owns', 'brand:beta'),
    edge('company:gn', 'owns', 'brand:acme', { visibility: 'internal', status: 'proposed' }),
    edge('company:maker', 'makes-for', 'brand:phonak', { sources: [{ ...src, kind: 'third-party' }] }),
    edge('brand:phonak', 'publishes', 'app:phonak-app'),
  ])
  expect(companyBlock('phonak', graph)).toEqual({
    owner: { name: 'GN', since: '2019', sources: [src] },
    siblings: ['beta'],
    makers: [{ name: 'Maker Co', sources: [{ ...src, kind: 'third-party' }] }],
    apps: [{ name: 'Phonak App', iosId: '123', androidId: 'com.phonak', sources: [src] }],
  })
  expect(companyBlock('acme', graph)).toBeNull()
})

test('the table lists companies and their brands by name', () => {
  const graph = graphWith([edge('company:gn', 'owns', 'brand:phonak'), edge('company:gn', 'owns', 'brand:beta'), edge('company:maker', 'owns', 'brand:acme')])
  expect(ownershipTable(graph, brands).map((row) => [row.company, row.brands.map((b) => b.name)])).toEqual([
    ['GN', ['Beta', 'Phonak']],
    ['Maker Co', ['Acme']],
  ])
})

test('a source note cites an archive copy without the raw flag and marks third parties', () => {
  const archived = { ...src, url: 'https://web.archive.org/web/20190301id_/https://www.gn.example/about' }
  expect(edgeSourceNote(archived)).toEqual({ sourceUrl: 'https://web.archive.org/web/20190301/https://www.gn.example/about', sourceType: 'official' })
  expect(edgeSourceNote({ ...src, kind: 'third-party' }).sourceType).toBe('third-party')
})

describe('ended edges', () => {
  const ended = (from: string, kind: Edge['kind'], to: string) => edge(from, kind, to, { since: '2015', until: '2021' })

  test('an ended owner never shows; a current owner wins whatever the order', () => {
    const old = ended('company:maker', 'owns', 'brand:phonak')
    for (const edges of [[old, owns], [owns, old]]) {
      expect(companyBlock('phonak', graphWith(edges))?.owner?.name).toBe('GN')
    }
    expect(companyBlock('phonak', graphWith([old]))).toBeNull()
    expect(ownershipTable(graphWith([old]), brands)).toEqual([])
  })

  test('an ended owner\'s other brands, makers and apps are not current', () => {
    const graph = graphWith([
      owns,
      ended('company:gn', 'owns', 'brand:beta'),
      ended('company:maker', 'makes-for', 'brand:phonak'),
      ended('brand:phonak', 'publishes', 'app:phonak-app'),
    ])
    expect(companyBlock('phonak', graph)).toEqual({ owner: { name: 'GN', since: '2019', sources: [src] }, siblings: [], makers: [], apps: [] })
    expect(ownershipTable(graph, brands).map((r) => r.brands.map((b) => b.slug))).toEqual([['phonak']])
  })
})
