// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { archiveDateCheck } from '@/pipeline/checks/archive-date'
import { isInScope, lifecycleOf, listingIn, namesModel, type Listing } from '@/pipeline/archive/lifecycle'
import type { FetchResult } from '@/pipeline/fetch/fetcher'
import type { Sourced } from '@/src/lib/schema/field'
import type { Model } from '@/src/lib/schema/model'

type OkPage = Extract<FetchResult, { status: 'ok' }>

const m = { brand: 'phonak', name: 'Paradise', aliases: [] as string[] }
const page = (url: string, text: string): OkPage => ({ status: 'ok', url, text, contentHash: 'h', fetchedAt: '2026-11-27T10:00:00.000Z' })
const listing = (month: string): Listing => ({ month, sourceUrl: `https://web.archive.org/web/${month.replace('-', '')}15000000/https://phonak.com/`, fetchedAt: '2026-11-27T10:00:00.000Z', quote: `Phonak Audéo Paradise ${month}` })

const undatedModel = { ...m, slug: 'phonak-paradise' } as unknown as Model
const modelReleased = (value: string, sourceType: 'official' | 'third-party' = 'official') =>
  ({ ...undatedModel, releaseDate: { value, quote: value, sourceUrl: 'https://phonak.com/p', fetchedAt: '2026-11-27T10:00:00.000Z', sourceType } }) as unknown as Model

describe('namesModel', () => {
  test('brand and sub-line words may sit between the brand and the model name', () => {
    expect(namesModel(m, 'Phonak Audéo Paradise')).toBe(true)
    expect(namesModel(m, 'phonak audeo PARADISE hearing aids')).toBe(true)
  })

  test('a short name does not match unrelated text without the brand', () => {
    expect(namesModel(m, 'Paradise Island resort')).toBe(false)
    expect(namesModel(m, 'Paradise Island resort, Phonak sponsors')).toBe(true)
    expect(namesModel(m, 'Paradise Island resort', 'Visit Paradise Island resort')).toBe(false)
    expect(namesModel(m, 'Phonak Paradisenew')).toBe(false)
  })

  test('an alias counts, and a name that holds the brand needs no other', () => {
    expect(namesModel({ ...m, aliases: ['P90'] }, 'Phonak P90 charger')).toBe(true)
    expect(namesModel({ brand: 'oticon', name: 'Oticon More', aliases: [] }, 'Oticon More 1')).toBe(true)
  })
})

describe('listingIn', () => {
  test('takes the first naming line; the month comes from the archive timestamp of the served URL', () => {
    const copy = page('https://web.archive.org/web/20190615120000id_/https://phonak.com/hearing-aids', 'Hearing aids\nPhonak Audéo Paradise\nPhonak Paradise again')
    expect(listingIn(m, copy)).toEqual({
      month: '2019-06',
      sourceUrl: 'https://web.archive.org/web/20190615120000/https://phonak.com/hearing-aids',
      fetchedAt: '2026-11-27T10:00:00.000Z',
      quote: 'Phonak Audéo Paradise',
    })
  })

  test('a live page is dated by when it was fetched; no naming line gives null', () => {
    expect(listingIn(m, page('https://phonak.com/', 'Phonak Paradise'))?.month).toBe('2026-11')
    expect(listingIn(m, page('https://phonak.com/', 'Phonak Lumity'))).toBeNull()
  })
})

test.each([
  [{ inLiveCatalog: true }, undatedModel, true],
  [{ archiveListings: [listing('2019-06')] }, undatedModel, true],
  [{ archiveListings: [listing('2017-11')] }, undatedModel, false],
  [{}, modelReleased('2018-03'), true],
  [{}, modelReleased('2017-12'), false],
  [{}, modelReleased('2018'), true],
  [{}, modelReleased('2019-01', 'third-party'), false],
  [{}, undatedModel, false],
])('isInScope %#', (evidence, model, expected) => expect(isInScope(model, evidence)).toBe(expected))

describe('lifecycleOf', () => {
  const live = page('https://phonak.com/paradise', 'Phonak Paradise')
  const support = page('https://phonak.com/support', 'Support\nPhonak Paradise user guide')

  test('follows the spec order', () => {
    expect(lifecycleOf(m, { inLiveCatalog: true, listings: [] })).toEqual({ kind: 'on-sale' })
    expect(lifecycleOf(m, { inLiveCatalog: false, listings: [], liveProductPage: live })).toMatchObject({ kind: 'orphan', source: { quote: 'Phonak Paradise', value: 'Paradise' } })
    const gone = lifecycleOf(m, { inLiveCatalog: false, listings: [listing('2021-04'), listing('2022-09')] })
    expect(gone).toMatchObject({ kind: 'discontinued', lastListed: '2022-09', source: { quote: 'Phonak Audéo Paradise 2022-09', sourceType: 'official' } })
    const named = lifecycleOf(m, { inLiveCatalog: false, listings: [], namingPage: support })
    expect(named).toMatchObject({ kind: 'discontinued', source: { quote: 'Phonak Paradise user guide' } })
    expect(named).not.toHaveProperty('lastListed')
    expect(lifecycleOf(m, { inLiveCatalog: false, listings: [] })).toBeNull()
  })
})

describe('archiveDateCheck', () => {
  const field = (over: Partial<Sourced<string>> = {}): Sourced<string> => ({
    value: '2019-06',
    quote: 'Phonak Paradise',
    sourceUrl: 'https://web.archive.org/web/20190615120000id_/https://phonak.com/paradise',
    fetchedAt: '2026-11-27T10:00:00.000Z',
    sourceType: 'derived',
    derivation: { op: 'earliest-archive-copy', input: '20190615120000' },
    ...over,
  })
  const text = 'Welcome. Phonak   Paradise is here.'

  test('ties the month to the timestamp in the URL', () => {
    expect(archiveDateCheck(field(), text)).toEqual({ name: 'literal', ok: true })
    expect(archiveDateCheck(field({ value: '2019-07' }), text).ok).toBe(false)
    expect(archiveDateCheck(field({ derivation: { op: 'earliest-archive-copy', input: '20190101000000' } }), text).ok).toBe(false)
    expect(archiveDateCheck(field({ sourceUrl: 'https://phonak.com/paradise' }), text).ok).toBe(false)
    expect(archiveDateCheck(field({ derivation: { op: 'oz-to-g', input: '20190615120000' } }), text).ok).toBe(false)
    expect(archiveDateCheck(field({ quote: 'Phonak Lumity' }), text).ok).toBe(false)
  })
})
