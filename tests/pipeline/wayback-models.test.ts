// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { archiveCandidates } from '@/pipeline/archive/wayback-models'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { extractModel, type ModelCandidate } from '@/pipeline/sources/brand-site'
import { earliestCopy, latestCopy, pdfCopies, WaybackError, yearlyCopies } from '@/pipeline/sources/wayback'
import { archiveUrl } from '@/src/lib/archive-url'
import type { Brand } from '@/src/lib/schema/brand'
import { Model } from '@/src/lib/schema/model'

vi.mock('@/pipeline/fetch/fetcher', () => ({ fetchPage: vi.fn() }))
vi.mock('@/pipeline/sources/brand-site', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/sources/brand-site')>()),
  extractModel: vi.fn(),
}))
vi.mock('@/pipeline/sources/wayback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/sources/wayback')>()),
  yearlyCopies: vi.fn(),
  latestCopy: vi.fn(),
  earliestCopy: vi.fn(),
  pdfCopies: vi.fn(),
}))

const AT = '2026-11-27T10:00:00.000Z'
const SITE = 'https://www.acme.test'
const CATALOG = `${SITE}/products`
const ZED = `${SITE}/products/zed-2`
const OLD = `${SITE}/products/old-1`
const pageOf = (name: string) => `${SITE}/products/${name}`

const brand = {
  slug: 'acme',
  name: 'Acme',
  group: 'Acme Group',
  website: SITE,
  imageLicense: 'none',
  defaultType: 'rx',
  status: 'gone',
  scraper: { catalogUrls: [CATALOG], modelUrlPattern: '^https://www\\.acme\\.test/products/[a-z0-9-]+$', documentUrlPattern: '\\.pdf$', render: false },
} as unknown as Brand

const row = (timestamp: string, original: string) => ({ timestamp, original, statusCode: '200', mimeType: 'text/html', digest: 'd' })
const raw = (timestamp: string, original: string) => archiveUrl(timestamp, original, { raw: true })

const ok = (url: string, text: string, html?: string, contentType = 'text/html'): FetchResult => ({
  status: 'ok',
  url,
  text,
  ...(html !== undefined && { html }),
  contentHash: 'h',
  fetchedAt: AT,
  contentType,
})

const model = (name: string, extra: Partial<Model> = {}): Model =>
  Model.parse({
    slug: `acme-${name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ /g, '-')}`,
    brand: 'acme',
    name,
    aliases: [],
    type: 'rx',
    sameHardwareAs: [],
    variants: [],
    ...extra,
  })

const official = (value: string) => ({ value, quote: value, sourceUrl: `${SITE}/old`, fetchedAt: AT, sourceType: 'official' as const })

/** The archive as the tests see it: pages by their raw copy URL. */
let pages: Record<string, FetchResult>
const catalogHtml = (...slugs: string[]) => `<html><body>${slugs.map((s) => `<a href="/products/${s}">${s}</a>`).join('')}</body></html>`

function archive(opts: { catalog?: Record<string, string[]>; names?: Record<string, string> } = {}) {
  const catalog = opts.catalog ?? { '20180615000000': ['zed-2'], '20200301000000': ['zed-2'] }
  vi.mocked(yearlyCopies).mockResolvedValue(Object.keys(catalog).map((ts) => row(ts, CATALOG)))
  for (const [ts, slugs] of Object.entries(catalog)) {
    const names = slugs.map((s) => opts.names?.[s] ?? `Acme ${s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`)
    pages[raw(ts, CATALOG)] = ok(raw(ts, CATALOG), names.join('\n'), catalogHtml(...slugs))
  }
}

const options = (extra = {}) => ({ limit: Infinity, refresh: false, liveModelUrls: new Set<string>(), ...extra })

