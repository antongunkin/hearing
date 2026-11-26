import { z } from 'zod'
import { IsoDateTime } from './field'

export const CheckResult = z.object({
  name: z.enum(['literal', 'range', 'crosscheck', 'dedupe', 'forbidden']),
  ok: z.boolean(),
  detail: z.string().optional(),
})
export type CheckResult = z.infer<typeof CheckResult>

const change = {
  modelSlug: z.string().nullable(),
  /** Field path such as `variants.0.weightG`. */
  path: z.string(),
  before: z.unknown().optional(),
  after: z.unknown(),
  /** Check results keyed by field path. */
  checks: z.record(z.string(), z.array(CheckResult)),
}

export const PendingChange = z.object({
  id: z.string().min(1),
  kind: z.enum(['new-model', 'spec-change', 'pros-cons', 'failed-check']),
  ...change,
  createdAt: IsoDateTime,
})
export type PendingChange = z.infer<typeof PendingChange>

export const CandidateChange = z.object({
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
