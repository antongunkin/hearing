import { expect, test } from 'vitest'
import { groupMismatches } from '@/src/lib/data/consistency'
import type { Brand } from '@/src/lib/schema/brand'
import type { Edge, Graph } from '@/src/lib/schema/graph'
import { loadDataset } from '@/src/lib/data/load'

test('brand groups agree with the approved owns relations in data/', async () => {
  const { brands, graph } = await loadDataset('data')
  expect(groupMismatches(brands, graph)).toEqual([])
})

test('an ended owner is not compared with the group', () => {
  const brand = { slug: 'phonak', group: 'Sonova' } as Brand
  const edge = (until?: string) => ({ from: 'company:gn', to: 'brand:phonak', kind: 'owns', visibility: 'public', status: 'verified', sources: [], ...(until && { until }) }) as unknown as Edge
  const graph = (e: Edge): Graph => ({ entities: [{ id: 'company:gn', kind: 'company', name: 'GN' }], edges: [e] })
  expect(groupMismatches([brand], graph(edge()))).toHaveLength(1)
  expect(groupMismatches([brand], graph(edge('2021')))).toEqual([])
})
