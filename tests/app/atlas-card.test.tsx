// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { AtlasCard } from '@/app/review/AtlasCard'
import type { PendingChange } from '@/src/lib/schema/pending'

vi.mock('@/app/review/actions', () => ({ approveChange: vi.fn(), rejectChange: vi.fn() }))

const base = { modelSlug: null, createdAt: '2026-11-26T10:00:00.000Z' }

test('a brand-config card shows the diff, refs as links or code, and a failed check visibly', () => {
  const item: PendingChange = {
    ...base,
    id: 'industry-brands-acme',
    kind: 'brand-config',
    path: 'brands/acme',
    before: { status: 'active', website: 'https://acme.example' },
    after: { status: 'gone', website: 'https://acme.example' },
    checks: { status: [{ name: 'literal', ok: false, detail: 'quote not on page' }] },
    refs: ['data/atlas/sites/acme.example/report.json', 'https://web.archive.org/web/2019/https://acme.example'],
  }
  const html = renderToStaticMarkup(<AtlasCard item={item} />)
  expect(html).toContain('<code>status</code>')
  expect(html).toContain('active')
  expect(html).toContain('gone')
  expect(html).not.toContain('<code>website</code>')
  expect(html).toContain('<code>data/atlas/sites/acme.example/report.json</code>')
  expect(html).toContain('<a href="https://web.archive.org/web/2019/https://acme.example"')
  expect(html).toContain('✗ failed:')
  expect(html).toContain('quote not on page')
})

test('a relation card reads "<from> <kind> <to> since <since>" with each source and quote', () => {
  const item: PendingChange = {
    ...base,
    id: 'industry-graph-x',
    kind: 'relation',
    path: 'graph/x',
    after: {
      edge: {
        from: 'company:gn', to: 'brand:phonak', kind: 'owns', since: '2019', visibility: 'internal', status: 'proposed',
        sources: [{ url: 'https://gn.example/about', quote: 'GN owns Phonak', fetchedAt: '2026-11-26T10:00:00.000Z', kind: 'company-page' }],
      },
      entities: [{ id: 'company:gn', kind: 'company', name: 'GN' }, { id: 'brand:phonak', kind: 'brand', name: 'Phonak' }],
    },
    checks: { quote: [{ name: 'literal', ok: true }] },
  }
  const html = renderToStaticMarkup(<AtlasCard item={item} />)
  expect(html).toContain('GN owns Phonak since 2019')
  expect(html).toContain('<q>GN owns Phonak</q>')
  expect(html).toContain('company-page')
  expect(html).toContain('✓')
})
