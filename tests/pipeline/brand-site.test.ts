// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { crossCheck, isRisky } from '@/pipeline/checks/crosscheck'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { llm, LlmUnavailableError } from '@/pipeline/llm'
import { discoverModelUrls, extractModel, matchExistingModel, mergeCandidates, type ModelCandidate } from '@/pipeline/sources/brand-site'
import { loadDataset } from '@/src/lib/data/load'
import type { Brand } from '@/src/lib/schema/brand'
import { Model } from '@/src/lib/schema/model'

vi.mock('@/pipeline/fetch/fetcher', () => ({ fetchPage: vi.fn() }))
vi.mock('@/pipeline/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/llm')>()),
  llm: vi.fn(),
}))

const fetchMock = vi.mocked(fetchPage)
const llmMock = vi.mocked(llm)

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

const fixture = (name: string) => readFile(fileURLToPath(new URL(`../fixtures/brands/${name}`, import.meta.url)), 'utf8')

type Ok = Extract<FetchResult, { status: 'ok' }>

const brand: Brand = {
  slug: 'phonak',
  name: 'Phonak',
  group: 'Sonova',
  website: 'https://www.phonak.com',
  imageLicense: 'none',
  defaultType: 'rx',
  status: 'active',
  scraper: {
    catalogUrls: ['https://www.phonak.com/en-us/hearing-devices/hearing-aids'],
    supportUrls: ['https://www.phonak.com/en-us/support/datasheets'],
    modelUrlPattern: '^https://www\\.phonak\\.com/en-us/hearing-devices/hearing-aids/(?!product-comparison$)[a-z0-9-]+$',
    documentUrlPattern: '^https://www\\.phonak\\.com/content/dam/celum/phonak/.*(?:[Dd]atasheet|[Uu]ser-?[Gg]uide).*\\.pdf$',
    render: false,
  },
}

const okPage = (url: string, text: string, html?: string): Ok => ({
  status: 'ok',
  url,
  text,
  ...(html !== undefined && { html }),
  contentHash: 'hash',
  fetchedAt: url.endsWith('.pdf') ? '2026-11-26T10:00:01.000Z' : '2026-11-26T10:00:00.000Z',
})

const MODEL_URL = 'https://www.phonak.com/en-us/hearing-devices/hearing-aids/audeo-sphere'
const DATASHEET_URL = 'https://www.phonak.com/content/dam/celum/phonak/docs/ph-datasheet-audeo-i-sphere.pdf'

async function fixturePages(): Promise<Ok[]> {
  return [
    okPage(MODEL_URL, await fixture('model-page.txt'), '<html></html>'),
    okPage(DATASHEET_URL, await fixture('datasheet.txt')),
  ]
}

async function extractFixture(change: (output: Record<string, unknown>) => void = () => {}) {
  const output = JSON.parse(await fixture('extraction.json'))
  change(output)
  // Parsed with the schema extractModel passes, as llm() would, so a reply the schema rejects fails here too.
  llmMock.mockImplementation(async ({ schema }) => schema.parse(output))
  return extractModel(brand, await fixturePages())
}

type Output = Record<string, unknown> & { variants: Record<string, unknown>[] }
const withVariant = (fields: Record<string, unknown>) => (output: Record<string, unknown>) =>
  Object.assign((output as Output).variants[0], fields)

