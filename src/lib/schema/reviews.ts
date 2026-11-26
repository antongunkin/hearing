import { z } from 'zod'
import { HttpUrl, IsoDateTime } from './field'

const Point = z.object({ text: z.string(), sources: z.array(z.string()) })

export const Reviews = z.object({
  slug: z.string().min(1),
  customer: z.array(
    z.object({
      sourceUrl: HttpUrl,
      rating: z.number(),
      count: z.number().int().nonnegative(),
      fetchedAt: IsoDateTime,
    }),
  ),
  complaintThemes: z.array(z.object({ theme: z.string(), share: z.number(), n: z.number().int().nonnegative() })),
  prosCons: z.object({ pros: z.array(Point), cons: z.array(Point) }).nullable(),
  videos: z.array(z.object({ id: z.string(), channel: z.string(), title: z.string() })),
})
export type Reviews = z.infer<typeof Reviews>
