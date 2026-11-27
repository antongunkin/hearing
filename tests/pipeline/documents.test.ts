// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { checkDocument, documentKind, documentTitle, replaceDeadDocuments } from '@/pipeline/archive/documents'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { latestCopy } from '@/pipeline/sources/wayback'
import type { Brand } from '@/src/lib/schema/brand'
import type { Model } from '@/src/lib/schema/model'

vi.mock('@/pipeline/fetch/fetcher', () => ({ fetchPage: vi.fn() }))
vi.mock('@/pipeline/sources/wayback', () => ({ latestCopy: vi.fn() }))

const AT = '2026-11-27T10:00:00.000Z'
const phonak = { slug: 'phonak', name: 'Phonak', scraper: { catalogUrls: [], modelUrlPattern: '', render: false, documentUrlPattern: '\\.pdf$' } } as unknown as Brand
const paradise = { brand: 'phonak', name: 'Paradise', aliases: [] as string[] }
const LIVE = 'https://www.phonak.com/docs/Phonak_Audeo_P_User_Guide.pdf'
const COPY = 'https://web.archive.org/web/20240101000000id_/https://www.phonak.com/docs/Phonak_Audeo_P_User_Guide.pdf'

const pdf = (url: string, text: string, contentType = 'application/pdf'): FetchResult => ({ status: 'ok', url, text, contentHash: 'h', fetchedAt: AT, contentType })
const gone = (url: string, detail: string): FetchResult => ({ status: 'skipped', url, reason: 'http-error', detail })

beforeEach(() => {
  vi.mocked(fetchPage).mockReset()
  vi.mocked(latestCopy).mockReset()
})
afterEach(() => vi.clearAllMocks())

describe('checkDocument', () => {
  test('a PDF is a document only if it matches the pattern, downloads and names the model', async () => {
    vi.mocked(fetchPage).mockResolvedValue(pdf(LIVE, 'Hearing aid manual for Phonak Lumity'))
    const result = await checkDocument(phonak, paradise, LIVE)
    expect(result?.checks).toHaveLength(3)
    expect(result?.checks.find((c) => !c.ok)?.detail).toBe('the document does not name the model')

    vi.mocked(fetchPage).mockResolvedValue(pdf(LIVE, 'User Guide\nPhonak Audéo Paradise'))
    const good = await checkDocument(phonak, paradise, LIVE)
    expect(good?.checks.every((c) => c.ok && c.name === 'document')).toBe(true)
    expect(good?.document).toEqual({ kind: 'user-guide', title: 'User Guide', url: LIVE, fetchedAt: AT })
  })

  test('a URL outside the brand pattern fails its check', async () => {
    vi.mocked(fetchPage).mockResolvedValue(pdf('https://www.phonak.com/page', 'Phonak Paradise'))
    const result = await checkDocument(phonak, paradise, 'https://www.phonak.com/page')
    expect(result?.checks.filter((c) => !c.ok)).toHaveLength(1)
  })

  test('a page that is not a PDF is kept with a failed check', async () => {
    vi.mocked(fetchPage).mockResolvedValue(pdf(LIVE, 'Phonak Paradise', 'text/html'))
    const result = await checkDocument(phonak, paradise, LIVE)
    expect(result?.checks.filter((c) => !c.ok).map((c) => c.detail)).toEqual(['the document is not a PDF'])
  })

  test('no PDF fetched, or a PDF with no text, is no document', async () => {
    vi.mocked(fetchPage).mockResolvedValue(gone(LIVE, 'HTTP 404'))
    expect(await checkDocument(phonak, paradise, LIVE)).toBeNull()
    vi.mocked(fetchPage).mockResolvedValue(pdf(LIVE, '  \n'))
    expect(await checkDocument(phonak, paradise, LIVE)).toBeNull()
  })

  test('an archive copy is read raw and cited without the raw flag, its original matched against the pattern', async () => {
    vi.mocked(fetchPage).mockResolvedValue(pdf(COPY, 'Phonak Audéo Paradise'))
    const result = await checkDocument(phonak, paradise, COPY.replace('id_', ''))
    expect(vi.mocked(fetchPage).mock.calls[0][0]).toBe(COPY)
    expect(result?.document.url).toBe(COPY.replace('id_', ''))
    expect(result?.checks.every((c) => c.ok)).toBe(true)
  })
})

test.each([
  ['https://x.test/Phonak_Audeo_P_User_Guide.pdf', '', 'user-guide'],
  ['https://x.test/audeo-p-datasheet.pdf', '', 'datasheet'],
  ['https://x.test/brochure.pdf', 'Hearing better', 'other'],
  ['https://x.test/a.pdf', 'Instructions for use', 'user-guide'],
  ['https://x.test/a.pdf', 'Technical Specifications', 'datasheet'],
])('documentKind(%s)', (url, text, kind) => expect(documentKind(url, text)).toBe(kind))

