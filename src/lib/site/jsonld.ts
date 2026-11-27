// schema.org data: a Product with facts only, never a Review or an AggregateRating.
import type { Brand } from '@/src/lib/schema/brand'
import type { Model } from '@/src/lib/schema/model'
import { absoluteUrl } from './url'

const quantity = (value: number, unitCode: 'GRM' | 'MMT') => ({ '@type': 'QuantitativeValue', value, unitCode })

/** The lowest official numeric price of a model on sale, with the page that states it; nothing otherwise. */
function offer(model: Model) {
  if (model.discontinued) return undefined
  const prices = model.variants.flatMap(({ priceUsd }) =>
    priceUsd && priceUsd.sourceType === 'official' && typeof priceUsd.value === 'number'
      ? [{ price: priceUsd.value, url: priceUsd.sourceUrl }]
      : [],
  )
  const [lowest] = prices.sort((a, b) => a.price - b.price)
  return lowest && { '@type': 'Offer', price: lowest.price, priceCurrency: 'USD', url: lowest.url }
}

export function productJsonLd(model: Model, brand: Brand): object {
  const url = absoluteUrl(`/hearing-aids/${model.slug}`)
  const first = model.variants[0]
  const size = first?.dimensionsMm?.value
  const offers = offer(model)
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${brand.name} ${model.name}`,
    brand: { '@type': 'Brand', name: brand.name },
    ...(url && { url }),
    ...(first?.weightG && { weight: quantity(first.weightG.value, 'GRM') }),
    ...(size && { depth: quantity(size.l, 'MMT'), width: quantity(size.w, 'MMT'), height: quantity(size.h, 'MMT') }),
    ...(offers && { offers }),
  }
}
