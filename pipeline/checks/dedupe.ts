import type { Event } from '@/src/lib/schema/event'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * True when `existing` holds an event of the same type, model and key dated within 30 days of `e`. An FDA
 * event is the same whichever model it names: its key (the 510(k) or recall number) is the record, and a
 * later model may match the record better than the first did.
 */
export function isDuplicateEvent(e: Event, existing: Event[]): boolean {
  const at = Date.parse(e.date)
  const fda = e.type === 'fda-clearance' || e.type === 'fda-recall'
  return existing.some(
    (other) =>
      other.type === e.type &&
      (fda || other.modelSlug === e.modelSlug) &&
      other.key === e.key &&
      Math.abs(Date.parse(other.date) - at) <= THIRTY_DAYS_MS,
  )
}
