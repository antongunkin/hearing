// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { appStatus, AppLookupSkipped, draftHistory, readHistorySources } from '@/pipeline/archive/history'
import { route } from '@/pipeline/apply'
import { queueRelation } from '@/pipeline/atlas/relation'
import type { OkPage } from '@/pipeline/atlas/facts'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { llm } from '@/pipeline/llm'
import { lookupApp } from '@/pipeline/sources/itunes'
import { latestCopy } from '@/pipeline/sources/wayback'
import { loadDataset, type Dataset } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'
import type { Brand } from '@/src/lib/schema/brand'
import { PendingChange } from '@/src/lib/schema/pending'

vi.mock('@/pipeline/fetch/fetcher', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/pipeline/fetch/fetcher')>()), fetchPage: vi.fn() }))
vi.mock('@/pipeline/llm', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/pipeline/llm')>()), llm: vi.fn() }))
vi.mock('@/pipeline/sources/itunes', () => ({ lookupApp: vi.fn() }))
vi.mock('@/pipeline/sources/wayback', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/pipeline/sources/wayback')>()), latestCopy: vi.fn() }))

const AT = '2026-11-27T10:00:00.000Z'
const eargo: Brand = {
  slug: 'eargo',
  name: 'Eargo',
  group: '',
  website: 'https://eargo.com/',
  imageLicense: 'none',
  defaultType: 'otc',
  status: 'gone',
  scraper: { catalogUrls: ['https://eargo.com/products'], modelUrlPattern: '', render: false },
  historySources: ['https://eargo.com/news/closing', 'https://news.test/sale'],
}

const NEWS = 'https://news.test/sale'
const TEXT = [
  'Eargo filed for bankruptcy protection in March 2024.',
  'Patient Square Capital agreed to buy Eargo in a restructuring.',
  'The Eargo app is no longer supported after the closure.',
  'Customers can reach service through the Eargo support line.',
  'Eargo stopped selling hearing aids in the spring.',
  'Warranty claims are handled by the new owner.',
  'Eargo closed its offices in March 2024.',
].join(' ')
const page = (url = NEWS, text = TEXT): OkPage => ({ status: 'ok', url, text, contentHash: 'h', fetchedAt: AT })

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta']
const fact = (n: number, extra: Record<string, unknown> = {}) => ({
  date: '2024-03',
  text: `Fact ${WORDS[n - 1]} in our own words.`,
  sourceIndex: 1,
  quote: 'Eargo filed for bankruptcy protection in March 2024.',
  ...extra,
})
const drafted = (facts: unknown[], relations: unknown[] = []) => vi.mocked(llm).mockReset().mockResolvedValue({ facts, relations })

beforeEach(() => {
  vi.mocked(fetchPage).mockReset()
  vi.mocked(lookupApp).mockReset()
  vi.mocked(latestCopy).mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('draftHistory', () => {
  test('facts whose quote is not in their source are dropped; fewer than 3 give no draft', async () => {
    drafted([fact(1), fact(2), fact(3, { quote: 'Eargo was bought by Mars.' })])
    const { change } = await draftHistory(eargo, [page()])
    expect(change).toBeNull()

    drafted([fact(1), fact(2), fact(3), fact(4, { quote: 'Eargo was bought by Mars.' })])
    const draft = await draftHistory(eargo, [page()])
    expect((draft.change?.after as { facts: unknown[] }).facts).toHaveLength(3)
  })

  test('a fact with a forbidden phrase is dropped', async () => {
    drafted([fact(1), fact(2), fact(3, { text: 'We tested the app after the closure.' })])
    expect((await draftHistory(eargo, [page()])).change).toBeNull()
  })

  test('a fact that copies its source, has a bad date or a long quote is dropped; more than 5 keep the first 5', async () => {
    drafted([
      fact(1, { text: TEXT }),
      fact(2, { date: 'soon' }),
      fact(3, { quote: TEXT }),
      fact(4, { sourceIndex: 2 }),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => fact(n, { text: `Own words ${WORDS[n - 1]}.` })),
    ])
    const { change } = await draftHistory(eargo, [page()])
    const facts = (change?.after as { facts: { text: string }[] }).facts
    expect(facts.map((f) => f.text)).toEqual([1, 2, 3, 4, 5].map((n) => `Own words ${WORDS[n - 1]}.`))
  })

  test('a date or a number that its quote does not state drops the fact, and every drop is logged', async () => {
    drafted([
      fact(1),
      fact(2),
      fact(3),
      fact(4, { date: '2024-07' }),
      fact(5, { text: 'It sold 5000 units.' }),
      fact(6, { text: 'The brand was bankrupt.', quote: 'Eargo closed its offices in March 2024.' }),
    ])
    const { change } = await draftHistory(eargo, [page()])
    expect((change?.after as { facts: unknown[] }).facts).toHaveLength(3)
    const lines = vi.mocked(console.warn).mock.calls.map(([line]) => String(line))
    expect(lines.some((line) => /fact dropped \(.*\): 2024-07/.test(line))).toBe(true)
    expect(lines.some((line) => line.includes('a number of the text is not in the quote'))).toBe(true)
    expect(lines.some((line) => line.includes('is not in the quote') && line.includes('bankrupt'))).toBe(true)
  })

  test('a loaded term stays when its quote has it', async () => {
    drafted([fact(1, { text: 'The company went bankrupt.' }), fact(2), fact(3)])
    expect((await draftHistory(eargo, [page()])).change).not.toBeNull()
  })

  test('the copy rule: 11 shared words are kept, 12 are dropped', async () => {
    const source = 'alpha one two three four five six seven eight nine ten eleven twelve thirteen'
    const bare = page(NEWS, `Eargo filed for bankruptcy protection in March 2024. ${source}`)
    const words = source.split(' ')
    drafted([fact(1, { text: words.slice(0, 11).join(' ') }), fact(2), fact(3, { text: words.slice(0, 12).join(' ') }), fact(4)])
    const { change } = await draftHistory(eargo, [bare])
    expect((change?.after as { facts: { text: string }[] }).facts.map((f) => f.text)).toEqual([words.slice(0, 11).join(' '), 'Fact beta in our own words.', 'Fact delta in our own words.'])
  })

  describe('the date of a fact is checked against the whole page', () => {
    const plain = (text: string) => page(NEWS, text)
    const quoteOnly = 'Eargo stopped selling hearing aids.'
    const run = async (text: string, date: string) => {
      drafted([fact(1, { date, quote: quoteOnly }), fact(2, { date, quote: quoteOnly }), fact(3, { date, quote: quoteOnly })])
      return (await draftHistory(eargo, [plain(text)])).change?.after as { facts: { date: string }[] } | undefined
    }

    test('a date only in the page dateline is kept, in every written form', async () => {
      for (const dateline of ['Published 2024-03-05', 'March 5, 2024', '5 March 2024', 'Mar 2024', 'March 2024']) {
        const after = await run(`${dateline}. ${quoteOnly}`, '2024-03')
        expect(after?.facts.map((f) => f.date), dateline).toEqual(['2024-03', '2024-03', '2024-03'])
      }
    })

    test('a date on neither the page nor in the quote, or a wrong month on the page, drops the fact', async () => {
      expect(await run(`${quoteOnly} No date here.`, '2024-03')).toBeUndefined()
      expect(await run(`Published May 2024. ${quoteOnly}`, '2024-03')).toBeUndefined()
      expect(await run(`Published May 2023. ${quoteOnly}`, '2024-03')).toBeUndefined()
    })

    test('a page that states only the year gives a year-only date', async () => {
      const after = await run(`In 2024 the news came out. ${quoteOnly}`, '2024-03')
      expect(after?.facts.map((f) => f.date)).toEqual(['2024', '2024', '2024'])
    })

    test('a bare year dates the fact only near its quote, and never a copyright year', async () => {
      const filler = 'Other news of the week. '.repeat(12) // about 290 characters
      expect(await run(`${quoteOnly} ${filler}© 2024 Example News`, '2024')).toBeUndefined()
      expect(await run(`Copyright 2019-2024. ${quoteOnly}`, '2024')).toBeUndefined()
      expect(await run(`Archive 2024. ${filler}${quoteOnly}`, '2024')).toBeUndefined()
      expect((await run(`${quoteOnly} The shops closed in 2024. © 2025 Example News`, '2024'))?.facts.map((f) => f.date)).toEqual(['2024', '2024', '2024'])
    })
  })

  test('the draft always goes to review, with the page urls as refs and the brand path', async () => {
    drafted([fact(1), fact(2), fact(3)])
    const { change } = await draftHistory(eargo, [page()])
    expect(change).toMatchObject({ kind: 'brand-history', modelSlug: null, path: 'brands/eargo.history', refs: [NEWS] })
    expect(route(change!, [])).toBe('pending')
  })

  test('an archive copy is cited by its citable url and the app status is stored', async () => {
    drafted([fact(1), fact(2), fact(3)])
    const copy = page('https://web.archive.org/web/20240101000000id_/https://eargo.com/news/closing')
    const app = { name: 'Eargo', iosId: '1', available: false, checkedAt: AT, sourceUrl: 'https://itunes.apple.com/lookup?id=1' }
    const { change } = await draftHistory(eargo, [copy], app)
    const after = change?.after as { facts: { sourceUrl: string }[]; app: unknown }
    expect(after.facts[0].sourceUrl).toBe('https://web.archive.org/web/20240101000000/https://eargo.com/news/closing')
    expect(after.app).toEqual(app)
    expect(vi.mocked(llm).mock.calls[0][0].prompt).toContain('app removed from the App Store')
    expect(vi.mocked(llm).mock.calls[0][0]).toMatchObject({ provider: 'claude', model: 'haiku' })
    expect(vi.mocked(llm).mock.calls[0][0].tools).toBeUndefined()
  })

  test('a sale found in the sources becomes a proposed relation, with source kind and quote checks', async () => {
    const quote = 'Patient Square Capital agreed to buy Eargo in a restructuring.'
    const sale = { kind: 'owns', subject: 'Patient Square Capital', subjectKind: 'company', object: 'Eargo', objectKind: 'brand', since: '2024-03', sourceIndex: 1, quote }
    drafted([fact(1), fact(2), fact(3)], [sale, { ...sale, quote: 'Mars bought Eargo.' }, { ...sale, object: 'Nobody' }])
    const { relations } = await draftHistory(eargo, [page()], undefined, [eargo])
    expect(relations).toHaveLength(1)
    expect(relations[0].edge).toMatchObject({
      from: 'company:patient-square-capital',
      to: 'brand:eargo',
      kind: 'owns',
      visibility: 'internal',
      status: 'proposed',
      sources: [{ url: NEWS, quote, kind: 'press-release' }],
    })
    expect(relations[0].edge.since).toBeUndefined() // the quote states no date
  })

  test('a relation stated on the brand\'s own archived page is a company-page', async () => {
    const quote = 'Eargo is now called Eargo Health.'
    drafted([fact(1), fact(2), fact(3)], [{ kind: 'renamed-to', subject: 'Eargo', subjectKind: 'brand', object: 'Eargo Health', objectKind: 'company', sourceIndex: 1, quote }])
    const copy = page('https://web.archive.org/web/20240101000000id_/https://eargo.com/news/closing', `${TEXT} Eargo is now called Eargo Health.`)
    const { relations } = await draftHistory(eargo, [copy])
    expect(relations[0]?.edge.sources[0].kind).toBe('company-page')
  })

  test('queued relations are internal and proposed in the graph and the queue', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'history-'))
    try {
      await writeJson(join(dir, 'brands', 'eargo.json'), eargo)
      await writeJson(join(dir, 'rejections.json'), [])
      await writeJson(join(dir, 'blocklist.json'), [])
      const quote = 'Patient Square Capital agreed to buy Eargo in a restructuring.'
      drafted([fact(1), fact(2), fact(3)], [{ kind: 'owns', subject: 'Patient Square Capital', subjectKind: 'company', object: 'Eargo', objectKind: 'brand', sourceIndex: 1, quote }])
      const { relations } = await draftHistory(eargo, [page()])
      const dataset = await loadDataset(dir)
      expect(await queueRelation(relations[0], dataset, dir)).toBe('queued')
      expect(dataset.graph.edges[0]).toMatchObject({ status: 'proposed', visibility: 'internal' })
      expect(PendingChange.parse(JSON.parse(await readFile(join(dir, 'pending', 'industry-graph-company-patient-square-capital-owns-brand-eargo.json'), 'utf8'))).kind).toBe('relation')
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})

describe('appStatus', () => {
  const dataset = (extra: Partial<Dataset> = {}) =>
    ({
      models: [{ brand: 'eargo', app: { name: 'Eargo', iosId: '123' } }],
      graph: { entities: [], edges: [] },
      ...extra,
    }) as unknown as Dataset

  test('an app removed from the App Store is recorded as unavailable', async () => {
    vi.mocked(lookupApp).mockResolvedValue('removed')
    expect(await appStatus(eargo, dataset())).toMatchObject({ name: 'Eargo', iosId: '123', available: false, sourceUrl: expect.stringContaining('id=123') })
  })

  test('a record is available with its store url; the graph\'s publishes edge comes first', async () => {
    vi.mocked(lookupApp).mockResolvedValue({ iosId: '9', name: 'Eargo Hub', seller: 'Eargo', url: 'https://apps.apple.com/app/id9', lookupUrl: 'https://itunes.apple.com/lookup?id=9', fetchedAt: AT })
    const graph = {
      entities: [{ id: 'app:ios-9', kind: 'app', name: 'Eargo Hub', iosId: '9' }],
      edges: [{ from: 'brand:eargo', to: 'app:ios-9', kind: 'publishes', visibility: 'internal', status: 'proposed', sources: [] }],
    }
    const status = await appStatus(eargo, dataset({ graph } as Partial<Dataset>))
    expect(lookupApp).toHaveBeenCalledWith('9')
    expect(status).toEqual({ name: 'Eargo Hub', iosId: '9', available: true, checkedAt: AT, sourceUrl: 'https://apps.apple.com/app/id9' })
  })

  test('no app is undefined; a skipped lookup is an error, never "no app"', async () => {
    expect(await appStatus(eargo, dataset({ models: [] }))).toBeUndefined()
    vi.mocked(lookupApp).mockResolvedValue(null)
    await expect(appStatus(eargo, dataset())).rejects.toBeInstanceOf(AppLookupSkipped)
  })
})

describe('readHistorySources', () => {
  const ok = (url: string): FetchResult => ({ status: 'ok', url, text: 'text', contentHash: 'h', fetchedAt: AT })
  const fetched = () => vi.mocked(fetchPage).mock.calls.map(([url]) => url)

  test('a gone brand\'s own domain and subdomains are read only as Web Archive copies; other hosts live', async () => {
    vi.mocked(latestCopy).mockImplementation(async (url) => ({ timestamp: '20240101000000', original: url, statusCode: '200', mimeType: 'text/html', digest: 'd' }))
    vi.mocked(fetchPage).mockImplementation(async (url) => ok(url))
    const sub = { ...eargo, historySources: ['https://eargo.com/news/closing', 'https://support.eargo.com/closing', NEWS] }
    const pages = await readHistorySources(sub)
    expect(fetched()).toEqual([
      'https://web.archive.org/web/20240101000000id_/https://eargo.com/news/closing',
      'https://web.archive.org/web/20240101000000id_/https://support.eargo.com/closing',
      NEWS,
    ])
    expect(pages).toHaveLength(3)
    // Redirects are held to the same rule by the blocklist.
    for (const [, opts] of vi.mocked(fetchPage).mock.calls) expect(opts?.blocklist).toEqual(expect.arrayContaining(['sec.gov', 'eargo.com']))
  })

  test('no archive copy means the source is skipped, never read live', async () => {
    vi.mocked(latestCopy).mockResolvedValue(null)
    vi.mocked(fetchPage).mockImplementation(async (url) => ok(url))
    const pages = await readHistorySources({ ...eargo, historySources: ['https://eargo.com/news/closing'] })
    expect(pages).toEqual([])
    expect(fetchPage).not.toHaveBeenCalled()
  })

  test('an active brand\'s own pages are read live', async () => {
    vi.mocked(fetchPage).mockImplementation(async (url) => ok(url))
    await readHistorySources({ ...eargo, status: 'active', historySources: ['https://eargo.com/news/closing'] })
    expect(fetched()).toEqual(['https://eargo.com/news/closing'])
    expect(latestCopy).not.toHaveBeenCalled()
  })

  test('no sec.gov URL is ever fetched, listed or reached by redirect', async () => {
    vi.mocked(fetchPage).mockImplementation(async (url) => (url === NEWS ? ok('https://www.sec.gov/Archives/edgar/data/1/x.htm') : ok(url)))
    const pages = await readHistorySources({
      ...eargo,
      status: 'active',
      historySources: ['https://www.sec.gov/Archives/edgar/data/1/a.htm', 'https://web.archive.org/web/2024/https://data.sec.gov/x', NEWS],
    })
    expect(fetched()).toEqual([NEWS])
    expect(vi.mocked(fetchPage).mock.calls[0][1]?.blocklist).toContain('sec.gov')
    expect(pages).toEqual([])
  })

  test('a skipped fetch goes to onSkip and the source is left out', async () => {
    vi.mocked(fetchPage).mockResolvedValue({ status: 'skipped', url: NEWS, reason: 'http-error', detail: 'HTTP 404' })
    const onSkip = vi.fn()
    expect(await readHistorySources({ ...eargo, status: 'active', historySources: [NEWS] }, { onSkip })).toEqual([])
    expect(onSkip).toHaveBeenCalledWith(NEWS, 'http-error', 'HTTP 404')
  })
})

test('the history schema accepts a year, a month or a day as a fact date', async () => {
  const { BrandHistory } = await import('@/src/lib/schema/brand')
  const f = (date: string) => ({ date, text: 't', sourceUrl: NEWS, quote: 'q', fetchedAt: AT })
  expect(BrandHistory.safeParse({ facts: ['2024', '2024-03', '2024-03-05'].map(f) }).success).toBe(true)
  expect(BrandHistory.safeParse({ facts: ['2024', '2024-3', '2024-03'].map(f) }).success).toBe(false)
})
