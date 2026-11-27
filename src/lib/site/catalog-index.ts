// The compact list the catalog filters in the browser. Client-safe: types only from the schemas.
import type { Event } from '@/src/lib/schema/event'
import type { Sourced } from '@/src/lib/schema/field'
import type { FormFactor, Model, ModelType, PowerType } from '@/src/lib/schema/model'
import { priceMonth } from './format'
import { isIndexable } from './indexing'

export type CatalogItem = {
  slug: string
  /** Brand slug. */
  brand: string
  name: string
  type: ModelType
  formFactors: FormFactor[]
  powerTypes: PowerType[]
  connectivity: { mfi?: boolean; asha?: boolean; leAudio?: boolean; auracast?: boolean }
  /** Not set for a discontinued model: see `lastListedPrice`. */
  priceMin?: number
  /** Where `priceMin` (or `lastListedPrice`) is stated. Not the quote: the index is sent to the browser. */
  priceSource?: Pick<Sourced<unknown>, 'sourceUrl' | 'sourceType'>
  releaseDate?: string
  /** When the model was added to the database: orders models without a release date, never shown as one. */
  addedOn?: string
  weightGMin?: number
  /** Present for a discontinued model. */
  discontinued?: { lastListed?: string }
  /** The price of a discontinued model, kept apart from `priceMin` so that no price filter or sort sees it. */
  lastListedPrice?: { min: number; month: string }
  /** Slug of the model that replaced this one. */
  successor?: string
  /** Whether the model's page may be indexed (see `isIndexable`). */
  indexable: boolean
}

export type CatalogFilter = {
  type?: ModelType[]
  formFactor?: FormFactor[]
  power?: PowerType[]
  auracast?: boolean
  brand?: string[]
  priceMax?: number
  /** Models no longer sold are left out unless this is set. */
  includeDiscontinued?: boolean
}

const unique = <T>(values: T[]) => [...new Set(values)]
const lowest = (values: number[]) => (values.length === 0 ? undefined : Math.min(...values))

/** The date of the model's `new-model` event, if it has one. */
export function addedOn(slug: string, events: Event[]): string | undefined {
  return events.find((event) => event.type === 'new-model' && event.modelSlug === slug)?.date.slice(0, 10)
}

/** `events` give the dates models were added (see `addedOn`). */
export function buildCatalogIndex(models: Model[], events: Event[] = []): CatalogItem[] {
  return models.map((model) => {
    const added = addedOn(model.slug, events)
    // The lowest price; of two equal ones, the one that needs no "According to".
    const [price] = model.variants
      .flatMap(({ priceUsd }) => {
        if (priceUsd === undefined) return []
        const { value, sourceUrl, sourceType } = priceUsd
        const min = typeof value === 'number' ? value : value.min
        return [{ min, thirdParty: Number(sourceType === 'third-party'), source: { sourceUrl, sourceType }, month: priceMonth(priceUsd) }]
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
      ...(price && { priceSource: price.source }),
      ...(price && !model.discontinued && { priceMin: price.min }),
      ...(price && model.discontinued && { lastListedPrice: { min: price.min, month: price.month } }),
      ...(model.discontinued && { discontinued: { ...(model.discontinued.lastListed && { lastListed: model.discontinued.lastListed }) } }),
      ...(model.successor && { successor: model.successor.slug }),
      indexable: isIndexable(model),
      ...(model.releaseDate && { releaseDate: model.releaseDate.value }),
      ...(added && { addedOn: added }),
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
      (f.includeDiscontinued || item.discontinued === undefined) &&
      mayBe([item.type], f.type) &&
      mayBe(item.formFactors, f.formFactor) &&
      mayBe(item.powerTypes, f.power) &&
      mayBe([item.brand], f.brand) &&
      (!f.auracast || item.connectivity.auracast === true) &&
      (f.priceMax === undefined || (item.priceMin !== undefined && item.priceMin <= f.priceMax)),
  )
}

type Dated = { releaseDate?: string; addedOn?: string }

/** Sort order: newest release first; a model without a release date by when it was added; undated last. */
export const latestFirst = (a: Dated, b: Dated) => (b.releaseDate ?? b.addedOn ?? '').localeCompare(a.releaseDate ?? a.addedOn ?? '')
