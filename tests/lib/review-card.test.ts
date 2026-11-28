// @vitest-environment node
import { expect, test } from 'vitest'
import { cardDecision, failed, startsTicked } from '@/src/lib/review/card'
import type { CheckResult } from '@/src/lib/schema/pending'

const ok = (name: CheckResult['name']): CheckResult => ({ name, ok: true })
const noCrossCheck: CheckResult = { name: 'crosscheck', ok: false, detail: 'crosscheck-unavailable' }

test('a cross-check that could not run counts as not checked, not as a failure', () => {
  expect(startsTicked([ok('literal'), ok('range'), noCrossCheck])).toBe(true)
  expect(failed(noCrossCheck)).toBe(false)
  expect(startsTicked([noCrossCheck])).toBe(false) // nothing ran: not checked
  expect(startsTicked([])).toBe(false)
  expect(startsTicked([ok('literal'), { name: 'crosscheck', ok: false, detail: 'sonnet read 3' }])).toBe(false)
  expect(startsTicked([{ name: 'literal', ok: false }, noCrossCheck])).toBe(false)
})

test('only fields that started ticked and were unticked are rejected', () => {
  const form = new FormData()
  for (const path of ['colors', 'power', 'platform', 'tinnitus']) form.append('field', path)
  // Started ticked: platform, tinnitus. The owner kept tinnitus and colors.
  for (const path of ['platform', 'tinnitus']) form.append('ticked', path)
  for (const path of ['tinnitus', 'colors']) form.append('keep', path)

  expect(cardDecision(form)).toEqual({ skipPaths: ['power', 'platform'], rejectPaths: ['platform'] })
})
