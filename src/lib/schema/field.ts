import { z } from 'zod'

// http(s) only: these URLs come from scraped pages and end up as links on the site.
export const HttpUrl = z.url({ protocol: /^https?$/ })
export const IsoDateTime = z.iso.datetime()
// Slugs and ids become file names and URL segments.
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const SourceType = z.enum(['official', 'third-party', 'derived'])
export type SourceType = z.infer<typeof SourceType>

export const Derivation = z.strictObject({
  op: z.enum(['oz-to-g', 'in-to-mm', 'pair-to-unit', 'from-list']),
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
