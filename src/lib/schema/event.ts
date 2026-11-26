import { z } from 'zod'
import { IsoDateTime } from './field'

export const Event = z.object({
  id: z.string().min(1),
  type: z.enum(['new-model', 'price-change', 'fda-clearance', 'fda-recall', 'app-update']),
  modelSlug: z.string().nullable(),
  date: z.union([z.iso.date(), IsoDateTime]),
  key: z.string(),
  text: z.string(),
  sources: z.array(z.string()),
})
export type Event = z.infer<typeof Event>