test('documentTitle: the first line, cut to 120, else the file name', () => {
  expect(documentTitle('https://x.test/a.pdf', '\n  Audéo P  \nmore')).toBe('Audéo P')
  expect(documentTitle('https://x.test/a.pdf', 'x'.repeat(200))).toHaveLength(120)
  expect(documentTitle('https://x.test/audeo_p-user-guide.pdf', '')).toBe('audeo p user guide')
})

describe('replaceDeadDocuments', () => {
  const stored = {
    slug: 'phonak-paradise',
    ...paradise,
    documents: [{ kind: 'user-guide', title: 'Guide', url: LIVE, fetchedAt: '2025-01-01T00:00:00.000Z' }],
  } as unknown as Model

  test('a dead live PDF is replaced by its archived copy; without a copy it stays', async () => {
    vi.mocked(fetchPage).mockImplementation(async (url) => (url === COPY ? pdf(COPY, 'Phonak Audéo Paradise') : gone(LIVE, 'HTTP 404')))
    vi.mocked(latestCopy).mockResolvedValue({ timestamp: '20240101000000', original: 'https://www.phonak.com/docs/Phonak_Audeo_P_User_Guide.pdf', statusCode: '200', mimeType: 'application/pdf', digest: 'd' })

    const [change, ...rest] = await replaceDeadDocuments(stored, { brand: phonak })
    expect(rest).toEqual([])
    expect(change).toMatchObject({ kind: 'document', modelSlug: 'phonak-paradise', path: 'documents.0', before: stored.documents[0] })
    expect((change.after as { url: string }).url).toBe(COPY.replace('id_', ''))
    expect(vi.mocked(fetchPage)).toHaveBeenCalledWith(LIVE, { refresh: true })

    vi.mocked(latestCopy).mockResolvedValue(null)
    expect(await replaceDeadDocuments(stored, { brand: phonak })).toEqual([])
  })

  test('every skipped fetch is reported: a live document that is refused or fails (not dead), and the archived PDF download', async () => {
    const skips: [string, string, string | undefined][] = []
    const onSkip = (url: string, reason: string, detail?: string) => void skips.push([url, reason, detail])
    vi.mocked(fetchPage).mockResolvedValue({ status: 'skipped', url: LIVE, reason: 'rate-limited', detail: 'HTTP 429' })
    expect(await replaceDeadDocuments(stored, { brand: phonak, onSkip })).toEqual([])
    expect(skips).toEqual([[LIVE, 'rate-limited', 'HTTP 429']])

    skips.length = 0
    vi.mocked(fetchPage).mockImplementation(async (url) => (url === LIVE ? gone(LIVE, 'HTTP 404') : { status: 'skipped', url, reason: 'rate-limited', detail: 'HTTP 429' }))
    vi.mocked(latestCopy).mockResolvedValue({ timestamp: '20240101000000', original: LIVE, statusCode: '200', mimeType: 'application/pdf', digest: 'd' })
    expect(await replaceDeadDocuments(stored, { brand: phonak, onSkip })).toEqual([])
    expect(skips).toEqual([[COPY, 'rate-limited', 'HTTP 429']])
  })

  test('a copy that does not name the model, a live link, a redirect error or a gone brand give no change', async () => {
    vi.mocked(fetchPage).mockImplementation(async (url) => (url === COPY ? pdf(COPY, 'Phonak Lumity') : gone(LIVE, 'HTTP 404')))
    vi.mocked(latestCopy).mockResolvedValue({ timestamp: '20240101000000', original: LIVE, statusCode: '200', mimeType: 'application/pdf', digest: 'd' })
    expect(await replaceDeadDocuments(stored, { brand: phonak })).toEqual([])

    // The copy's original fails the brand pattern.
    vi.mocked(fetchPage).mockImplementation(async (url) => (url === LIVE ? gone(LIVE, 'HTTP 404') : pdf(url, 'Phonak Paradise')))
    vi.mocked(latestCopy).mockResolvedValue({ timestamp: '20240101000000', original: `${LIVE}?x=1`, statusCode: '200', mimeType: 'application/pdf', digest: 'd' })
    expect(await replaceDeadDocuments(stored, { brand: phonak })).toEqual([])
    vi.mocked(latestCopy).mockResolvedValue({ timestamp: '20240101000000', original: LIVE, statusCode: '200', mimeType: 'application/pdf', digest: 'd' })

    vi.mocked(fetchPage).mockResolvedValue(pdf(LIVE, 'Phonak Paradise'))
    expect(await replaceDeadDocuments(stored, { brand: phonak })).toEqual([])
    vi.mocked(fetchPage).mockResolvedValue(gone(LIVE, 'HTTP 500'))
    expect(await replaceDeadDocuments(stored, { brand: phonak })).toEqual([])

    vi.mocked(fetchPage).mockClear()
    expect(await replaceDeadDocuments(stored, { brand: phonak, gone: true })).toEqual([])
    expect(fetchPage).not.toHaveBeenCalled()
  })
})
