// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchPage, isBlocked, type FetchResult } from '@/pipeline/fetch/fetcher'
import { llm, LlmOutputError } from '@/pipeline/llm'
import { fetchIosVersion } from '@/pipeline/sources/itunes'
import { fetchFdaEvents } from '@/pipeline/sources/openfda'
import { extractExpertProsCons, synthesizeProsCons } from '@/pipeline/sources/pros-cons'
import { complaintThemes, discoverReviewSources, extractRetailReviews } from '@/pipeline/sources/reviews'
import { discoverThirdPartyFacts } from '@/pipeline/sources/third-party-facts'
import { analyzeVideo, searchVideos, YouTubeError } from '@/pipeline/sources/youtube'
import type { Brand } from '@/src/lib/schema/brand'
import { Event } from '@/src/lib/schema/event'
import { Model } from '@/src/lib/schema/model'

vi.mock('@/pipeline/fetch/fetcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/fetch/fetcher')>()),
  fetchPage: vi.fn(),
}))
vi.mock('@/pipeline/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/llm')>()),
  llm: vi.fn(),
}))
vi.mock('@/src/lib/data/load', () => ({ loadBlocklist: async () => ['blocked.example'] }))

const fetchMock = vi.mocked(fetchPage)
const llmMock = vi.mocked(llm)

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const fixture = (path: string) => readFile(fileURLToPath(new URL(`../fixtures/${path}`, import.meta.url)), 'utf8')

type Ok = Extract<FetchResult, { status: 'ok' }>
const FETCHED_AT = '2026-11-26T10:00:00.000Z'
const okPage = (url: string, text: string): Ok => ({ status: 'ok', url, text, contentHash: 'hash', fetchedAt: FETCHED_AT })

/** Answers llm() with the replies in turn, each parsed with the schema it was asked for, as llm() would. */
function replies(...outputs: unknown[]) {
  for (const output of outputs) llmMock.mockImplementationOnce(async ({ schema }) => schema.parse(output))
}

const brand = (slug: string, name: string, group: string): Brand => ({
  slug,
  name,
  group,
  website: `https://www.${slug}.com`,
  imageLicense: 'none',
  defaultType: 'rx',
  scraper: { catalogUrls: [], modelUrlPattern: '', render: false },
})
const brands = [brand('jabra-enhance', 'Jabra Enhance', 'GN'), brand('phonak', 'Phonak', 'Sonova')]

