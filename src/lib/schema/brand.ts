import { z } from 'zod'

export const Brand = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  group: z.string(),
  website: z.string(),
  imageLicense: z.enum(['press-kit-editorial', 'none']),
  scraper: z.object({
    catalogUrls: z.array(z.string()),
    modelUrlPattern: z.string(),
    datasheetUrlPattern: z.string().optional(),
    render: z.boolean(),
  }),
})
export type Brand = z.infer<typeof Brand>
