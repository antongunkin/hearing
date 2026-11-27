import { z } from 'zod'
import { HttpUrl, IsoDateTime, Slug } from '@/src/lib/schema/field'
import { BrandStatus } from '@/src/lib/schema/brand'
import { ModelType } from '@/src/lib/schema/model'

/** One fetch-log line a fact was read from. */
export const LogRefSchema = z.strictObject({ url: z.string(), fetchedAt: IsoDateTime })
export type LogRef = z.infer<typeof LogRefSchema>

const validRegex = (source: string) => {
  try {
    new RegExp(source)
    return true
  } catch {
    return false
  }
}

export const Site = z.strictObject({
  /** Lowercase host without `www.`. */
  domain: z.string().regex(/^(?!www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/),
  start: HttpUrl,
  kind: z.enum(['brand', 'group', 'other']),
  mode: z.enum(['live', 'archive']),
  brands: z.array(Slug),
  company: z.string().optional(),
  /** Regex on the full URL; only matching internal URLs are crawled. */
  include: z.string().refine(validRegex, 'not a valid regular expression').optional(),
  newBrand: z
    .strictObject({ slug: Slug, name: z.string().min(1), group: z.string().min(1), defaultType: ModelType })
    .optional(),
})
export type Site = z.infer<typeof Site>

export const Sites = z.array(Site).refine((sites) => new Set(sites.map((site) => site.domain)).size === sites.length, {
  message: 'duplicate domain',
})

export const PageFacts = z.strictObject({
  url: z.string(),
  ref: LogRefSchema,
  archiveTimestamp: z.string().optional(),
  title: z.string().optional(),
  internalLinks: z.number().int().nonnegative(),
  external: z.array(z.string()),
  pdfs: z.array(z.string()),
  apps: z.strictObject({ ios: z.array(z.string()), android: z.array(z.string()) }),
  jsonLdTypes: z.array(z.string()),
  needsRender: z.boolean(),
})
export type PageFacts = z.infer<typeof PageFacts>

export const UrlTemplate = z.strictObject({
  pattern: z.string(),
  count: z.number().int().nonnegative(),
  examples: z.array(z.string()),
})
export type UrlTemplate = z.infer<typeof UrlTemplate>

export const RobotsGroup = z.strictObject({
  userAgents: z.array(z.string()),
  allow: z.array(z.string()),
  disallow: z.array(z.string()),
})
export type RobotsGroup = z.infer<typeof RobotsGroup>

export const SiteReport = z.strictObject({
  domain: z.string(),
  generatedAt: IsoDateTime,
  mode: z.enum(['live', 'archive']),
  start: HttpUrl,
  budget: z.number().int().nonnegative(),
  robots: z.strictObject({
    ref: LogRefSchema.nullable(),
    status: z.number().nullable(),
    crawlDelaySec: z.number().nonnegative().optional(),
    sitemaps: z.array(z.string()),
    groups: z.array(RobotsGroup),
    archived: z.strictObject({ ref: LogRefSchema, groups: z.array(RobotsGroup) }).optional(),
  }),
  sitemap: z.strictObject({
    refs: z.array(LogRefSchema),
    urlCount: z.number().int().nonnegative(),
    sections: z.array(z.strictObject({ path: z.string(), count: z.number().int().nonnegative() })),
  }),
  pages: z.array(PageFacts),
  templates: z.array(UrlTemplate),
  outbound: z.array(z.strictObject({ domain: z.string(), count: z.number().int().nonnegative(), examples: z.array(z.string()) })),
  redirects: z.array(z.strictObject({ from: z.string(), to: z.string(), ref: LogRefSchema })),
  pdfHosts: z.array(z.strictObject({ host: z.string(), count: z.number().int().nonnegative(), examples: z.array(z.string()) })),
  archive: z.strictObject({
    sections: z.array(
      z.strictObject({
        url: z.string(),
        byYear: z.record(z.string(), z.number().int().nonnegative()),
        latest: z.string().optional(),
      }),
    ),
  }),
  failures: z.array(z.strictObject({ url: z.string(), reason: z.string(), detail: z.string().optional() })),
  /** Sorted; at most `config.atlas.maxReportUrls`. Crawled, linked, sitemap and PDF URLs. */
  urls: z.array(z.string()),
})
export type SiteReport = z.infer<typeof SiteReport>

/** The sections of a site README, in order. */
export const SECTION_KEYS = ['what', 'structure', 'where', 'render', 'links', 'archive', 'next'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const SECTION_HEADINGS: Record<SectionKey, string> = {
  what: 'What this site is and whose',
  structure: 'Structure',
  where: 'Catalog, support, documents and apps',
  render: 'Rendering and quirks',
  links: 'Links to other sites',
  archive: 'Web Archive',
  next: 'What the next agent should check',
}

/** An object with one key per section, each holding `item`. */
export function bySection<T extends z.ZodType>(item: T) {
  return z.strictObject(Object.fromEntries(SECTION_KEYS.map((key) => [key, item])) as Record<SectionKey, T>)
}

/** One sentence of a site description and the fetch-log lines it was read from. */
export const Statement = z.strictObject({ text: z.string().min(1), sources: z.array(LogRefSchema).min(1) })
export type Statement = z.infer<typeof Statement>

export const Description = z.strictObject({
  domain: z.string(),
  generatedAt: IsoDateTime,
  model: z.string(),
  summary: z.string(),
  sections: bySection(z.array(Statement)),
  openQuestions: z.array(z.string()),
})
export type Description = z.infer<typeof Description>

/** What `atlas:describe` proposes for the brand's scraper config (`data/brands/<slug>.json`). */
export const ConfigProposal = z.strictObject({
  catalogUrls: z.array(HttpUrl),
  supportUrls: z.array(HttpUrl),
  modelUrlPattern: z.string(),
  documentUrlPattern: z.string().optional(),
  render: z.boolean(),
  archive: z.strictObject({ catalogUrls: z.array(HttpUrl), modelUrlPattern: z.string().optional() }).optional(),
  status: BrandStatus,
})
export type ConfigProposal = z.infer<typeof ConfigProposal>
