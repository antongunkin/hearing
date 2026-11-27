// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { priorCatalogCopies } from '@/pipeline/archive/catalog-history'
import { appendLog, storeBody, type FetchLogEntry } from '@/pipeline/fetch/raw-store'

const CATALOG = 'https://brand.test/hearing-aids'
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'catalog-history-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

async function logged(extra: Partial<FetchLogEntry>, html: string | null = '<h1>Paradise</h1><p>Hearing aids</p>'): Promise<void> {
  const bodyHash = html === null ? undefined : await storeBody(new TextEncoder().encode(html), dir)
  await appendLog(
    { url: CATALOG, redirects: [], fetchedAt: '2026-01-10T00:00:00.000Z', status: 200, contentType: 'text/html', via: 'live', rendered: false, ...(bodyHash && { bodyHash }), ...extra },
    dir,
  )
}

test('gives the earlier copies of the catalog pages, newest first, as pages of visible text', async () => {
  await logged({ fetchedAt: '2025-03-01T00:00:00.000Z' }, '<h1>Old</h1>')
  await logged({ fetchedAt: '2026-01-10T00:00:00.000Z' })
  await logged({ url: 'https://brand.test/other', fetchedAt: '2026-01-11T00:00:00.000Z' })

  const copies = await priorCatalogCopies([CATALOG], '2026-06-01T00:00:00.000Z', dir)

  expect(copies.map((p) => [p.url, p.fetchedAt, p.text.trim()])).toEqual([
    [CATALOG, '2026-01-10T00:00:00.000Z', expect.stringContaining('Paradise')],
    [CATALOG, '2025-03-01T00:00:00.000Z', 'Old'],
  ])
})

test('leaves out copies of this run, skipped fetches, errors, lost bodies; uses the final URL and archive copies', async () => {
  await logged({ fetchedAt: '2026-06-01T00:00:00.000Z' })
  await logged({ skipped: 'robots', status: undefined, fetchedAt: '2026-01-01T00:00:00.000Z' }, null)
  await logged({ status: 404, fetchedAt: '2026-01-02T00:00:00.000Z' })
  await logged({ fetchedAt: '2026-01-03T00:00:00.000Z' }, null)
  await logged({ url: 'https://brand.test/old-path', finalUrl: CATALOG, fetchedAt: '2026-01-04T00:00:00.000Z' })
  const archived = `https://web.archive.org/web/20190305id_/${CATALOG}`
  await logged({ url: archived, via: 'archive', fetchedAt: '2026-01-05T00:00:00.000Z' })

  const copies = await priorCatalogCopies([CATALOG], '2026-06-01T00:00:00.000Z', dir)

  expect(copies.map((p) => p.url)).toEqual([archived, CATALOG])
  expect(copies[1].fetchedAt).toBe('2026-01-04T00:00:00.000Z')
})
