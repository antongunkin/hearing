// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { archiveCalendarUrl, archiveMonth, archiveUrl, citableArchiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { copiesPerYear, cdx, cdxUrl, lastCopyPerYear, parseCdx, WaybackError, type CdxRow } from '@/pipeline/sources/wayback'

vi.mock('@/pipeline/fetch/fetcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/fetch/fetcher')>()),
  fetchPage: vi.fn(),
}))

const fetchMock = vi.mocked(fetchPage)

afterEach(() => {
  vi.resetAllMocks()
})

const row = (timestamp: string, statusCode = '200', original = 'https://eargo.com/'): CdxRow => ({
  timestamp,
  original,
  statusCode,
  mimeType: 'text/html',
  digest: `d${timestamp}`,
})

describe('cdxUrl', () => {
  test('cdxUrl builds the query in a fixed order', () => {
    expect(cdxUrl({ url: 'eargo.com/', from: '2018', filters: ['statuscode:200'], collapse: 'timestamp:8' })).toBe(
      'https://web.archive.org/cdx/search/cdx?url=eargo.com%2F&from=2018&filter=statuscode%3A200&collapse=timestamp%3A8&output=json&fl=timestamp%2Coriginal%2Cstatuscode%2Cmimetype%2Cdigest',
    )
  })

  test('matchType, to, several filters and limit keep their place', () => {
    expect(
      cdxUrl({ url: 'eargo.com', matchType: 'domain', to: '2024', filters: ['a:1', 'b:2'], limit: 50 }),
    ).toBe(
      'https://web.archive.org/cdx/search/cdx?url=eargo.com&matchType=domain&to=2024&filter=a%3A1&filter=b%3A2&limit=50&output=json&fl=timestamp%2Coriginal%2Cstatuscode%2Cmimetype%2Cdigest',
    )
  })
})

test.each([
  ['https://web.archive.org/web/20210315123456id_/https://www.eargo.com/', { timestamp: '20210315123456', original: 'https://www.eargo.com/', raw: true }],
  ['https://web.archive.org/web/2021/eargo.com/x?a=1', { timestamp: '2021', original: 'http://eargo.com/x?a=1', raw: false }],
  ['https://web.archive.org/web/abc/https://x.test/', null],
  ['https://www.eargo.com/', null],
])('parseArchiveUrl(%s)', (url, expected) => expect(parseArchiveUrl(url)).toEqual(expected))

describe('archive URLs', () => {
  test('archiveUrl, citableArchiveUrl and archiveMonth', () => {
    expect(archiveUrl('20210315123456', 'https://www.eargo.com/', { raw: true })).toBe(
      'https://web.archive.org/web/20210315123456id_/https://www.eargo.com/',
    )
    expect(archiveUrl('2021', 'https://www.eargo.com/')).toBe('https://web.archive.org/web/2021/https://www.eargo.com/')
    expect(citableArchiveUrl('https://web.archive.org/web/20210315123456id_/https://www.eargo.com/')).toBe(
      'https://web.archive.org/web/20210315123456/https://www.eargo.com/',
    )
    expect(archiveMonth('20210315123456')).toBe('2021-03')
    expect(archiveMonth('2021')).toBe('2021-01')
    expect(archiveCalendarUrl('https://www.eargo.com/')).toBe('https://web.archive.org/web/*/https://www.eargo.com/')
  })
})

describe('parseCdx', () => {
  test('parseCdx reads the header row; an empty answer has no rows', () => {
    const text = JSON.stringify([
      ['timestamp', 'original', 'statuscode', 'mimetype', 'digest'],
      ['20210315123456', 'https://eargo.com/', '200', 'text/html', 'ABC'],
    ])
    expect(parseCdx(text)).toEqual([
      { timestamp: '20210315123456', original: 'https://eargo.com/', statusCode: '200', mimeType: 'text/html', digest: 'ABC' },
    ])
    expect(parseCdx('')).toEqual([])
  })
})

describe('lastCopyPerYear and copiesPerYear', () => {
  const rows = [
    row('20171231000000'),
    row('20180102000000'),
    row('20180901000000'),
    row('20180905000000', '301'),
    row('20190410000000'),
    row('20200101000000', '404'),
    row('20210315123456'),
    row('20211201000000'),
  ]

  test('lastCopyPerYear keeps the latest 200 copy of each year since 2018', () => {
    expect(lastCopyPerYear(rows, 2018).map((r) => r.timestamp)).toEqual(['20180901000000', '20190410000000', '20211201000000'])
  })

  test('copiesPerYear counts the 200 copies of each year since the given year', () => {
    expect(copiesPerYear(rows, 2018)).toEqual({ '2018': 2, '2019': 1, '2021': 2 })
  })
})

describe('cdx', () => {
  test('fetches through fetchPage and parses the answer', async () => {
    const text = JSON.stringify([['timestamp', 'original', 'statuscode', 'mimetype', 'digest'], ['20210315123456', 'https://eargo.com/', '200', 'text/html', 'ABC']])
    fetchMock.mockResolvedValue({ status: 'ok', url: 'x', text, contentHash: 'h', fetchedAt: 't' } satisfies FetchResult)

    expect(await cdx({ url: 'eargo.com' })).toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toBe(cdxUrl({ url: 'eargo.com' }))
  })

  test('a skipped request throws a WaybackError carrying the skip reason', async () => {
    fetchMock.mockResolvedValue({ status: 'skipped', url: 'x', reason: 'rate-limited', detail: 'HTTP 429' })

    const error = await cdx({ url: 'eargo.com' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WaybackError)
    expect((error as WaybackError).reason).toBe('rate-limited')
  })
})
