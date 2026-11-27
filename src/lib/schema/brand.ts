import { z } from 'zod'
import { HttpUrl, IsoDateTime, Slug } from './field'
import { ModelType } from './model'

export const BrandStatus = z.enum(['active', 'gone'])
export type BrandStatus = z.infer<typeof BrandStatus>

const HistoryFact = z.strictObject({
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`: as exact as its source page. */
  date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/),
  text: z.string().min(1),
  sourceUrl: HttpUrl,
  /** A quote that occurs literally in the source. */
  quote: z.string().min(1),
  fetchedAt: IsoDateTime,
})
export type HistoryFact = z.infer<typeof HistoryFact>

export const BrandHistory = z.strictObject({
  facts: z.array(HistoryFact).min(3).max(5),
  app: z
    .strictObject({ name: z.string(), iosId: z.string(), available: z.boolean(), checkedAt: IsoDateTime, sourceUrl: HttpUrl })
    .optional(),
})
export type BrandHistory = z.infer<typeof BrandHistory>

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
  /** What happened to the brand, in 3 to 5 sourced facts. */
  history: BrandHistory.optional(),
  historySources: z.array(HttpUrl).optional(),
})
export type Brand = z.infer<typeof Brand>
