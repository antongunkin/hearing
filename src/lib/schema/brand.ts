import { z } from 'zod'
import { HttpUrl, Slug } from './field'
import { ModelType } from './model'

export const BrandStatus = z.enum(['active', 'gone'])
export type BrandStatus = z.infer<typeof BrandStatus>

export const Brand = z.strictObject({
  slug: Slug,
  name: z.string().min(1),
  group: z.string(),
  website: HttpUrl,
  imageLicense: z.enum(['press-kit-editorial', 'none']),
  /** What the brand sells: the model type when its pages do not say (Rx pages rarely do). */
  defaultType: ModelType,
  /** `gone`: the brand's own site no longer answers, so it is not scraped live. */
  status: BrandStatus,
  scraper: z.strictObject({
    catalogUrls: z.array(HttpUrl),
    modelUrlPattern: z.string(),
    /** Pages that link to documents (datasheets, user guides) and model pages, like catalog pages. */
    supportUrls: z.array(HttpUrl).optional(),
    documentUrlPattern: z.string().optional(),
    render: z.boolean(),
  }),
  /** Where the Web Archive copies of a gone brand's model pages are found. */
  archive: z.strictObject({ catalogUrls: z.array(HttpUrl), modelUrlPattern: z.string().optional() }).optional(),
})
export type Brand = z.infer<typeof Brand>
