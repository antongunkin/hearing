// What the compare tool fetches. Client-safe: the tool reads the type, the build writes the JSON.
import type { Model } from '@/src/lib/schema/model'
import { buildCatalogIndex } from './catalog-index'
import { pairSlug, selectCuratedPairs } from './pairs'

/** `models` come without the quotes of their sources: the table does not show them, so they stay here. */
export type CompareData = { models: Model[]; pairs: string[] }

export function compareDataJson(models: Model[]): string {
  const pairs = selectCuratedPairs(buildCatalogIndex(models)).map(([a, b]) => pairSlug(a, b))
  return JSON.stringify({ models, pairs } satisfies CompareData, (key, value) => (key === 'quote' ? undefined : value))
}
