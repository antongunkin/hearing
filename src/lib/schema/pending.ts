import { z } from 'zod'
import { IsoDateTime, Slug } from './field'

export const CheckResult = z.strictObject({
  name: z.enum(['literal', 'range', 'crosscheck', 'dedupe', 'forbidden', 'price-basis', 'brand-type']),
  ok: z.boolean(),
  detail: z.string().optional(),
})
export type CheckResult = z.infer<typeof CheckResult>

const change = {
  modelSlug: Slug.nullable(),
  /** Field path such as `variants.0.weightG`. */
  path: z.string(),
  before: z.unknown().optional(),
  after: z.unknown(),
  /** Check results keyed by field path. */
  checks: z.record(z.string(), z.array(CheckResult)),
}

export const PendingChange = z.strictObject({
  id: Slug,
  kind: z.enum(['new-model', 'spec-change', 'pros-cons', 'failed-check']),
  ...change,
  createdAt: IsoDateTime,
})
export type PendingChange = z.infer<typeof PendingChange>

export const CandidateChange = z.strictObject({
  kind: z.enum([
    'price',
    'app-version',
    'fda-event',
    'review-stats',
    'complaint-themes',
    'new-model',
    'spec-change',
    'pros-cons',
  ]),
  ...change,
})
export type CandidateChange = z.infer<typeof CandidateChange>
