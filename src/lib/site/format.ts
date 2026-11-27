// How values read on the site. Client-safe: types only from the schemas.
import { archiveMonth, parseArchiveUrl } from '@/src/lib/archive-url'
import type { Sourced } from '@/src/lib/schema/field'
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
  'model-discontinued': 'Discontinued',
} as const

/** `rechargeable` or a disposable battery size. */
export const powerLabel = (type: string) => (type === 'rechargeable' ? 'Rechargeable' : `Size ${type} disposable`)

/** How a Web Archive copy is cited; undefined for a URL that is not an archive copy. */
export function archiveLabel(sourceUrl: string): string | undefined {
  const copy = parseArchiveUrl(sourceUrl)
  return copy === null ? undefined : `official page, archived copy of ${formatDate(archiveMonth(copy.timestamp))}, via Internet Archive`
}

/** `YYYY-MM` a price was seen: the month of the archive copy it was read from, else the month it was fetched (not after `lastListed`). */
export function priceMonth(price: Sourced<unknown>, lastListed?: string): string {
  const copy = parseArchiveUrl(price.sourceUrl)
  if (copy) return archiveMonth(copy.timestamp)
  const fetched = price.fetchedAt.slice(0, 7)
  // Never a later month than the model was last listed.
  return lastListed !== undefined && lastListed < fetched ? lastListed : fetched
}