describe('discoverModelUrls', () => {
  test('discovers model URLs by pattern only, each with the documents that name it', async () => {
    const html = await fixture('catalog.html')
    fetchMock.mockImplementation(async (url) =>
      url === brand.scraper.catalogUrls[0]
        ? okPage(url, 'catalog', html)
        : { status: 'skipped', url, reason: 'robots', detail: 'disallowed' },
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const docs = 'https://www.phonak.com/content/dam/celum/phonak/docs'

    expect(await discoverModelUrls(brand)).toEqual([
      { modelUrl: MODEL_URL, documentUrls: [`${docs}/ph-datasheet-audeo-i-sphere.pdf`, `${docs}/PH_UserGuide_Audeo_I_Sphere.pdf`], inCatalog: true },
      { modelUrl: 'https://www.phonak.com/en-us/hearing-devices/hearing-aids/virto-infinio', documentUrls: [], inCatalog: true },
      {
        modelUrl: 'https://www.phonak.com/en-us/hearing-devices/hearing-aids/audeo-eon-sphere',
        documentUrls: [`${docs}/ph-datasheet-audeo-eon-sphere-210x297-en-v1.00.pdf`],
        inCatalog: true,
      },
      { modelUrl: 'https://www.phonak.com/en-us/hearing-devices/hearing-aids/audeo-infinio', documentUrls: [], inCatalog: true },
    ])
    expect(fetchMock).toHaveBeenCalledWith(brand.scraper.catalogUrls[0], { render: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('robots'))

    // A re-run asked to refresh fetches the catalogs again, so newly listed models are seen.
    fetchMock.mockClear()
    await discoverModelUrls(brand, { refresh: true })
    for (const url of [...brand.scraper.catalogUrls, ...brand.scraper.supportUrls!])
      expect(fetchMock).toHaveBeenCalledWith(url, { render: false, refresh: true })
    // Dropped: "audeo-r" names only the family "audeo"; "Virto-P" is another generation than "virto-infinio";
    // the annex names no model. The brochure does not match the document pattern at all.
    expect(warn).toHaveBeenCalledWith('phonak: 3 documents match no model page')
  })

  test('support pages give model links and documents like catalog pages', async () => {
    const support = 'https://www.phonak.com/en-us/support/user-guides/eon'
    const pdf = 'https://www.phonak.com/content/dam/celum/phonak/docs/ph-datasheet-audeo-eon-sphere.pdf'
    const modelUrl = 'https://www.phonak.com/en-us/hearing-devices/hearing-aids/audeo-eon-sphere'
    const withSupport = { ...brand, scraper: { ...brand.scraper, supportUrls: [support] } }
    fetchMock.mockImplementation(async (url) =>
      url === support
        ? okPage(url, 'support', `<a href="${pdf}">sheet</a><a href="${modelUrl}">model</a>`)
        : okPage(url, 'catalog', '<p>nothing</p>'),
    )

    expect(await discoverModelUrls(withSupport)).toEqual([{ modelUrl, documentUrls: [pdf], inCatalog: false }])
    expect(fetchMock).toHaveBeenCalledWith(support, { render: false })
  })

  test('inCatalog is true only for links from catalog pages', async () => {
    const support = 'https://www.phonak.com/en-us/support/datasheets'
    const base = 'https://www.phonak.com/en-us/hearing-devices/hearing-aids'
    const withSupport = { ...brand, scraper: { ...brand.scraper, supportUrls: [support] } }
    fetchMock.mockImplementation(async (url) =>
      url === support
        ? okPage(url, 'support', `<a href="${base}/audeo-sphere">a</a><a href="${base}/virto-infinio">v</a>`)
        : okPage(url, 'catalog', `<a href="${base}/audeo-sphere">a</a><a href="${base}/audeo-infinio">i</a>`),
    )

    const found = await discoverModelUrls(withSupport)

    expect(found.map(({ modelUrl, inCatalog }) => [modelUrl.split('/').at(-1), inCatalog])).toEqual([
      ['audeo-sphere', true], // linked from both kinds of pages
      ['audeo-infinio', true],
      ['virto-infinio', false],
    ])
  })

  test('a skipped catalog is reported to onSkip instead of the log', async () => {
    fetchMock.mockImplementation(async (url) => ({ status: 'skipped', url, reason: 'bot-protection', detail: 'HTTP 403' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onSkip = vi.fn()

    expect(await discoverModelUrls(brand, { onSkip })).toEqual([])

    expect(onSkip.mock.calls).toEqual([...brand.scraper.catalogUrls, ...brand.scraper.supportUrls!].map((url) => [url, 'bot-protection', 'HTTP 403']))
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('extractModel', () => {
  test('field missing from LLM output is absent, not null', async () => {
    const { model, fieldChecks } = await extractFixture()

    expect(Model.parse(model)).toEqual(model)
    for (const key of ['platform', 'materials', 'tinnitus', 'fda', 'app']) expect(Object.keys(model)).not.toContain(key)
    expect(Object.keys(model.variants[0])).not.toContain('ipRating')
    expect(Object.keys(model.variants[0])).not.toContain('priceUsd')
    expect(Object.keys(fieldChecks).sort()).toEqual([
      'colors',
      'connectivity',
      'releaseDate',
      'type',
      'variants.0.dimensionsMm',
      'variants.0.power',
      'variants.0.weightG',
    ])
  })

  test('sourceUrl comes from sourceIndex, not from LLM text', async () => {
    const { model } = await extractFixture()
    const [page, datasheet] = await fixturePages()

    expect(model.colors).toEqual({
      value: ['Sand Beige', 'Champagne'],
      sourceUrl: page.url,
      quote: 'Available colors: Sand Beige, Champagne',
      fetchedAt: page.fetchedAt,
      sourceType: 'official',
    })
    expect(model.variants[0].dimensionsMm).toMatchObject({ sourceUrl: datasheet.url, fetchedAt: datasheet.fetchedAt, unit: 'mm' })
    // The tinnitus field cites a source that was not given, so nothing can vouch for it.
    expect(model.tinnitus).toBeUndefined()
  })

  test('builds the model and runs literal and range checks per field', async () => {
    const { model, fieldChecks } = await extractFixture()

    expect(model).toMatchObject({ slug: 'phonak-audeo-sphere-infinio', brand: 'phonak', name: 'Audéo Sphere™ Infinio', type: 'rx' })
    expect(model.variants[0]).toMatchObject({ id: 'audeo-i90-sphere', techLevel: 'I90', formFactor: 'RIC' })
    // Derived in code from the quoted ounces; the LLM's own number (999) is ignored.
    expect(model.variants[0].weightG).toEqual({
      value: 3.12,
      unit: 'g',
      sourceUrl: DATASHEET_URL,
      quote: 'Weight: 0.11 oz',
      fetchedAt: '2026-11-26T10:00:01.000Z',
      sourceType: 'derived',
      derivation: { op: 'oz-to-g', input: '0.11 oz' },
    })
    expect(fieldChecks['variants.0.weightG']).toEqual([
      { name: 'literal', ok: true },
      { name: 'range', ok: true },
    ])
    expect(fieldChecks['variants.0.power']).toEqual([
      { name: 'literal', ok: true },
      { name: 'range', ok: true },
    ])
  })

  test('a quote that is not on the cited page and an implausible value fail their checks', async () => {
    const { fieldChecks } = await extractFixture((output) => {
      const [variant] = output.variants as Record<string, Record<string, unknown>>[]
      variant.dimensionsMm = { value: { l: 316, w: 6.8, h: 12.8 }, unit: 'mm', quote: 'Dimensions: 316 x 6.8 x 12.8 mm', sourceIndex: 1 }
    })

    expect(fieldChecks['variants.0.dimensionsMm']).toEqual([
      { name: 'literal', ok: false, detail: 'quote not found in source text' },
      { name: 'range', ok: false, detail: expect.stringContaining('outside 3–60 mm') },
    ])
  })

  test('a measurement without a derivation in a unit the field does not store is left out', async () => {
    const { model } = await extractFixture((output) => {
      const [variant] = output.variants as Record<string, Record<string, unknown>>[]
      variant.weightG = { value: 0.11, unit: 'oz', quote: 'Weight: 0.11 oz', sourceIndex: 1 }
    })

    expect(model.variants[0].weightG).toBeUndefined()
  })

  test('empty lists and objects are left out, not stored as sourced fields', async () => {
    const { model, fieldChecks } = await extractFixture((output) =>
      Object.assign(output, {
        materials: { value: [], quote: 'Available colors: Sand Beige, Champagne', sourceIndex: 0 },
        colors: { value: [], quote: 'Available colors: Sand Beige, Champagne', sourceIndex: 0 },
        connectivity: { value: {}, quote: 'Made for iPhone', sourceIndex: 0 },
        platform: { value: ' ', quote: 'Made for iPhone', sourceIndex: 0 },
      }),
    )

    for (const key of ['materials', 'colors', 'connectivity', 'platform']) {
      expect(Object.keys(model)).not.toContain(key)
      expect(Object.keys(fieldChecks)).not.toContain(key)
    }
  })

  test('pair-to-unit halves the quoted pair weight; an input without a mass is rejected', async () => {
    const pair = { value: 6.2, unit: 'g', quote: 'Weight of a pair: 6.2 g', sourceIndex: 1 }
    const { model, fieldChecks } = await extractFixture(
      withVariant({ weightG: { ...pair, value: 99, derivation: { op: 'pair-to-unit', input: '6.2 g' } } }),
    )
    expect(model.variants[0].weightG).toMatchObject({
      value: 3.1,
      unit: 'g',
      sourceType: 'derived',
      derivation: { op: 'pair-to-unit', input: '6.2 g' },
    })
    expect(fieldChecks['variants.0.weightG']).toEqual([
      { name: 'literal', ok: true },
      { name: 'range', ok: true },
    ])

    // A piece of the quoted number ("2 g" out of "6.2 g") is computed but fails the literal check, so it goes to review.
    const { fieldChecks: partial } = await extractFixture(
      withVariant({ weightG: { ...pair, derivation: { op: 'pair-to-unit', input: '2 g' } } }),
    )
    expect(partial['variants.0.weightG'][0]).toMatchObject({ name: 'literal', ok: false })

    for (const input of ['6.2 mm', 'a pair']) {
      const { model: rejected } = await extractFixture(withVariant({ weightG: { ...pair, derivation: { op: 'pair-to-unit', input } } }))
      expect(rejected.variants[0].weightG).toBeUndefined()
    }
  })

  test('in-to-mm converts the three quoted inches in l, w, h order; two numbers or another unit are rejected', async () => {
    const size = { value: { l: 1, w: 1, h: 1 }, unit: 'in', quote: 'Size: 1.1 x 0.3 x 0.5 in', sourceIndex: 1 }
    const { model, fieldChecks } = await extractFixture(
      withVariant({ dimensionsMm: { ...size, derivation: { op: 'in-to-mm', input: '1.1 x 0.3 x 0.5 in' } } }),
    )
    expect(model.variants[0].dimensionsMm).toMatchObject({
      value: { l: 27.9, w: 7.6, h: 12.7 },
      unit: 'mm',
      sourceType: 'derived',
      derivation: { op: 'in-to-mm', input: '1.1 x 0.3 x 0.5 in' },
    })
    expect(fieldChecks['variants.0.dimensionsMm']).toEqual([
      { name: 'literal', ok: true },
      { name: 'range', ok: true },
    ])

    for (const input of ['1.1 x 0.3 in', '1.1 x 0.3 x 0.5 mm']) {
      const { model: rejected } = await extractFixture(withVariant({ dimensionsMm: { ...size, derivation: { op: 'in-to-mm', input } } }))
      expect(rejected.variants[0].dimensionsMm).toBeUndefined()
    }
  })

  test('priceUsd is stored in USD from the cited page; the LLM gives no unit for it', async () => {
    const price = { value: 1195, quote: 'Price: $1,195 per pair', sourceIndex: 1 }
    const { model, fieldChecks } = await extractFixture(withVariant({ priceUsd: price }))

    expect(model.variants[0].priceUsd).toEqual({
      value: 1195,
      unit: 'USD',
      sourceUrl: DATASHEET_URL,
      quote: 'Price: $1,195 per pair',
      fetchedAt: '2026-11-26T10:00:01.000Z',
      sourceType: 'official',
    })
    expect(fieldChecks['variants.0.priceUsd']).toEqual([
      { name: 'literal', ok: true },
      { name: 'range', ok: true },
      { name: 'price-basis', ok: true },
    ])
    // The prompt must not ask for what the schema refuses.
    expect(llmMock.mock.calls[0][0].prompt).not.toMatch(/priceUsd[^\n]*unit/)
    await expect(extractFixture(withVariant({ priceUsd: { ...price, unit: 'USD' } }))).rejects.toThrow()
  })

  test('the battery type is a reading of the text: only the hours are looked up in the quote', async () => {
    const power = { value: { type: 'rechargeable', batteryHours: 16 }, quote: 'up to 16 hours', sourceIndex: 1 }
    const { fieldChecks } = await extractFixture(withVariant({ power }))
    expect(fieldChecks['variants.0.power']).toEqual([
      { name: 'literal', ok: true },
      { name: 'range', ok: true },
    ])
    const { fieldChecks: wrong } = await extractFixture(withVariant({ power: { ...power, value: { type: '312', batteryHours: 18 } } }))
    expect(wrong['variants.0.power'][0]).toMatchObject({ name: 'literal', ok: false, detail: 'value not in quote: [18]' })
  })

  test('a price quote with two amounts or a sale word fails price-basis, so the change waits for a person', async () => {
    const pages = async (line: string) => [...(await fixturePages()), okPage('https://www.phonak.com/en-us/shop', line)]
    const basis = async (quote: string, value: number) => {
      const output = JSON.parse(await fixture('extraction.json'))
      output.variants[0].priceUsd = { value, quote, sourceIndex: 2 }
      llmMock.mockImplementation(async ({ schema }) => schema.parse(output))
      const { fieldChecks } = await extractModel(brand, await pages(`Offer\n${quote}\nEnd`))
      return fieldChecks['variants.0.priceUsd'].find((check) => check.name === 'price-basis')
    }
    expect(await basis('Price: $1,195 per pair', 1195)).toEqual({ name: 'price-basis', ok: true })
    for (const [quote, value] of [
      ['$1,695 $1,995', 1695],
      ['$597 $447/pair', 447],
      ['just $389/pair, save 20%', 389],
      ['Holiday Sale: $1,299', 1299],
      ['Black Friday deal $799 per pair', 799],
      ['Regular price $1,995', 1995],
    ] as const) {
      expect(await basis(quote, value), quote).toMatchObject({ name: 'price-basis', ok: false })
    }
    // "Save" inside a word is not a sale word.
    expect(await basis('Price: $1,195 per pair, Saveur edition', 1195)).toEqual({ name: 'price-basis', ok: true })
  })

  test('the prompt asks for the regular price and for the family name with styles as variants', async () => {
    await extractFixture()
    const { prompt } = llmMock.mock.calls[0][0]
    expect(prompt).toMatch(/regular \(non-sale\) price[^\n]*leave it out if only a sale price is shown/i)
    expect(prompt).toMatch(/name: the model family[^\n]*without the style/i)
  })

  test("type: the brand's default when the sources do not say; a page that says otherwise is flagged", async () => {
    const { model, fieldChecks } = await extractFixture((output) => delete output.type)
    expect(model.type).toBe('rx')
    expect(fieldChecks.type).toEqual([{ name: 'brand-type', ok: true }])

    const otc = { value: 'otc', quote: 'Prescription hearing aid fitted by your hearing care professional', sourceIndex: 0 }
    const flagged = await extractFixture((output) => Object.assign(output, { type: otc }))
    expect(flagged.model.type).toBe('otc')
    expect(flagged.fieldChecks.type).toEqual([
      { name: 'literal', ok: true },
      { name: 'brand-type', ok: false, detail: `the page says otc ("${otc.quote}"); the brand default is rx` },
    ])

    const agrees = await extractFixture()
    expect(agrees.model.type).toBe('rx')
    expect(agrees.fieldChecks.type).toEqual([{ name: 'literal', ok: true }, { name: 'brand-type', ok: true }])
  })

  test('a model without a release date is no longer flagged no-release-date', async () => {
    const { model, fieldChecks } = await extractFixture((output) => delete output.releaseDate)

    expect(model.releaseDate).toBeUndefined()
    expect(fieldChecks.releaseDate).toBeUndefined()
  })

  test('the prompt holds at most ~48,000 characters of page text, documents first, spec table kept', async () => {
    llmMock.mockResolvedValue(JSON.parse(await fixture('extraction.json')))
    const long = `${'Marketing copy. '.repeat(6000)}\nTechnical data\nWeight: 2.1 g SPEC-MARKER\n${'Footer. '.repeat(2000)}`
    const pages = [okPage(MODEL_URL, long, '<html></html>'), okPage(DATASHEET_URL, `Datasheet ${'x'.repeat(80_000)}`)]

    await extractModel(brand, pages)

    const { prompt, provider } = llmMock.mock.calls[0][0]
    expect(provider).toBe('claude')
    expect(prompt.length).toBeLessThan(52_000)
    expect(prompt.indexOf('[Source 1]')).toBeLessThan(prompt.indexOf('[Source 0]'))
    expect(prompt).toContain('SPEC-MARKER')
    expect(prompt).toContain(MODEL_URL)
  })
})

describe('mergeCandidates', () => {
  const at = (url: string) => ({ sourceUrl: url, fetchedAt: '2026-11-26T10:00:00.000Z', sourceType: 'official' as const })
  const R = 'https://www.oticon.com/reveal-minirite-r'
  const T = 'https://www.oticon.com/reveal-minirite-t'
  const candidate = (slug: string, url: string, variant: string, extra: Partial<Model>, checks: ModelCandidate['fieldChecks']): ModelCandidate => ({
    model: Model.parse({
      slug,
      brand: 'oticon',
      name: 'Reveal',
      aliases: [],
      type: 'rx',
      sameHardwareAs: [],
      variants: [{ id: variant, formFactor: 'RIC', ipRating: { value: 'IP68', quote: 'IP68', ...at(url) } }],
      ...extra,
    }),
    fieldChecks: { 'variants.0.ipRating': [{ name: 'literal', ok: url === R }], ...checks },
  })
  const fail = [{ name: 'literal' as const, ok: false }]
  const pass = [{ name: 'literal' as const, ok: true }]

  test('pages of one family become one candidate: variants united by id, checks re-keyed, the first passing field wins', () => {
    const r = candidate('oticon-reveal', R, 'minirite-r', { platform: { value: 'Sirius', quote: 'Sirius', ...at(R) } }, { platform: fail, type: pass })
    const t = candidate('oticon-reveal', T, 'minirite-t', { platform: { value: 'Sirius II', quote: 'Sirius II', ...at(T) } }, { platform: pass, type: pass })
    // The same style on a third page: the first one read is kept.
    const again = candidate('oticon-reveal', T, 'minirite-r', {}, { type: pass })
    const other = candidate('oticon-intent', T, 'bte', {}, {})

    const merged = mergeCandidates([r, t, other, again])

    expect(merged.map((c) => c.model.slug)).toEqual(['oticon-reveal', 'oticon-intent'])
    const [family] = merged
    expect(family.model.variants.map((v) => v.id)).toEqual(['minirite-r', 'minirite-t'])
    expect(family.model.variants[1].ipRating?.sourceUrl).toBe(T)
    expect(family.model.platform?.value).toBe('Sirius II')
    expect(family.fieldChecks).toEqual({
      'variants.0.ipRating': pass,
      'variants.1.ipRating': fail,
      platform: pass,
      type: pass,
    })
    expect(mergeCandidates([r])).toEqual([r])
  })

  test('a field no page passes comes from the first page that has it, with its failed checks; missing-field checks stay', () => {
    const noDate = [{ name: 'range' as const, ok: false, detail: 'no-release-date' }]
    const r = candidate('oticon-reveal', R, 'minirite-r', { colors: { value: ['Beige'], quote: 'Beige', ...at(R) } }, { colors: fail, releaseDate: noDate })
    const t = candidate('oticon-reveal', T, 'minirite-t', { colors: { value: ['Black'], quote: 'Black', ...at(T) } }, { colors: fail, releaseDate: noDate })
    const [family] = mergeCandidates([r, t])
    expect(family.model.colors?.value).toEqual(['Beige'])
    expect(family.fieldChecks.colors).toEqual(fail)
    expect(family.fieldChecks.releaseDate).toEqual(noDate)

    const dated = candidate('oticon-reveal', T, 'minirite-t', { releaseDate: { value: '2024-03', quote: 'March 2024', ...at(T) } }, { releaseDate: pass })
    const [withDate] = mergeCandidates([r, dated])
    expect(withDate.model.releaseDate?.value).toBe('2024-03')
    expect(withDate.fieldChecks.releaseDate).toEqual(pass)
  })
})

describe('matchExistingModel', () => {
  const model = (brandSlug: string, name: string, aliases: string[] = []): Model => ({
    slug: `${brandSlug}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    brand: brandSlug,
    name,
    aliases,
    type: 'rx',
    documents: [],
    sameHardwareAs: [],
    variants: [],
  })
  const cand = (name: string) => model('phonak', name)
  const existing = (name: string, aliases: string[] = []) => ({ ...model('phonak', name, aliases), slug: 'phonak-audeo-sphere-infinio' })

  test('renamed model matches existing via aliases/normalizeName', () => {
    expect(matchExistingModel(cand('Audéo Sphere™ Infinio'), [existing('Audeo Sphere Infinio')])?.slug).toBe('phonak-audeo-sphere-infinio')
    expect(matchExistingModel(cand('Phonak Audéo Sphere™ Infinio'), [existing('Audeo Sphere Infinio')])?.slug).toBe(
      'phonak-audeo-sphere-infinio',
    )
    expect(matchExistingModel(cand('Audéo I-Sphere'), [existing('Audeo Sphere Infinio', ['Phonak Audéo I-Sphere'])])?.slug).toBe(
      'phonak-audeo-sphere-infinio',
    )
  })

  test('another brand or another name does not match', () => {
    expect(matchExistingModel(cand('Audéo Sphere Infinio'), [model('signia', 'Audeo Sphere Infinio')])).toBeNull()
    expect(matchExistingModel(cand('Audéo Infinio'), [existing('Audeo Sphere Infinio')])).toBeNull()
  })
})

describe('crossCheck', () => {
  test('crossCheck mismatch beyond 2% fails; ollama down → ollama-unavailable', async () => {
    llmMock.mockResolvedValueOnce({ value: 3.15 })
    expect(await crossCheck('variants.0.weightG', 'Weight: 0.11 oz', 3.12)).toEqual({ name: 'crosscheck', ok: true })
    expect(llmMock.mock.calls[0][0]).toMatchObject({ provider: 'ollama' })
    expect(llmMock.mock.calls[0][0].prompt).toContain('Weight: 0.11 oz')
    expect(llmMock.mock.calls[0][0].prompt).not.toContain('3.12')

    llmMock.mockResolvedValueOnce({ value: 3.2 })
    expect(await crossCheck('variants.0.weightG', 'Weight: 0.11 oz', 3.12)).toMatchObject({ name: 'crosscheck', ok: false })

    llmMock.mockRejectedValueOnce(new LlmUnavailableError('Ollama is not running'))
    expect(await crossCheck('variants.0.weightG', 'Weight: 0.11 oz', 3.12)).toEqual({
      name: 'crosscheck',
      ok: false,
      detail: 'ollama-unavailable',
    })
  })

  test('compares objects, strings and booleans', async () => {
    llmMock.mockResolvedValueOnce({ value: { l: 31.7, w: 6.8, h: 12.8 } })
    expect((await crossCheck('variants.0.dimensionsMm', 'q', { l: 31.6, w: 6.8, h: 12.8 })).ok).toBe(true)
    llmMock.mockResolvedValueOnce({ value: { mfi: false } })
    expect((await crossCheck('connectivity', 'q', { mfi: true })).ok).toBe(false)
    llmMock.mockResolvedValueOnce({ value: 'IP68' })
    expect((await crossCheck('variants.0.ipRating', 'q', 'ip68')).ok).toBe(true)
    llmMock.mockResolvedValueOnce({ value: { type: 'rechargeable' } })
    expect((await crossCheck('variants.0.power', 'q', { type: 'rechargeable', batteryHours: 16 })).ok).toBe(false)
  })

  test('RISKY_PATHS cover connectivity and the risky variant fields; type is checked against the brand instead', () => {
    expect(isRisky('type')).toBe(false)
    for (const path of ['connectivity', 'tinnitus', 'variants.0.weightG', 'variants.2.dimensionsMm', 'variants.0.ipRating', 'variants.1.power']) {
      expect(isRisky(path)).toBe(true)
    }
    for (const path of ['colors', 'variants.0.priceUsd', 'releaseDate', 'weightG']) expect(isRisky(path)).toBe(false)
  })
})

describe('brand configs', () => {
  test('phonak and jabra-enhance load and their patterns match real model URLs', async () => {
    const { brands } = await loadDataset('data')
    const bySlug = Object.fromEntries(brands.map((b) => [b.slug, b]))
    const matches = (slug: string, url: string) => new RegExp(bySlug[slug].scraper.modelUrlPattern).test(url)

    expect(matches('phonak', MODEL_URL)).toBe(true)
    expect(matches('phonak', 'https://www.phonak.com/en-us/hearing-devices/hearing-aids/product-comparison')).toBe(false)
    const documents = new RegExp(bySlug.phonak.scraper.documentUrlPattern!)
    const dam = 'https://www.phonak.com/content/dam/celum/phonak/master-assets/en/documents/hearing-instruments'
    expect(documents.test(`${dam}/infinio/audeo-sphere/ph-datasheet-audeo-i-sphere-210x297-en.pdf.coredownload.pdf`)).toBe(true)
    expect(documents.test(`${dam}/infinio-us/PH_UserGuide_Audeo-I-Sphere_92x125_EN-US_029-1356-03.pdf`)).toBe(true)
    expect(documents.test(`${dam}/infinio/audeo-sphere/ph-user-guide-audeo-i-sphere-ultra-92x125-029-1356-02-en.pdf`)).toBe(true)
    expect(documents.test(`${dam}/infinio-us/ph-flyer-infinio-digital-take-along-8.5x11-en-us.pdf`)).toBe(false)
    expect(matches('jabra-enhance', 'https://www.jabraenhance.com/product/enhanceselectm3')).toBe(true)
    expect(matches('jabra-enhance', 'https://www.jabraenhance.com/accessories')).toBe(false)
  })
})
