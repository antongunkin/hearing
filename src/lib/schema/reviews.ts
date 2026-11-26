import { z } from 'zod'
import { HttpUrl, IsoDateTime, Slug } from './field'

const Point = z.strictObject({ text: z.string(), sources: z.array(HttpUrl) })

export const Reviews = z.strictObject({
  slug: Slug,
  customer: z.array(
    z.strictObject({
      sourceUrl: HttpUrl,
      rating: z.number(),
      count: z.number().int().nonnegative(),
      fetchedAt: IsoDateTime,
    }),
  ),
  complaintThemes: z.array(z.strictObject({ theme: z.string(), share: z.number(), n: z.number().int().nonnegative() })),
  prosCons: z.strictObject({ pros: z.array(Point), cons: z.array(Point) }).nullable(),
  videos: z.array(z.strictObject({ id: z.string(), channel: z.string(), title: z.string() })),
})
export type Reviews = z.infer<typeof Reviews>
