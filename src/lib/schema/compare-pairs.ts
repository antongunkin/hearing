import { z } from 'zod'
import { parsePairSlug } from '@/src/lib/site/pairs'

const PairSlug = z.string().refine((pair) => parsePairSlug(pair) !== null, 'not a canonical pair slug (a-vs-b)')

/** `data/compare-pairs.json`: every pair that has had a page, sorted, once each. */
export const ComparePairs = z
  .array(PairSlug)
  .refine((pairs) => pairs.every((pair, i) => i === 0 || pairs[i - 1] < pair), 'must be sorted, without duplicates')
