import { z } from 'zod'
import { sourced } from './field'

export const FormFactor = z.enum(['RIC', 'BTE', 'ITE', 'ITC', 'CIC', 'IIC', 'earbud'])
export type FormFactor = z.infer<typeof FormFactor>

export const ModelType = z.enum(['otc', 'rx', 'consumer'])
export type ModelType = z.infer<typeof ModelType>

export const PowerType = z.enum(['rechargeable', '10', '312', '13', '675'])
export type PowerType = z.infer<typeof PowerType>

export const Variant = z.object({
  id: z.string().min(1),
  techLevel: z.string().optional(),
  formFactor: FormFactor,
  weightG: sourced(z.number()).optional(),
  dimensionsMm: sourced(z.object({ l: z.number(), w: z.number(), h: z.number() })).optional(),
  power: sourced(
    z.object({ type: PowerType, batteryHours: z.number().optional(), chargingCase: z.boolean().optional() }),
  ).optional(),
  ipRating: sourced(z.string()).optional(),
  priceUsd: z
    .union([sourced(z.number()), sourced(z.object({ min: z.number(), max: z.number(), perPair: z.literal(true) }))])
    .optional(),
})
export type Variant = z.infer<typeof Variant>

export const Model = z.object({
  slug: z.string().min(1),
  brand: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  type: ModelType,
  releaseDate: sourced(z.string()).optional(),
  platform: sourced(z.string()).optional(),
  predecessor: z.string().optional(),
  successor: z.string().optional(),
  sameHardwareAs: z.array(z.object({ slug: z.string(), source: sourced(z.string()) })),
  materials: sourced(z.array(z.string())).optional(),
  colors: sourced(z.array(z.string())).optional(),
  connectivity: sourced(
    z.object({
      mfi: z.boolean().optional(),
      asha: z.boolean().optional(),
      leAudio: z.boolean().optional(),
      auracast: z.boolean().optional(),
    }),
  ).optional(),
  tinnitus: sourced(z.boolean()).optional(),
  app: z
    .object({
      name: z.string(),
      iosId: z.string().optional(),
      androidUrl: z.string().optional(),
      iosVersion: sourced(z.string()).optional(),
    })
    .optional(),
  fda: sourced(z.object({ status: z.string(), k510: z.string().optional() })).optional(),
  variants: z.array(Variant),
})
export type Model = z.infer<typeof Model>
