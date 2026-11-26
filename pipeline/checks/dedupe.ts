import type { Event } from '@/src/lib/schema/event'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/** True when `existing` holds an event of the same type, model and key dated within 30 days of `e`. */
export function isDuplicateEvent(e: Event, existing: Event[]): boolean {
  const at = Date.parse(e.date)
  return existing.some(
    (other) =>
      other.type === e.type &&
      other.modelSlug === e.modelSlug &&
      other.key === e.key &&
      Math.abs(Date.parse(other.date) - at) <= THIRTY_DAYS_MS,
  )
}
