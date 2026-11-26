// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { crossCheck, isRisky } from '@/pipeline/checks/crosscheck'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { llm, LlmUnavailableError } from '@/pipeline/llm'
import { discoverModelUrls, extractModel, isInScope, matchExistingModel } from '@/pipeline/sources/brand-site'
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
  scraper: {
    catalogUrls: ['https://www.phonak.com/en-us/hearing-devices/hearing-aids', 'https://www.phonak.com/en-us/support/datasheets'],
    modelUrlPattern: '^https://www\\.phonak\\.com/en-us/hearing-devices/hearing-aids/(?!product-comparison$)[a-z0-9-]+$',
    datasheetUrlPattern: '^https://www\\.phonak\\.com/content/dam/celum/phonak/.*(?:[Dd]atasheet|[Uu]ser-?[Gg]uide).*\\.pdf$',
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
  llmMock.mockResolvedValue(output)
  return extractModel(brand, await fixturePages())
}

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
      { modelUrl: MODEL_URL, documentUrls: [`${docs}/ph-datasheet-audeo-i-sphere.pdf`, `${docs}/PH_UserGuide_Audeo_I_Sphere.pdf`] },
      { modelUrl: 'https://www.phonak.com/en-us/hearing-devices/hearing-aids/virto-infinio', documentUrls: [] },
      {
        modelUrl: 'https://www.phonak.com/en-us/hearing-devices/hearing-aids/audeo-eon-sphere',
        documentUrls: [`${docs}/ph-datasheet-audeo-eon-sphere-210x297-en-v1.00.pdf`],
      },
      { modelUrl: 'https://www.phonak.com/en-us/hearing-devices/hearing-aids/audeo-infinio', documentUrls: [] },
    ])
    expect(fetchMock).toHaveBeenCalledWith(brand.scraper.catalogUrls[0], { render: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('robots'))
    // Dropped: "audeo-r" names only the family "audeo"; "Virto-P" is another generation than "virto-infinio";
    // the annex names no model. The brochure does not match the document pattern at all.
    expect(warn).toHaveBeenCalledWith('phonak: 3 documents match no model page')
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

  test('no release date: kept in scope and flagged as a failed check', async () => {
    const { model, fieldChecks } = await extractFixture((output) => delete output.releaseDate)

    expect(isInScope(model)).toBe(true)
    expect(fieldChecks.releaseDate).toEqual([{ name: 'range', ok: false, detail: 'no-release-date' }])
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

describe('isInScope', () => {
  const at = (value: string) =>
    ({ releaseDate: { value, sourceUrl: MODEL_URL, quote: value, fetchedAt: '2026-11-26T10:00:00.000Z', sourceType: 'official' } }) as Model

  test('compares the release date with config.releasedAfter at the precision given', () => {
    expect(isInScope(at('2024-08'))).toBe(true)
    expect(isInScope(at('2023-11'))).toBe(true)
    expect(isInScope(at('2023-11-01'))).toBe(true)
    expect(isInScope(at('2023-10-31'))).toBe(false)
    expect(isInScope(at('2022-08'))).toBe(false)
  })
})

describe('matchExistingModel', () => {
  const model = (brandSlug: string, name: string, aliases: string[] = []): Model => ({
    slug: `${brandSlug}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    brand: brandSlug,
    name,
    aliases,
    type: 'rx',
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

  test('RISKY_PATHS cover type, connectivity and the risky variant fields', () => {
    for (const path of ['type', 'connectivity', 'variants.0.weightG', 'variants.2.dimensionsMm', 'variants.0.ipRating', 'variants.1.power']) {
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
    const documents = new RegExp(bySlug.phonak.scraper.datasheetUrlPattern!)
    const dam = 'https://www.phonak.com/content/dam/celum/phonak/master-assets/en/documents/hearing-instruments'
    expect(documents.test(`${dam}/infinio/audeo-sphere/ph-datasheet-audeo-i-sphere-210x297-en.pdf.coredownload.pdf`)).toBe(true)
    expect(documents.test(`${dam}/infinio-us/PH_UserGuide_Audeo-I-Sphere_92x125_EN-US_029-1356-03.pdf`)).toBe(true)
    expect(documents.test(`${dam}/infinio/audeo-sphere/ph-user-guide-audeo-i-sphere-ultra-92x125-029-1356-02-en.pdf`)).toBe(true)
    expect(documents.test(`${dam}/infinio-us/ph-flyer-infinio-digital-take-along-8.5x11-en-us.pdf`)).toBe(false)
    expect(matches('jabra-enhance', 'https://www.jabraenhance.com/product/enhanceselectm3')).toBe(true)
    expect(matches('jabra-enhance', 'https://www.jabraenhance.com/accessories')).toBe(false)
  })
})
