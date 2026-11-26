import { z } from 'zod'
import { HttpUrl, IsoDateTime, Slug } from './field'

export const Event = z.strictObject({
  id: Slug,
  type: z.enum(['new-model', 'price-change', 'fda-clearance', 'fda-recall', 'app-update']),
  modelSlug: Slug.nullable(),
  date: z.union([z.iso.date(), IsoDateTime]),
  key: z.string(),
  text: z.string(),
  sources: z.array(HttpUrl),
})
export type Event = z.infer<typeof Event>
