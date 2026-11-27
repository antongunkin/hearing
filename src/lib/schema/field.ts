import { z } from 'zod'
import { SLUG_PATTERN } from './slug-pattern'

// http(s) only: these URLs come from scraped pages and end up as links on the site.
export const HttpUrl = z.url({ protocol: /^https?$/ })
export const IsoDateTime = z.iso.datetime()
// Slugs and ids become file names and URL segments.
export const Slug = z.string().regex(SLUG_PATTERN)
// A month as `YYYY-MM`.
export const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export const SourceType = z.enum(['official', 'third-party', 'derived'])
export type SourceType = z.infer<typeof SourceType>

export const Derivation = z.strictObject({
  /** `earliest-archive-copy`: the input is the timestamp of the earliest Web Archive copy of the page. */
  op: z.enum(['oz-to-g', 'in-to-mm', 'pair-to-unit', 'from-list', 'earliest-archive-copy']),
  input: z.string(),
})
export type Derivation = z.infer<typeof Derivation>

const Provenance = z.strictObject({
  unit: z.string().optional(),
  sourceUrl: HttpUrl,
  quote: z.string().min(1),
  fetchedAt: IsoDateTime,
  sourceType: SourceType,
  derivation: Derivation.optional(),
})

export type Sourced<T> = z.infer<typeof Provenance> & { value: T }

/** A spec value that carries where it came from. */
export function sourced<T>(value: z.ZodType<T>): z.ZodType<Sourced<T>> {
  return Provenance.extend({ value }).refine(
    (field) => field.sourceType !== 'derived' || field.derivation !== undefined,
    { path: ['derivation'], message: 'derivation is required when sourceType is "derived"' },
  ) as unknown as z.ZodType<Sourced<T>>
}