beforeEach(() => {
  pages = {}
  vi.mocked(fetchPage).mockImplementation(async (url) => pages[url] ?? { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' })
  vi.mocked(extractModel).mockImplementation(async (_brand, read) => {
    const slug = read[0].url.match(/\/products\/([a-z0-9-]+)/)![1]
    const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    return { model: model(name), fieldChecks: {} } satisfies ModelCandidate
  })
  vi.mocked(pdfCopies).mockResolvedValue([])
  vi.mocked(latestCopy).mockImplementation(async (url) => row('20201101000000', url))
  vi.mocked(earliestCopy).mockResolvedValue(null)
})
afterEach(() => vi.resetAllMocks())

describe('archiveCandidates', () => {
  test('reads the latest copy of each year since 2018 and the latest copy of each model page', async () => {
    archive()
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), 'Acme Zed 2 hearing aid')
    await archiveCandidates(brand, [], options())
    expect(vi.mocked(yearlyCopies).mock.calls[0][0]).toBe(CATALOG)
    const fetched = vi.mocked(fetchPage).mock.calls.map(([url]) => url)
    expect(fetched).toEqual([raw('20180615000000', CATALOG), raw('20200301000000', CATALOG), raw('20201101000000', ZED)])
    expect(vi.mocked(latestCopy).mock.calls.map(([url]) => url)).toEqual([ZED]) // once, though both years link it
    expect(vi.mocked(extractModel).mock.calls[0][1][0].url).toBe(`https://web.archive.org/web/20201101000000/${ZED}`) // cited without id_
  })

  test('archive.catalogUrls given as Web Archive copies are queried by their original URL', async () => {
    archive()
    const withCopy = { ...brand, archive: { catalogUrls: [archiveUrl('20190101000000', CATALOG)] } } as Brand
    await archiveCandidates(withCopy, [], options())
    expect(vi.mocked(yearlyCopies).mock.calls[0][0]).toBe(CATALOG)
  })

  test('a stored model found under another URL or name gives no new-model card', async () => {
    archive({ catalog: { '20200301000000': ['zed-2', 'audeo-paradise', 'second-page'] } })
    for (const slug of ['zed-2', 'audeo-paradise', 'second-page']) pages[raw('20201101000000', pageOf(slug))] = ok(raw('20201101000000', pageOf(slug)), `Acme ${slug}`)
    const stored = [
      model('Zed 2', { documents: [] }),
      model('Paradise'), // "Audéo Paradise" on the page
      model('Other', { releaseDate: { ...official('2019-05'), sourceUrl: `https://web.archive.org/web/2019/${pageOf('second-page')}` } }), // same page URL
    ]
    const changes = await archiveCandidates(brand, stored, options())
    expect(changes.filter((c) => c.kind === 'new-model')).toEqual([])
  })

  test('two stored models that qualify mean no merge: a new card', async () => {
    archive({ catalog: { '20200301000000': ['audeo-sport-paradise'] } })
    pages[raw('20201101000000', pageOf('audeo-sport-paradise'))] = ok(raw('20201101000000', pageOf('audeo-sport-paradise')), 'Acme Audeo Sport Paradise')
    const changes = await archiveCandidates(brand, [model('Sport Paradise'), model('Paradise')], options())
    expect(changes.filter((c) => c.kind === 'new-model').map((c) => c.modelSlug)).toEqual(['acme-audeo-sport-paradise'])
  })

  test('new models are discontinued with lastListed from the latest listing, origin left to the caller', async () => {
    archive({ catalog: { '20180615000000': ['zed-2'], '20200301000000': ['zed-2'] } })
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), 'Acme Zed 2 hearing aid')
    const [change] = await archiveCandidates(brand, [], options())
    expect(change).toMatchObject({ kind: 'new-model', modelSlug: 'acme-zed-2', path: '' })
    const after = change.after as Model
    expect(after.discontinued).toMatchObject({
      lastListed: '2020-03',
      source: { sourceUrl: `https://web.archive.org/web/20200301000000/${CATALOG}`, quote: 'Acme Zed 2', sourceType: 'official' },
    })
    expect(change.checks.discontinued).toBeUndefined()
  })

  test('the date comes from the copy actually served, not from the index row', async () => {
    archive({ catalog: { '20200301000000': ['zed-2'] } })
    const served = `https://web.archive.org/web/20200415120000id_/${CATALOG}`
    pages[raw('20200301000000', CATALOG)] = ok(served, 'Acme Zed 2', catalogHtml('zed-2'))
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), 'Acme Zed 2')
    const [change] = await archiveCandidates(brand, [], options())
    expect((change.after as Model).discontinued?.lastListed).toBe('2020-04')
  })

  test('a model listed only before 2018 is left out', async () => {
    archive({ catalog: { '20171201000000': ['old-1'] } })
    pages[raw('20201101000000', OLD)] = ok(raw('20201101000000', OLD), 'Acme Old 1')
    expect(await archiveCandidates(brand, [], options())).toEqual([])
  })

  test('a model that no catalog copy and no archived page names is not proposed (also with an empty page)', async () => {
    archive({ catalog: { '20200301000000': ['zed-2'] } })
    pages[raw('20200301000000', CATALOG)] = ok(raw('20200301000000', CATALOG), 'Our products', catalogHtml('zed-2'))
    vi.mocked(extractModel).mockResolvedValue({ model: model('Zed 2', { releaseDate: official('2019-04') }), fieldChecks: {} })
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), 'Welcome\nmore')
    expect(await archiveCandidates(brand, [], options())).toEqual([])
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), '')
    expect(await archiveCandidates(brand, [], options())).toEqual([])
  })

  test('a stored model of a gone brand that nothing names keeps its documents and date, only discontinued is skipped', async () => {
    archive({ catalog: { '20200301000000': ['zed-2'] } })
    pages[raw('20200301000000', CATALOG)] = ok(raw('20200301000000', CATALOG), 'Our products', catalogHtml('zed-2'))
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), 'Welcome')
    vi.mocked(extractModel).mockResolvedValue({ model: model('Zed 2', { releaseDate: official('2019-04') }), fieldChecks: {} })
    const changes = await archiveCandidates(brand, [model('Zed 2')], options())
    expect(changes.map((c) => c.kind)).toEqual(['spec-change'])
    expect(changes[0].path).toBe('releaseDate')
  })

  test('names are compared name to name: extra words after the name never match, a leading sub-line does', async () => {
    const run = async (page: string, stored: string[]) => {
      archive({ catalog: { '20200301000000': [page] } })
      const name = page.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      pages[raw('20201101000000', pageOf(page))] = ok(raw('20201101000000', pageOf(page)), `Acme ${name}`)
      const changes = await archiveCandidates(brand, stored.map((n) => model(n)), options())
      return changes.map((c) => `${c.kind} ${c.modelSlug}`)
    }
    expect(await run('zed-2-pro', ['Zed 2'])).toContain('new-model acme-zed-2-pro')
    expect(await run('zed-2', ['Zed 2 Pro'])).toContain('new-model acme-zed-2')
    expect(await run('pure-charge-go-x', ['Pure Charge Go'])).toContain('new-model acme-pure-charge-go-x')
    // "Audéo Paradise" on the page, "Paradise" stored: the stored model receives the changes.
    vi.mocked(extractModel).mockResolvedValueOnce({ model: model('Audéo Paradise', { releaseDate: official('2019-04') }), fieldChecks: {} })
    archive({ catalog: { '20200301000000': ['audeo-paradise'] } })
    pages[raw('20201101000000', pageOf('audeo-paradise'))] = ok(raw('20201101000000', pageOf('audeo-paradise')), 'Acme Audéo Paradise')
    const changes = await archiveCandidates(brand, [model('Paradise'), model('Zed 2')], options())
    expect(changes.map((c) => `${c.kind} ${c.modelSlug} ${c.path}`).sort()).toEqual(['discontinued acme-paradise discontinued', 'spec-change acme-paradise releaseDate'])
  })

  test('without an official date the earliest copy gives an "on sale by" month', async () => {
    archive()
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), 'Acme Zed 2 hearing aid')
    vi.mocked(earliestCopy).mockResolvedValue(row('20190214000000', ZED))
    pages[raw('20190214000000', ZED)] = ok(raw('20190214000000', ZED), 'Acme Zed 2 is here\nbuy')
    const [change] = await archiveCandidates(brand, [], options())
    const after = change.after as Model
    expect(after.releaseDate).toMatchObject({
      value: '2019-02',
      sourceType: 'derived',
      sourceUrl: `https://web.archive.org/web/20190214000000/${ZED}`,
      derivation: { op: 'earliest-archive-copy', input: '20190214000000' },
    })
    expect(change.checks.releaseDate).toEqual([{ name: 'literal', ok: true }])
  })

  test('an earliest copy that does not name the model gives no date', async () => {
    archive()
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), 'Acme Zed 2')
    vi.mocked(earliestCopy).mockResolvedValue(row('20190214000000', ZED))
    pages[raw('20190214000000', ZED)] = ok(raw('20190214000000', ZED), 'Welcome to Acme')
    const [change] = await archiveCandidates(brand, [], options())
    expect((change.after as Model).releaseDate).toBeUndefined()
  })

  test('a gone brand never requests its own domain', async () => {
    archive()
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), 'Acme Zed 2')
    vi.mocked(pdfCopies).mockResolvedValue([{ ...row('20190101000000', `${SITE}/docs/zed-2-user-guide.pdf`), mimeType: 'application/pdf' }])
    pages[raw('20190101000000', `${SITE}/docs/zed-2-user-guide.pdf`)] = ok(raw('20190101000000', `${SITE}/docs/zed-2-user-guide.pdf`), 'User guide\nAcme Zed 2', undefined, 'application/pdf')
    await archiveCandidates(brand, [], options())
    const calls = vi.mocked(fetchPage).mock.calls
    expect(calls.length).toBeGreaterThan(3)
    expect(calls.every(([url]) => new URL(url).hostname === 'web.archive.org')).toBe(true)
  })

  test('archived PDFs that match the pattern and name the model become documents', async () => {
    archive()
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), 'Acme Zed 2')
    const guide = `${SITE}/docs/zed-2-user-guide.pdf`
    const other = `${SITE}/docs/zed-9-user-guide.pdf`
    vi.mocked(pdfCopies).mockResolvedValue([
      { ...row('20190101000000', guide), mimeType: 'application/pdf' },
      { ...row('20190101000000', other), mimeType: 'application/pdf' },
      { ...row('20190101000000', `${SITE}/docs/zed-2.html`), mimeType: 'application/pdf' }, // not the pattern
    ])
    pages[raw('20190101000000', guide)] = ok(raw('20190101000000', guide), 'User guide\nAcme Zed 2', undefined, 'application/pdf')
    const [change] = await archiveCandidates(brand, [], options())
    expect(vi.mocked(pdfCopies).mock.calls[0][0]).toBe('acme.test')
    const after = change.after as Model
    expect(after.documents).toEqual([
      { kind: 'user-guide', title: 'User guide', url: `https://web.archive.org/web/20190101000000/${guide}`, fetchedAt: AT },
    ])
    expect(change.checks['documents.0']).toEqual([
      { name: 'document', ok: true },
      { name: 'document', ok: true },
      { name: 'document', ok: true },
    ])
  })

  test('a stored model gets only its new documents, a derived date when it has none, and a discontinued change for a gone brand', async () => {
    archive({ catalog: { '20200301000000': ['zed-2'] } })
    pages[raw('20201101000000', ZED)] = ok(raw('20201101000000', ZED), 'Acme Zed 2')
    vi.mocked(earliestCopy).mockResolvedValue(row('20190214000000', ZED))
    pages[raw('20190214000000', ZED)] = ok(raw('20190214000000', ZED), 'Acme Zed 2 is here')
    const guide = `${SITE}/docs/zed-2-user-guide.pdf`
    vi.mocked(pdfCopies).mockResolvedValue([{ ...row('20190101000000', guide), mimeType: 'application/pdf' }])
    pages[raw('20190101000000', guide)] = ok(raw('20190101000000', guide), 'User guide\nAcme Zed 2', undefined, 'application/pdf')

    const changes = await archiveCandidates(brand, [model('Zed 2')], options())
    expect(changes.map((c) => `${c.kind} ${c.path}`).sort()).toEqual(['discontinued discontinued', 'document documents.0', 'spec-change releaseDate'])
    expect(changes.find((c) => c.kind === 'discontinued')).toMatchObject({ after: { lastListed: '2020-03' } })

    // Already discontinued, dated and documented: nothing to add.
    const done = model('Zed 2', {
      discontinued: { source: { ...official('Zed 2') } },
      releaseDate: official('2019-01'),
      documents: [{ kind: 'user-guide', title: 'g', url: guide, fetchedAt: AT }],
    })
    expect(await archiveCandidates(brand, [done], options())).toEqual([])
  })

  test('an active brand reads only models its live catalog does not list, and gets no discontinued change for stored ones', async () => {
    archive({ catalog: { '20200301000000': ['zed-2', 'old-1'] } })
    pages[raw('20201101000000', OLD)] = ok(raw('20201101000000', OLD), 'Acme Old 1')
    const active = { ...brand, status: 'active', archive: { catalogUrls: [CATALOG] } } as Brand
    const changes = await archiveCandidates(active, [model('Old 1')], options({ liveModelUrls: new Set([ZED]) }))
    expect(vi.mocked(latestCopy).mock.calls.map(([url]) => url)).toEqual([OLD])
    expect(changes).toEqual([])
    // An active brand without `archive` has no archive step.
    expect(await archiveCandidates({ ...active, archive: undefined } as Brand, [], options())).toEqual([])
  })

  test('--limit bounds the model pages read', async () => {
    archive({ catalog: { '20200301000000': ['zed-2', 'old-1'] } })
    await archiveCandidates(brand, [], options({ limit: 1 }))
    expect(vi.mocked(latestCopy)).toHaveBeenCalledTimes(1)
  })

  test('a 429 stops the run; an excluded site or a lost page does not', async () => {
    archive({ catalog: { '20200301000000': ['zed-2'] } })
    pages[raw('20200301000000', CATALOG)] = { status: 'skipped', url: '', reason: 'rate-limited', detail: 'HTTP 429' }
    await expect(archiveCandidates(brand, [], options())).rejects.toMatchObject({ reason: 'rate-limited' })

    archive({ catalog: { '20200301000000': ['zed-2'] } })
    vi.mocked(latestCopy).mockRejectedValue(new WaybackError('archive-excluded', 'HTTP 403'))
    const skips: string[] = []
    expect(await archiveCandidates(brand, [], options({ onSkip: (_u: string, reason: string) => skips.push(reason) }))).toEqual([])
    expect(skips).toEqual(['archive-excluded'])
  })
})
