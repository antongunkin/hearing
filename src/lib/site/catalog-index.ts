// The compact list the catalog filters in the browser. Client-safe: types only from the schemas.
import type { Sourced } from '@/src/lib/schema/field'
import type { FormFactor, Model, ModelType, PowerType } from '@/src/lib/schema/model'

export type CatalogItem = {
  slug: string
  /** Brand slug. */
  brand: string
  name: string
  type: ModelType
  formFactors: FormFactor[]
  powerTypes: PowerType[]
  connectivity: { mfi?: boolean; asha?: boolean; leAudio?: boolean; auracast?: boolean }
  priceMin?: number
  /** Where `priceMin` is stated. Not the quote: the index is sent to the browser. */
  priceSource?: Pick<Sourced<unknown>, 'sourceUrl' | 'sourceType'>
  releaseDate?: string
  weightGMin?: number
}

export type CatalogFilter = {
  type?: ModelType[]
  formFactor?: FormFactor[]
  power?: PowerType[]
  auracast?: boolean
  brand?: string[]
  priceMax?: number
}

const unique = <T>(values: T[]) => [...new Set(values)]
const lowest = (values: number[]) => (values.length === 0 ? undefined : Math.min(...values))

export function buildCatalogIndex(models: Model[]): CatalogItem[] {
  return models.map((model) => {
    // The lowest price; of two equal ones, the one that needs no "According to".
    const [price] = model.variants
      .flatMap(({ priceUsd }) => {
        if (priceUsd === undefined) return []
        const { value, sourceUrl, sourceType } = priceUsd
        const min = typeof value === 'number' ? value : value.min
        return [{ min, thirdParty: Number(sourceType === 'third-party'), source: { sourceUrl, sourceType } }]
      })
      .sort((a, b) => a.min - b.min || a.thirdParty - b.thirdParty)
    const weightGMin = lowest(model.variants.flatMap(({ weightG }) => (weightG ? [weightG.value] : [])))
    return {
      slug: model.slug,
      brand: model.brand,
      name: model.name,
      type: model.type,
      formFactors: unique(model.variants.map((variant) => variant.formFactor)),
      powerTypes: unique(model.variants.flatMap(({ power }) => (power ? [power.value.type] : []))),
      connectivity: model.connectivity?.value ?? {},
      ...(price && { priceMin: price.min, priceSource: price.source }),
      ...(model.releaseDate && { releaseDate: model.releaseDate.value }),
      ...(weightGMin !== undefined && { weightGMin }),
    }
  })
}

/** Whether a model with these known values may be one of the wanted ones: with none known, it may. */
const mayBe = <T>(known: T[], wanted: T[] | undefined) =>
  !wanted?.length || known.length === 0 || known.some((value) => wanted.includes(value))

/**
 * Drops only the models whose known value does not fit. A model without a value passes every filter
 * except `priceMax` and `auracast`, which ask for a known value.
 */
export function filterCatalog(items: CatalogItem[], f: CatalogFilter): CatalogItem[] {
  return items.filter(
    (item) =>
      mayBe([item.type], f.type) &&
      mayBe(item.formFactors, f.formFactor) &&
      mayBe(item.powerTypes, f.power) &&
      mayBe([item.brand], f.brand) &&
      (!f.auracast || item.connectivity.auracast === true) &&
      (f.priceMax === undefined || (item.priceMin !== undefined && item.priceMin <= f.priceMax)),
  )
}

/** Sort order: newest release first, undated last. */
export const latestFirst = (a: { releaseDate?: string }, b: { releaseDate?: string }) =>
  (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '')
