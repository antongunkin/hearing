import { z } from 'zod'
import { HttpUrl, IsoDateTime, Slug, sourced, YearMonth } from './field'

export const FormFactor = z.enum(['RIC', 'BTE', 'ITE', 'ITC', 'CIC', 'IIC', 'earbud'])
export type FormFactor = z.infer<typeof FormFactor>

export const ModelType = z.enum(['otc', 'rx', 'consumer'])
export type ModelType = z.infer<typeof ModelType>

export const PowerType = z.enum(['rechargeable', '10', '312', '13', '675'])
export type PowerType = z.infer<typeof PowerType>

export const Variant = z.strictObject({
  id: Slug,
  techLevel: z.string().optional(),
  formFactor: FormFactor,
  weightG: sourced(z.number()).optional(),
  dimensionsMm: sourced(z.strictObject({ l: z.number(), w: z.number(), h: z.number() })).optional(),
  power: sourced(
    z.strictObject({ type: PowerType, batteryHours: z.number().optional(), chargingCase: z.boolean().optional() }),
  ).optional(),
  ipRating: sourced(z.string()).optional(),
  priceUsd: z
    .union([sourced(z.number()), sourced(z.strictObject({ min: z.number(), max: z.number(), perPair: z.literal(true) }))])
    .optional(),
})
export type Variant = z.infer<typeof Variant>

/** Paths of the sourced values anywhere inside `node` that come from a third party. */
function* thirdPartyPaths(node: unknown, path: (string | number)[] = []): Generator<(string | number)[]> {
  if (node === null || typeof node !== 'object') return
  if ('sourceType' in node && node.sourceType === 'third-party') yield path
  for (const [key, child] of Object.entries(node)) {
    yield* thirdPartyPaths(child, [...path, Array.isArray(node) ? Number(key) : key])
  }
}

/** A predecessor or successor: another model's slug, with the source that says so. */
export const Lineage = z.strictObject({ slug: Slug, source: sourced(z.string()) })
export type Lineage = z.infer<typeof Lineage>

/** A document the maker publishes for the model: linked, never stored. */
export const ModelDocument = z.strictObject({
  kind: z.enum(['user-guide', 'datasheet', 'other']),
  title: z.string().min(1),
  url: HttpUrl,
  fetchedAt: IsoDateTime,
})
export type ModelDocument = z.infer<typeof ModelDocument>

const ModelFields = z.strictObject({
  slug: Slug,
  brand: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  type: ModelType,
  releaseDate: sourced(z.string()).optional(),
  platform: sourced(z.string()).optional(),
  predecessor: Lineage.optional(),
  successor: Lineage.optional(),
  /** Absent means on sale. `source.value` is the model name as the maker lists it. */
  discontinued: z.strictObject({ lastListed: YearMonth.optional(), source: sourced(z.string()) }).optional(),
  documents: z.array(ModelDocument).default([]),
  sameHardwareAs: z.array(z.strictObject({ slug: Slug, source: sourced(z.string()) })),
  materials: sourced(z.array(z.string())).optional(),
  colors: sourced(z.array(z.string())).optional(),
  connectivity: sourced(
    z.strictObject({
      mfi: z.boolean().optional(),
      asha: z.boolean().optional(),
      leAudio: z.boolean().optional(),
      auracast: z.boolean().optional(),
    }),
  ).optional(),
  tinnitus: sourced(z.boolean()).optional(),
  app: z
    .strictObject({
      name: z.string(),
      iosId: z.string().optional(),
      androidUrl: HttpUrl.optional(),
      iosVersion: sourced(z.string()).optional(),
    })
    .optional(),
  fda: sourced(z.strictObject({ status: z.string(), k510: z.string().optional() })).optional(),
  variants: z.array(Variant),
})

// Third-party sources are trusted only for hardware twins and Rx prices; every other spec must be official.
export const Model = ModelFields.superRefine((model, ctx) => {
  for (const path of thirdPartyPaths(model)) {
    const [list, , field] = path
    const allowed =
      (list === 'sameHardwareAs' && field === 'source') ||
      (list === 'variants' && field === 'priceUsd' && model.type === 'rx')
    if (!allowed) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'sourceType'],
        message: 'third-party sources are allowed only for sameHardwareAs and Rx prices',
      })
    }
  }
})
export type Model = z.infer<typeof Model>
