import { z } from 'zod'
import { HttpUrl, Slug } from './field'

export const Brand = z.strictObject({
  slug: Slug,
  name: z.string().min(1),
  group: z.string(),
  website: HttpUrl,
  imageLicense: z.enum(['press-kit-editorial', 'none']),
  scraper: z.strictObject({
    catalogUrls: z.array(HttpUrl),
    modelUrlPattern: z.string(),
    datasheetUrlPattern: z.string().optional(),
    render: z.boolean(),
  }),
})
export type Brand = z.infer<typeof Brand>
