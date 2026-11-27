// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { Value } from '@/app/review/ChangeRow'

const cited = { value: 'Select 300', quote: 'Hearing aids', sourceUrl: 'https://a.test/c', fetchedAt: '2026-11-27T09:00:00.000Z', sourceType: 'derived' }

test('an absence shows the finding, not the quote of the catalog page', () => {
  const html = renderToStaticMarkup(
    <Value value={{ source: { ...cited, derivation: { op: 'absent-from-catalog', input: 'https://a.test/c on 2026-11-27' } } }} />,
  )
  expect(html).toContain('Not listed on https://a.test/c on 2026-11-27')
  expect(html).not.toContain('<q>')
})

test('other sourced values keep their quote', () => {
  expect(renderToStaticMarkup(<Value value={{ ...cited, sourceType: 'official' }} />)).toContain('<q>Hearing aids</q>')
})
