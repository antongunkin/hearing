// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { AtlasCard } from '@/app/review/AtlasCard'
import { fieldsOf } from '@/app/review/ModelCard'
import type { PendingChange } from '@/src/lib/schema/pending'

vi.mock('@/app/review/actions', () => ({ approveChange: vi.fn(), rejectChange: vi.fn() }))

const source = {
  sourceUrl: 'https://old.example/products/x',
  quote: 'X is discontinued',
  fetchedAt: '2026-11-26T10:00:00.000Z',
  sourceType: 'official',
}

test('a new model card keeps discontinued, lineage and each document as one field', () => {
  const after = {
    slug: 'old-x',
    name: 'X',
    discontinued: { lastListed: '2022-09', source: { ...source, value: 'X' } },
    predecessor: { slug: 'old-w', source: { ...source, value: 'W' } },
    successor: { slug: 'old-y', source: { ...source, value: 'Y' } },
    documents: [
      { kind: 'datasheet', title: 'Datasheet', url: 'https://old.example/a.pdf', fetchedAt: source.fetchedAt },
      { kind: 'user-guide', title: 'Guide', url: 'https://old.example/b.pdf', fetchedAt: source.fetchedAt },
    ],
  }
  const optional = fieldsOf(after).filter((f) => f.optional)
  expect(optional.map((f) => f.path)).toEqual(['discontinued', 'predecessor', 'successor', 'documents.0', 'documents.1'])
  expect(fieldsOf(after).some((f) => f.path.startsWith('documents.0.'))).toBe(false)
})

test('the brand-history card shows every fact with its quote and source, the app, and a failed check', () => {
  const item: PendingChange = {
    id: 'brand-history-old',
    kind: 'brand-history',
    modelSlug: null,
    createdAt: '2026-11-26T10:00:00.000Z',
    path: 'brands/old.history',
    after: {
      facts: [
        { date: '2019-03', text: 'Old was sold to Big.', sourceUrl: 'https://web.archive.org/web/20190301id_/https://news.example/a', quote: 'Big buys Old', fetchedAt: '2026-11-26T10:00:00.000Z' },
        { date: '2020', text: 'The brand was retired.', sourceUrl: 'https://news.example/b', quote: 'retired the Old brand', fetchedAt: '2026-11-26T10:00:00.000Z' },
        { date: '2021-05-04', text: 'The site closed.', sourceUrl: 'https://news.example/c', quote: 'closed its site', fetchedAt: '2026-11-26T10:00:00.000Z' },
      ],
      app: { name: 'Old App', iosId: '123', available: false, checkedAt: '2026-11-26T10:00:00.000Z', sourceUrl: 'https://itunes.apple.com/lookup?id=123' },
    },
    checks: { 'brands/old.history': [{ name: 'literal', ok: false, detail: 'quote not on page' }] },
  }
  const html = renderToStaticMarkup(<AtlasCard item={item} />)
  expect(html).toContain('Mar 2019')
  expect(html).toContain('Old was sold to Big.')
  expect(html).toContain('<q>Big buys Old</q>')
  expect(html).toContain('href="https://web.archive.org/web/20190301/https://news.example/a"')
  expect(html).toContain('<q>retired the Old brand</q>')
  expect(html).toContain('May 4, 2021')
  expect(html).toContain('Old App')
  expect(html).toContain('no longer on the App Store, App Store checked 2026-11-26')
  expect(html).toContain('✗ failed:')
  expect(html).toContain('Approve')
})
