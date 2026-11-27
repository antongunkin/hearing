import { expect, test } from 'vitest'
import { groupMismatches } from '@/src/lib/data/consistency'
import { loadDataset } from '@/src/lib/data/load'

test('brand groups agree with the approved owns relations in data/', async () => {
  const { brands, graph } = await loadDataset('data')
  expect(groupMismatches(brands, graph)).toEqual([])
})
