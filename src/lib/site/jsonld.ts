// schema.org data: a Product with facts only, never a Review or an AggregateRating.
import type { Brand } from '@/src/lib/schema/brand'
import type { Model } from '@/src/lib/schema/model'
import { absoluteUrl } from './url'

const quantity = (value: number, unitCode: 'GRM' | 'MMT') => ({ '@type': 'QuantitativeValue', value, unitCode })

export function productJsonLd(model: Model, brand: Brand): object {
  const url = absoluteUrl(`/hearing-aids/${model.slug}`)
  const first = model.variants[0]
  const size = first?.dimensionsMm?.value
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${brand.name} ${model.name}`,
    brand: { '@type': 'Brand', name: brand.name },
    ...(url && { url }),
    ...(first?.weightG && { weight: quantity(first.weightG.value, 'GRM') }),
    ...(size && { depth: quantity(size.l, 'MMT'), width: quantity(size.w, 'MMT'), height: quantity(size.h, 'MMT') }),
  }
}
