// A model with its maker, as pages name it. Types only from the schemas.
import type { Brand } from '@/src/lib/schema/brand'
import type { Model } from '@/src/lib/schema/model'

/** A model of an unlisted brand is a data error: it fails the build. */
export function brandOf(model: Pick<Model, 'slug' | 'brand'>, brands: Brand[]): Brand {
  const brand = brands.find((b) => b.slug === model.brand)
  if (!brand) throw new Error(`model ${model.slug} names an unknown brand: ${model.brand}`)
  return brand
}

/** "Brand Name". */
export function productName(model: Pick<Model, 'slug' | 'brand' | 'name'>, brands: Brand[]): string {
  return `${brandOf(model, brands).name} ${model.name}`
}