const model = (brandSlug: string, name: string, extra: Partial<Model> = {}): Model =>
  Model.parse({
    slug: `${brandSlug}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    brand: brandSlug,
    name,
    aliases: [],
    type: 'otc',
    sameHardwareAs: [],
    variants: [],
    ...extra,
  })

describe('fetchFdaEvents', () => {
  const serve = (files: Record<string, string>) =>
    fetchMock.mockImplementation(async (url) => {
      const text = Object.entries(files).find(([endpoint]) => url.includes(`/${endpoint}.json?`))?.[1]
      return text ? okPage(url, text) : { status: 'skipped', url, reason: 'http-error', detail: 'HTTP 404' }
    })

  test('FDA 510k fixture → fda-clearance with key = K-number; unknown applicant → matched:false', async () => {
    serve({ '510k': await fixture('openfda/510k.json') })

    const found = await fetchFdaEvents('2023-11-01T00:00:00Z', brands, [
      model('jabra-enhance', 'Select 500'),
      model('jabra-enhance', 'Select 550'),
    ])

    expect(found[0]).toEqual({
      matched: true,
      event: {
        type: 'fda-clearance',
        modelSlug: 'jabra-enhance-select-550',
        date: '2026-06-25',
        key: 'K254108',
        sources: ['https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=K254108'],
      },
    })
    expect(found.slice(1).map(({ matched, event }) => [matched, event.modelSlug, event.key])).toEqual([
      [false, null, 'K261187'],
      [false, null, 'K260413'],
    ])
    for (const { event } of found) Event.parse({ ...event, id: 'x', text: '' })

    const url = fetchMock.mock.calls[0][0]
    expect(url).toContain('https://api.fda.gov/device/510k.json?search=product_code:("ESD"+')
    expect(url).toContain('"QUH"')
    expect(url).toContain('+AND+decision_date:[2023-11-01+TO+')
    expect(fetchMock.mock.calls[0][1]).toEqual({ refresh: true })
  })

  test('a recall becomes fda-recall dated when FDA posted it; no match for a model of another brand', async () => {
    serve({ recall: await fixture('openfda/recall.json') })

    const [found] = await fetchFdaEvents('2023-11-01', brands, [
      model('phonak', 'Audeo Lumity'),
      model('jabra-enhance', 'rechargeable'),
    ])

    expect(found).toEqual({
      matched: true,
      event: {
        type: 'fda-recall',
        modelSlug: 'phonak-audeo-lumity',
        date: '2026-04-10',
        key: 'Z-0001-2026',
        sources: ['https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfres/res.cfm?id=200001'],
      },
    })
    expect(fetchMock.mock.calls[1][0]).toContain('+AND+event_date_posted:[2023-11-01+TO+')
  })

  test('a brand is matched by whole words, and a model only when one name fits best', async () => {
    const results = [
      { k_number: 'K1', applicant: 'Magna Hearing Inc', device_name: 'Select 550', decision_date: '2026-01-01' },
      { k_number: 'K2', applicant: 'GN Hearing A/S', device_name: 'Select 300 and Select 550', decision_date: '2026-01-01' },
    ]
    serve({ '510k': JSON.stringify({ meta: { results: { total: 2 } }, results }) })

    const found = await fetchFdaEvents('2023-11-01', brands, [
      model('jabra-enhance', 'Select 300'),
      model('jabra-enhance', 'Select 550'),
    ])

    expect(found.map((f) => f.matched)).toEqual([false, false])
  })

  test('an unreachable openFDA is an error, not an empty month', async () => {
    fetchMock.mockImplementation(async (url) => ({ status: 'skipped', url, reason: 'http-error', detail: 'HTTP 500' }))

    await expect(fetchFdaEvents('2023-11-01', brands, [])).rejects.toThrow('HTTP 500')
  })
})

describe('fetchIosVersion', () => {
  test('iTunes lookup → version with trackViewUrl as source', async () => {
    const lookup = await fixture('itunes/lookup.json')
    fetchMock.mockImplementation(async (url) => okPage(url, lookup))

    expect(await fetchIosVersion('1000000000')).toEqual({
      value: '3.14.1',
      quote: '3.14.1',
      sourceUrl: 'https://apps.apple.com/us/app/jabra-enhance/id1000000000?uo=4',
      fetchedAt: FETCHED_AT,
      sourceType: 'official',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://itunes.apple.com/lookup?id=1000000000', { refresh: true })
  })

  test('no such app, or a skipped lookup → null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementationOnce(async (url) => okPage(url, '{"resultCount":0,"results":[]}'))
    fetchMock.mockImplementationOnce(async (url) => ({ status: 'skipped', url, reason: 'robots' }))

    expect(await fetchIosVersion('1')).toBeNull()
    expect(await fetchIosVersion('1')).toBeNull()
  })
})

describe('reviews', () => {
  test('discoverReviewSources drops google/amazon/blocklisted domains', async () => {
    replies({
      expert: [
        'https://reviews.example/phonak-sphere',
        'https://www.google.com/search?q=sphere',
        'https://www.google.co.uk/shopping',
        'https://www.youtube.com/watch?v=aaaaaaaaaaa',
        'https://sub.blocked.example/review',
        'not a url',
        'ftp://reviews.example/file',
      ],
      retail: [
        'https://www.amazon.com/dp/B0',
        'https://smile.amazon.de/dp/B0',
        'https://shop.example/phonak-sphere',
        'https://shop.example/phonak-sphere#reviews',
      ],
    })

    expect(await discoverReviewSources(model('phonak', 'Audeo Sphere'))).toEqual({
      expert: ['https://reviews.example/phonak-sphere'],
      retail: ['https://shop.example/phonak-sphere'],
    })
    expect(llmMock.mock.calls[0][0]).toMatchObject({ provider: 'claude', tools: ['WebSearch'] })
  })

  test('the search prompt names the month, so that a cached answer lasts one month', async () => {
    vi.useFakeTimers({ now: new Date('2027-02-03T12:00:00Z') })
    replies({ expert: [], retail: [] }, { expert: [], retail: [] })

    await discoverReviewSources(model('phonak', 'Audeo Sphere'))
    await discoverReviewSources(model('phonak', 'Audeo Sphere'), { asOf: '2027-03' })
    vi.useRealTimers()

    const [now, later] = llmMock.mock.calls.map(([options]) => options.prompt)
    expect(now).toContain('2027-02')
    expect(later).toContain('2027-03')
    expect(later).not.toContain('2027-02')
  })

  test('the fetcher refuses Google and Amazon under every country domain', () => {
    const blocked = (url: string) => isBlocked(new URL(url), [])
    expect(['https://google.com', 'https://play.google.com', 'https://google.de', 'https://www.amazon.co.uk', 'https://amazon.com.au./x'].map(blocked)).toEqual(
      [true, true, true, true, true],
    )
    expect(['https://amazonia.com', 'https://google.example.org', 'https://notgoogle.com'].map(blocked)).toEqual([false, false, false])
  })

  const RETAIL_URL = 'https://shop.example/select-550'
  const select550 = model('jabra-enhance', 'Select 550')
  const retailReply = {
    rating: { value: 4.3, quote: '4.3 out of 5 stars' },
    count: { value: 1248, quote: 'Based on 1,248 reviews' },
    reviews: ['The battery dies before dinner and the charger is finicky.', 'This sentence is not on the page.'],
  }

  test('extractRetailReviews keeps only numbers and texts that are on the page', async () => {
    replies(retailReply)

    expect(await extractRetailReviews(select550, okPage(RETAIL_URL, await fixture('reviews/retail.txt')))).toEqual({
      rating: 4.3,
      count: 1248,
      texts: ['The battery dies before dinner and the charger is finicky.'],
    })
  })

  test.each([
    ['no rating', { ...retailReply, rating: undefined }],
    ['a rating the page does not state', { ...retailReply, rating: { value: 4.9, quote: '4.3 out of 5 stars' } }],
    ['a count with an invented quote', { ...retailReply, count: { value: 9000, quote: '9000 reviews' } }],
  ])('extractRetailReviews → null for %s', async (_, reply) => {
    replies(reply)

    expect(await extractRetailReviews(select550, okPage(RETAIL_URL, await fixture('reviews/retail.txt')))).toBeNull()
  })

  const ldPage = async (...blocks: unknown[]): Promise<Ok> => ({
    ...okPage(RETAIL_URL, await fixture('reviews/retail.txt')),
    html: blocks
      .map((block) => `<script type="application/ld+json">${typeof block === 'string' ? block : JSON.stringify(block)}</script>`)
      .join(''),
  })
  const aggregate = (fields: Record<string, unknown>) => ({ '@type': 'AggregateRating', ...fields })
  const product = (fields: Record<string, unknown>) => ({ '@type': 'Product', aggregateRating: aggregate(fields) })
  const textsOnly = { reviews: ['Whistles when I hug someone.', 'From the JSON-LD only.'] }

  test('extractRetailReviews takes rating and count from JSON-LD, texts from visible text', async () => {
    replies(textsOnly)
    const page = await ldPage(
      '{ not json',
      { '@graph': [{ '@type': 'Organization', aggregateRating: aggregate({ ratingValue: 4.9, reviewCount: 90000 }) }] },
      product({ ratingValue: '4.6', ratingCount: '2,310', bestRating: '5' }),
    )

    expect(await extractRetailReviews(select550, page)).toEqual({ rating: 4.6, count: 2310, texts: ['Whistles when I hug someone.'] })
  })

  test('reviewCount is preferred to ratingCount, and the same rating twice is one rating', async () => {
    replies(textsOnly)
    const block = product({ ratingValue: 4.6, reviewCount: 812, ratingCount: 2310 })

    expect(await extractRetailReviews(select550, await ldPage(block, block))).toMatchObject({ rating: 4.6, count: 812 })
  })

  test.each([
    ['two different ratings', [product({ ratingValue: 4.6, reviewCount: 10 }), product({ ratingValue: 3.1, reviewCount: 7 })]],
    ['a 10-point scale', [product({ ratingValue: 4.6, reviewCount: 10, bestRating: 10 })]],
    ['no count', [product({ ratingValue: 4.6 })]],
    ['a store rating only', [{ '@type': 'Store', aggregateRating: aggregate({ ratingValue: 4.6, reviewCount: 10 }) }]],
  ])('extractRetailReviews falls back to the visible text for JSON-LD with %s', async (_, blocks) => {
    replies(retailReply)

    expect(await extractRetailReviews(select550, await ldPage(...blocks))).toMatchObject({ rating: 4.3, count: 1248 })
  })

  test.each([
    ['another model', model('jabra-enhance', 'Select 300')],
    ['a model whose name is only part of a word there', model('jabra-enhance', 'Elect 550')],
  ])('extractRetailReviews → null, without a model call, for a page about %s', async (_, other) => {
    const page = await ldPage(product({ ratingValue: 4.6, reviewCount: 10 }))

    expect(await extractRetailReviews(other, page)).toBeNull()
    expect(llmMock).not.toHaveBeenCalled()
  })

  test.each([
    ['an alias', model('jabra-enhance', 'Elite', { aliases: ['Select 550'] })],
    ['a name that repeats the brand', model('jabra-enhance', 'Jabra Enhance Select 550')],
  ])('extractRetailReviews knows the page by %s', async (_, same) => {
    replies(retailReply)
    const text = (await fixture('reviews/retail.txt')).replace('Jabra Enhance ', '')

    expect(await extractRetailReviews(same, okPage(RETAIL_URL, text))).toMatchObject({ rating: 4.3 })
  })

  test('complaintThemes computes share in code and drops n<3', async () => {
    const texts = Array.from({ length: 10 }, (_, i) => `review number ${i}`)
    replies({
      reviews: [
        // Review 0 names battery twice and comes twice: it still counts once.
        { index: 0, themes: ['battery', 'battery', 'app'] },
        { index: 0, themes: ['battery'] },
        { index: 1, themes: ['battery', 'app'] },
        { index: 2, themes: ['battery'] },
        { index: 3, themes: ['battery'] },
        ...[4, 5, 6, 7, 8, 9].map((index) => ({ index, themes: [] })),
        { index: 99, themes: ['app'] },
      ],
    })

    expect(await complaintThemes(texts)).toEqual([{ theme: 'battery', share: 0.4, n: 4, of: 10 }])
  })

  test('complaintThemes splits long input into prompts within the budget', async () => {
    const texts = Array.from({ length: 60 }, (_, i) => `${i} ${'x'.repeat(3000)}`)
    llmMock.mockImplementation(async ({ prompt, schema }) =>
      schema.parse({ reviews: [...prompt.matchAll(/^\[(\d+)\]/gm)].map((m) => ({ index: Number(m[1]), themes: ['app'] })) }),
    )

    expect(await complaintThemes(texts)).toEqual([{ theme: 'app', share: 1, n: 60, of: 60 }])
    expect(llmMock.mock.calls.length).toBeGreaterThan(1)
    for (const [{ prompt }] of llmMock.mock.calls) expect(prompt.length).toBeLessThan(50_000)
  })

  const tagged = (prompt: string) => [...prompt.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]))

  test('complaintThemes asks about at most 50 reviews at once and takes only their numbers', async () => {
    const texts = Array.from({ length: 120 }, (_, i) => `review ${i}`)
    // Only the later batches tag reviews 0-2, which belong to the first.
    llmMock.mockImplementation(async ({ prompt, schema }) => {
      const asked = tagged(prompt)
      const strays = asked.includes(0) ? [] : [0, 1, 2].map((index) => ({ index, themes: ['app'] }))
      return schema.parse({ reviews: [...asked.map((index) => ({ index, themes: [] })), ...strays] })
    })

    expect(await complaintThemes(texts)).toEqual([])
    expect(llmMock.mock.calls.map(([{ prompt }]) => tagged(prompt).length)).toEqual([50, 50, 20])
  })

  test.each([
    ['answers in full the second time', [[0, 1], [0, 1, 2]], 'themes'],
    ['leaves a review out twice', [[0, 1], [0, 2]], 'error'],
  ])('complaintThemes: a model that %s', async (_, answers, outcome) => {
    const { llm: realLlm } = await vi.importActual<typeof import('@/pipeline/llm')>('@/pipeline/llm')
    const cacheDir = await mkdtemp(join(tmpdir(), 'llm-'))
    let calls = 0
    const exec = async () => {
      const reviews = answers[calls++].map((index) => ({ index, themes: ['app'] }))
      return { stdout: JSON.stringify({ structured_output: { reviews } }), stderr: '' }
    }
    llmMock.mockImplementation((options) => realLlm(options, { exec, cacheDir }))

    const result = complaintThemes(['a', 'b', 'c'])

    if (outcome === 'error') await expect(result).rejects.toThrow(LlmOutputError)
    else expect(await result).toEqual([{ theme: 'app', share: 1, n: 3, of: 3 }])
    expect(calls).toBe(2)
    await rm(cacheDir, { recursive: true })
  })

  test('complaintThemes of nothing asks nothing', async () => {
    expect(await complaintThemes([])).toEqual([])
    expect(llmMock).not.toHaveBeenCalled()
  })
})

describe('synthesizeProsCons', () => {
  const A = 'https://reviews.example/a'
  const B = 'https://www.youtube.com/watch?v=aaaaaaaaaaa'
  const inputs = [
    { sourceUrl: A, pros: ['clear speech'], cons: ['short battery'] },
    { sourceUrl: B, pros: ['clear in noise'], cons: [] },
  ]

  test('synthesizeProsCons drops items with unknown source or forbidden phrases', async () => {
    replies({
      pros: [
        { text: 'Clear speech', sources: [A, B, 'https://invented.example'] },
        { text: 'Comfortable', sources: ['https://invented.example'] },
        { text: 'Light', sources: [] },
        { text: 'We tested it and loved it', sources: [A] },
        { text: 'word '.repeat(16), sources: [A] },
        { text: 'word '.repeat(15), sources: [B] },
      ],
      cons: [
        { text: 'Short battery life', sources: [A] },
        { text: 'In our testing it whistled', sources: [A] },
      ],
    })

    expect(await synthesizeProsCons(inputs)).toEqual({
      pros: [
        { text: 'Clear speech', sources: [A, B] },
        { text: 'word '.repeat(15).trim(), sources: [B] },
      ],
      cons: [{ text: 'Short battery life', sources: [A] }],
    })
  })

  test('nothing to say → null, without a model call when there is no input', async () => {
    expect(await synthesizeProsCons([{ sourceUrl: A, pros: [], cons: [] }])).toBeNull()
    expect(llmMock).not.toHaveBeenCalled()

    replies({ pros: [{ text: 'Light', sources: [] }], cons: [] })
    expect(await synthesizeProsCons(inputs)).toBeNull()
  })
})

describe('extractExpertProsCons', () => {
  const sphere = model('phonak', 'Audeo Sphere')
  const URL_ = 'https://reviews.example/sphere'
  const page = okPage(URL_, 'Phonak Audeo Sphere review. Speech is clear in noise. The case is bulky.')

  test('lists what the review says, cites the fetched page and drops first-hand phrasing', async () => {
    replies({
      reviewsThisModel: true,
      pros: ['Clear speech in noise', 'We tested it and it is great', '  '],
      cons: ['Bulky case'],
    })

    expect(await extractExpertProsCons(page, sphere)).toEqual({
      sourceUrl: URL_,
      pros: ['Clear speech in noise'],
      cons: ['Bulky case'],
    })
    const [{ provider, prompt, tools }] = llmMock.mock.calls[0]
    expect({ provider, tools }).toEqual({ provider: 'claude', tools: undefined })
    expect(prompt).toContain('phonak Audeo Sphere')
    expect(prompt).toContain(page.text)
  })

  test.each([
    ['a page that is not a review of the model', { reviewsThisModel: false, pros: ['Clear'], cons: [] }],
    ['nothing left to list', { reviewsThisModel: true, pros: ['Hands-on it feels great'], cons: [] }],
  ])('null for %s', async (_, reply) => {
    replies(reply)

    expect(await extractExpertProsCons(page, sphere)).toBeNull()
  })

  test('points longer than 15 words, or repeating 8 words of the page in a row, are dropped', async () => {
    const sentence = 'The battery easily lasts from early breakfast until well after the late news.'
    replies({
      reviewsThisModel: true,
      pros: [
        // Eight words in a row, whatever the case and punctuation.
        'THE BATTERY, EASILY LASTS from early breakfast until',
        // Seven are allowed.
        'Battery easily lasts from early breakfast until bedtime',
        'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen',
      ],
      cons: ['Lasts from early breakfast until well after the late news'],
    })

    expect(await extractExpertProsCons(okPage(URL_, `Phonak Audeo Sphere. "'${sentence}'"`), sphere)).toEqual({
      sourceUrl: URL_,
      pros: ['Battery easily lasts from early breakfast until bedtime'],
      cons: [],
    })
  })

  test('a long page is cut to the prompt budget, keeping the verdict', async () => {
    replies({ reviewsThisModel: true, pros: ['Light'], cons: [] })
    const long = okPage(URL_, `${'filler '.repeat(20_000)}Pros and cons: light. Drawbacks: none. Verdict: good.`)

    await extractExpertProsCons(long, sphere)

    const [{ prompt }] = llmMock.mock.calls[0]
    expect(prompt.length).toBeLessThan(50_000)
    expect(prompt).toContain('Verdict: good.')
  })
})

describe('youtube', () => {
  const sphere = model('phonak', 'Audeo Sphere')

  test('searchVideos returns the three most viewed of the results that name the model', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', 'test-key')
    const [search, videos] = [await fixture('youtube/search.json'), await fixture('youtube/videos.json')]
    const fetchStub = vi.fn<typeof fetch>(async (input) =>
      new Response(String(input).includes('/search?') ? search : videos),
    )

    // The most viewed result is about another model.
    expect(await searchVideos(sphere, { fetch: fetchStub })).toEqual([
      { id: 'ddddddddddd', channel: 'Channel D', title: "Audeo Sphere & me: what's new" },
      { id: 'aaaaaaaaaaa', channel: 'Channel A', title: 'Audeo Sphere review' },
      { id: 'ccccccccccc', channel: 'Channel C', title: 'Unboxing' },
    ])
    const [first, second] = fetchStub.mock.calls.map(([url]) => new URL(String(url)))
    expect(first.origin + first.pathname).toBe('https://www.googleapis.com/youtube/v3/search')
    expect(Object.fromEntries(first.searchParams)).toEqual({
      part: 'snippet',
      q: 'phonak Audeo Sphere review',
      type: 'video',
      maxResults: '10',
      relevanceLanguage: 'en',
    })
    expect(second.searchParams.get('part')).toBe('statistics')
    expect(second.searchParams.get('id')).toBe('aaaaaaaaaaa,ccccccccccc,ddddddddddd')
    // The key travels in a header, so that no URL in a log or an error carries it.
    expect(fetchStub.mock.calls[0][1]?.headers).toEqual({ 'x-goog-api-key': 'test-key' })
  })

  test('searchVideos knows a model by its alias, and asks no statistics when no result names it', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', 'test-key')
    const [search, videos] = [await fixture('youtube/search.json'), await fixture('youtube/videos.json')]
    const fetchStub = vi.fn<typeof fetch>(async (input) =>
      new Response(String(input).includes('/search?') ? search : videos),
    )

    const aliased = model('phonak', 'Audeo L', { aliases: ['Phonak Audeo Lumity'] })
    expect((await searchVideos(aliased, { fetch: fetchStub })).map((video) => video.id)).toEqual(['bbbbbbbbbbb'])

    fetchStub.mockClear()
    expect(await searchVideos(model('phonak', 'Virto'), { fetch: fetchStub })).toEqual([])
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  test('a missing key or a refusal is a YouTubeError', async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => new Response('quotaExceeded', { status: 403 }))

    vi.stubEnv('YOUTUBE_API_KEY', '')
    await expect(searchVideos(sphere, { fetch: fetchStub })).rejects.toThrow(YouTubeError)
    expect(fetchStub).not.toHaveBeenCalled()

    vi.stubEnv('YOUTUBE_API_KEY', 'test-key')
    await expect(searchVideos(sphere, { fetch: fetchStub })).rejects.toThrow(/HTTP 403 quotaExceeded/)
  })

  test('analyzeVideo asks Gemini what the video says about this model', async () => {
    replies({ reviewsThisModel: true, pros: ['clear speech', 'word '.repeat(16)], cons: ['bulky'] })

    expect(await analyzeVideo('aaaaaaaaaaa', sphere)).toEqual({ pros: ['clear speech'], cons: ['bulky'] })
    const [[options]] = llmMock.mock.calls
    expect(options).toMatchObject({ provider: 'gemini', youtubeUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' })
    expect(options.prompt).toContain('"phonak Audeo Sphere"')
    await expect(analyzeVideo('../x', sphere)).rejects.toThrow('not a YouTube video id')
  })

  test('analyzeVideo gives nothing for a video that does not review this model', async () => {
    replies({ reviewsThisModel: false, pros: ['clear speech'], cons: ['bulky'] })

    expect(await analyzeVideo('aaaaaaaaaaa', sphere)).toEqual({ pros: [], cons: [] })
  })
})

describe('discoverThirdPartyFacts', () => {
  const PRICE_URL = 'https://clinic.example/prices'
  const level = (id: string) => ({ id, formFactor: 'RIC' as const })
  const rx = model('phonak', 'Audeo Sphere', { type: 'rx', variants: [level('i90'), level('i70'), level('i50')] })

  const search = { priceSources: [PRICE_URL, 'https://www.amazon.com/dp/B0'], sameHardwareSources: [PRICE_URL] }
  const extraction = {
    prices: [
      { variantIds: ['i90', 'unknown'], min: 5400, max: 7200, quote: 'Phonak Audeo Sphere I90: $5,400 - $7,200 per pair' },
      { variantIds: ['i70'], min: 4200, max: 4200, quote: 'Phonak Audeo Sphere I70: $4,200 per pair.' },
      { variantIds: ['i50'], min: 1800, max: 1800, quote: 'Phonak Audeo Sphere I50: $1,800.' },
    ],
    sameHardware: [
      { brand: 'Unitron', name: 'Smile R', quote: 'The Unitron Smile R uses the same hardware as the Phonak Audeo Sphere.' },
      // The model itself is not its own twin.
      { brand: 'Phonak', name: 'Audeo Sphere', quote: 'the same hardware as the Phonak Audeo Sphere' },
    ],
  }
  const serve = async () => {
    const text = await fixture('reviews/price-list.txt')
    fetchMock.mockImplementation(async (url) => okPage(url, text))
  }

  test('discoverThirdPartyFacts emits only Rx price/sameHardwareAs paths with sourceType third-party', async () => {
    await serve()
    replies(search, extraction)

    const changes = await discoverThirdPartyFacts(rx)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([PRICE_URL])
    expect(changes.map((change) => [change.kind, change.modelSlug, change.path])).toEqual(
      ['variants.0.priceUsd', 'variants.1.priceUsd', 'variants.2.priceUsd', 'sameHardwareAs'].map((path) => [
        'spec-change',
        'phonak-audeo-sphere',
        path,
      ]),
    )
    const [i90, , i50, twins] = changes
    expect(i90.after).toEqual({
      value: { min: 5400, max: 7200, perPair: true },
      unit: 'USD',
      sourceUrl: PRICE_URL,
      quote: 'Phonak Audeo Sphere I90: $5,400 - $7,200 per pair',
      fetchedAt: FETCHED_AT,
      sourceType: 'third-party',
    })
    expect(i90.checks).toEqual({ 'variants.0.priceUsd': [{ name: 'literal', ok: true }, { name: 'range', ok: true }] })
    expect(i50.checks['variants.2.priceUsd'][0]).toMatchObject({ name: 'literal', ok: false, detail: expect.stringContaining('pair') })
    expect(twins.after).toEqual([
      {
        slug: 'unitron-smile-r',
        source: expect.objectContaining({ value: 'Smile R', sourceUrl: PRICE_URL, sourceType: 'third-party' }),
      },
    ])
    expect(twins.checks).toEqual({ sameHardwareAs: [{ name: 'literal', ok: true }, { name: 'range', ok: true }] })

    // What the candidates would write is a model the schema accepts.
    const applied = structuredClone(rx)
    applied.variants[0].priceUsd = i90.after as Model['variants'][number]['priceUsd']
    applied.sameHardwareAs = twins.after as Model['sameHardwareAs']
    Model.parse(applied)
  })

  test('an OTC model gets no prices, and an official Rx price is not replaced', async () => {
    await serve()
    replies(search, extraction)
    const otc = await discoverThirdPartyFacts(model('phonak', 'Audeo Sphere', { variants: [level('i90')] }))
    expect(otc.map((change) => change.path)).toEqual(['sameHardwareAs'])

    replies(search, { ...extraction, sameHardware: [] })
    const official = {
      value: 5000,
      sourceUrl: 'https://www.phonak.com/x',
      quote: '$5,000',
      fetchedAt: FETCHED_AT,
      sourceType: 'official' as const,
    }
    const priced = model('phonak', 'Audeo Sphere', { type: 'rx', variants: [{ ...level('i90'), priceUsd: official }] })
    expect(await discoverThirdPartyFacts(priced)).toEqual([])
  })

  test('a page must name the model in full, as stored', async () => {
    fetchMock.mockImplementation(async (url) => okPage(url, 'Audeo Sphere: $4,000 per pair'))
    replies(search)

    expect(await discoverThirdPartyFacts({ ...rx, name: 'Phonak Audeo Sphere' })).toEqual([])
    expect(llmMock).toHaveBeenCalledTimes(1)
  })

  test('a quote over 300 characters fails the literal check', async () => {
    const long = `The Unitron Smile R uses the same hardware as the Phonak Audeo Sphere I90: $5,000 per pair. ${'More words. '.repeat(30)}`
    fetchMock.mockImplementation(async (url) => okPage(url, long))
    replies(search, {
      prices: [{ variantIds: ['i90'], min: 5000, max: 5000, quote: long }],
      sameHardware: [{ brand: 'Unitron', name: 'Smile R', quote: long }],
    })

    const [price, twins] = await discoverThirdPartyFacts(rx)

    const tooLong = { name: 'literal', ok: false, detail: 'quote-too-long' }
    expect(price.checks['variants.0.priceUsd'][0]).toEqual(tooLong)
    expect(twins.checks.sameHardwareAs[0]).toEqual(tooLong)
  })

  test('the search names the month, and refresh reaches every page fetch', async () => {
    await serve()
    replies(search, { prices: [], sameHardware: [] })

    await discoverThirdPartyFacts(rx, { asOf: '2027-03', refresh: true })

    expect(llmMock.mock.calls[0][0].prompt).toContain('2027-03')
    expect(fetchMock.mock.calls).toEqual([[PRICE_URL, { refresh: true }]])

    replies(search, { prices: [], sameHardware: [] })
    await discoverThirdPartyFacts(rx)
    expect(llmMock.mock.calls[2][0].prompt).toContain(new Date().toISOString().slice(0, 7))
    expect(fetchMock.mock.calls[1]).toEqual([PRICE_URL, { refresh: undefined }])
  })

  test('a skipped page, or one that does not name the model, gives nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementationOnce(async (url) => ({ status: 'skipped', url, reason: 'bot-protection' }))
    fetchMock.mockImplementationOnce(async (url) => okPage(url, 'Prices of other hearing aids: $4,000 per pair'))
    replies({ priceSources: [PRICE_URL, 'https://clinic.example/other'], sameHardwareSources: [] })

    expect(await discoverThirdPartyFacts(rx)).toEqual([])
    expect(llmMock).toHaveBeenCalledTimes(1)
  })
})
