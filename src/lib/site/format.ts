// How values read on the site. Client-safe: types only from the schemas.
import type { Variant } from '@/src/lib/schema/model'

type Price = NonNullable<Variant['priceUsd']>['value']

export const formatNumber = (value: number) => value.toLocaleString('en-US')

const usd = (value: number) =>
  value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  })

export function formatPrice(price: number | Price): string {
  if (typeof price === 'number') return usd(price)
  const { min, max } = price
  return `${min === max ? usd(min) : `${usd(min)}–${usd(max)}`} per pair`
}

/** `YYYY-MM`, `YYYY-MM-DD` or a date and time, at the precision given; any other text as it is. */
export function formatDate(date: string): string {
  const match = /^(\d{4}-\d{2})(-\d{2})?(?:T.*)?$/.exec(date)
  if (match === null) return date
  const time = Date.parse(`${match[1]}${match[2] ?? '-01'}T00:00:00Z`)
  if (Number.isNaN(time)) return date
  return new Date(time).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    ...(match[2] && { day: 'numeric' }),
    timeZone: 'UTC',
  })
}

export const hostname = (url: string) => new URL(url).hostname

export const TYPE_LABELS = { otc: 'Over-the-counter', rx: 'Prescription', consumer: 'Consumer earbud' } as const

export const EVENT_LABELS = {
  'new-model': 'New model',
  'price-change': 'Price change',
  'fda-clearance': 'FDA clearance',
  'fda-recall': 'FDA recall',
  'app-update': 'App update',
} as const

/** `rechargeable` or a disposable battery size. */
export const powerLabel = (type: string) => (type === 'rechargeable' ? 'Rechargeable' : `Size ${type} disposable`)
