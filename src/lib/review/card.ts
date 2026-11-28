// How the new-model card reads its checks and its form. No I/O: client-safe.
import type { CheckResult } from '@/src/lib/schema/pending'

/** A check that could not run (the cross-check model could not be reached): the field is "not checked", not failed. */
export const notRun = (check: CheckResult) => check.name === 'crosscheck' && check.detail === 'crosscheck-unavailable'

/** True when a check ran and failed. */
export const failed = (check: CheckResult) => !check.ok && !notRun(check)

/** A field starts ticked when at least one check ran and every check that ran passed. */
export function startsTicked(checks: CheckResult[]): boolean {
  const ran = checks.filter((check) => !notRun(check))
  return ran.length > 0 && ran.every((check) => check.ok)
}

/**
 * What the card's form decides: the fields left out (`field` without `keep`), and of those the ones the
 * owner unticked (`ticked` without `keep`): only these are rejected. A field that started unticked and
 * stayed so is only left out this time, and comes back with the next run.
 */
export function cardDecision(form: FormData): { skipPaths: string[]; rejectPaths: string[] } {
  const keep = new Set(form.getAll('keep').map(String))
  const ticked = new Set(form.getAll('ticked').map(String))
  const skipPaths = form
    .getAll('field')
    .map(String)
    .filter((path) => !keep.has(path))
  return { skipPaths, rejectPaths: skipPaths.filter((path) => ticked.has(path)) }
}
