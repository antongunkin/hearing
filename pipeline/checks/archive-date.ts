import { archiveMonth, parseArchiveUrl } from '@/src/lib/archive-url'
import type { Sourced } from '@/src/lib/schema/field'
import type { CheckResult } from '@/src/lib/schema/pending'

const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** A month taken from the earliest Web Archive copy: the timestamp in the copy's URL gives it, and the quote is on the page. */
export function archiveDateCheck(field: Sourced<string>, pageText: string): CheckResult {
  const fail = (detail: string): CheckResult => ({ name: 'literal', ok: false, detail })
  const { derivation } = field
  if (derivation?.op !== 'earliest-archive-copy') return fail('not derived from an earliest archive copy')
  const copy = parseArchiveUrl(field.sourceUrl)
  if (copy?.timestamp !== derivation.input) return fail('the source URL is not the archive copy the derivation names')
  if (field.value !== archiveMonth(derivation.input)) return fail(`value is not the month of ${derivation.input}`)
  const quote = squash(field.quote)
  if (quote === '' || !squash(pageText).includes(quote)) return fail('quote not found in source text')
  return { name: 'literal', ok: true }
}
