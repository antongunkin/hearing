import { z } from 'zod'
import { literalCheck } from '@/pipeline/checks/literal'
import { priceBasisCheck } from '@/pipeline/checks/price-basis'
import { rangeCheck } from '@/pipeline/checks/ranges'
import { excerpt, PROMPT_TEXT_BUDGET } from '@/pipeline/excerpt'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { linksIn, pageHeading, pageTitle } from '@/pipeline/fetch/html'
import { llm } from '@/pipeline/llm'
import { canonicalUnit, findNumbers, parseMeasurement, toGrams, toMm, unitFollows } from '@/pipeline/units'
import { modelSlug, nameWithoutBrand, normalizeName, slugify } from '@/src/lib/data/slug'
import type { Brand } from '@/src/lib/schema/brand'
import type { Derivation, Sourced } from '@/src/lib/schema/field'
import { FormFactor, Model, ModelType, PowerType, type Variant } from '@/src/lib/schema/model'
import type { CheckResult } from '@/src/lib/schema/pending'

type Page = Extract<FetchResult, { status: 'ok' }>

export type ModelCandidate = { model: Model; fieldChecks: Record<string, CheckResult[]> }

/** One model page and the documents (datasheets, user guides) that name it. `inCatalog`: a catalog page links the model page (support pages alone do not count). */
export type ModelSources = { modelUrl: string; documentUrls: string[]; inCatalog: boolean }

/** File name words that say what kind of document it is, not which model. */
const DOCUMENT_WORDS = new Set(['ph', 'datasheet', 'user', 'guide', 'userguide', 'pdf', 'coredownload', 'inline', 'en', 'us'])
// Plain numbers (part numbers), page sizes such as 210x297 and versions such as v1. Single letters stay:
// on Phonak they name the generation ("Naida L" is Lumity, a "Naida P" datasheet is Paradise).
const NOT_A_NAME = /^(?:\d+|\d+x\d+|v\d+)$/

/** The model words in the last path segment of a URL. */
function nameTokens(url: string, brandWords: Set<string>): Set<string> {
  const segment = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? ''
  let name = segment
  try {
    name = decodeURIComponent(segment)
  } catch {
    // A malformed escape is read as written.
  }
  return new Set(
    normalizeName(name)
      .split(/[^a-z0-9]+/)
      .filter((word) => word !== '' && !NOT_A_NAME.test(word) && !DOCUMENT_WORDS.has(word) && !brandWords.has(word)),
  )
}

/**
 * Gives each document to the model page it names. A page qualifies when every word of its name is in
 * the document's file name, so a document never goes to a page whose generation or line it does not
 * name ("audeo" alone, or "virto nw" without "infinio", is not enough). Of the pages that qualify, the
 * one with the highest share of words in common wins (a document of "audeo eon sphere" goes to that
 * page, not to "audeo sphere"); a tie, or no page, drops the document, and dropped documents are counted.
 */
function linkDocuments(
  brand: Brand,
  modelUrls: string[],
  documentUrls: string[],
  inCatalog: Set<string>,
): { sources: ModelSources[]; unmatched: number } {
  const brandWords = new Set(normalizeName(`${brand.slug} ${brand.name}`).split(/[^a-z0-9]+/))
  const models = modelUrls.map((modelUrl) => ({ modelUrl, tokens: nameTokens(modelUrl, brandWords), documentUrls: [] as string[] }))

  let unmatched = 0
  for (const documentUrl of documentUrls) {
    const tokens = nameTokens(documentUrl, brandWords)
    const [best, second] = models
      .filter((model) => model.tokens.size > 0 && [...model.tokens].every((word) => tokens.has(word)))
      .map((model) => ({ model, score: model.tokens.size / new Set([...tokens, ...model.tokens]).size }))
      .sort((a, b) => b.score - a.score)
    if (best === undefined || second?.score === best.score) {
      unmatched++
      continue
    }
    best.model.documentUrls.push(documentUrl)
  }
  return { sources: models.map(({ modelUrl, documentUrls }) => ({ modelUrl, documentUrls, inCatalog: inCatalog.has(modelUrl) })), unmatched }
}

/** A line of the page's visible text to quote as the page: its first heading or title that the text holds, else its first line. */
function citableLine(page: Page): string | undefined {
  const squash = (text: string) => text.replace(/\s+/g, ' ').trim()
  const text = squash(page.text)
  const heading = page.html === undefined ? undefined : pageHeading(page.html)
  const candidates = [heading, page.html === undefined ? undefined : pageTitle(page.html)].map((c) => c && squash(c)).filter(Boolean) as string[]
  return candidates.find((c) => text.includes(c)) ?? page.text.split('\n').map(squash).find((line) => line !== '')?.slice(0, 200)
}

/**
 * Model pages linked from the brand's catalog and support pages, each once, with the linked documents that match
 * `documentUrlPattern` given to the model page they name. A catalog page that is skipped (robots, bot
 * protection, …) gives no links and is reported to `onSkip`, or logged without one; the number of
 * documents that name no model page is logged. A model page linked from a catalog page is `inCatalog`, also
 * when a support page links it too.
 */
export async function discoverModelUrls(
  brand: Brand,
  opts: {
    refresh?: boolean
    onSkip?: (url: string, reason: string, detail?: string) => void
    /** A catalog page that was read but gave no model link (no HTML, or a layout without them): the catalog is not whole. */
    onEmpty?: (url: string) => void
    /** A catalog page that was read: a line of its own text to cite, and when it was fetched. */
    onCatalog?: (url: string, page: { quote: string; fetchedAt: string }) => void
  } = {},
): Promise<ModelSources[]> {
  const { catalogUrls, supportUrls, modelUrlPattern, documentUrlPattern, render } = brand.scraper
  const isModel = new RegExp(modelUrlPattern)
  const isDatasheet = documentUrlPattern === undefined ? undefined : new RegExp(documentUrlPattern)
  const models = new Set<string>()
  const datasheets = new Set<string>()
  const inCatalog = new Set<string>()

  for (const url of [...catalogUrls, ...(supportUrls ?? [])]) {
    const fromCatalog = catalogUrls.includes(url)
    // `refresh` skips the cached catalog, so that a re-run sees models listed since.
    const page = await fetchPage(url, { render, refresh: opts.refresh })
    if (page.status === 'skipped') {
      if (opts.onSkip) opts.onSkip(url, page.reason, page.detail)
      else console.warn(`${brand.slug}: catalog ${url} skipped: ${page.reason}${page.detail ? ` (${page.detail})` : ''}`)
      continue
    }
    if (page.html === undefined) {
      if (fromCatalog) opts.onEmpty?.(url)
      continue
    }
    if (fromCatalog) {
      const quote = citableLine(page)
      if (quote !== undefined) opts.onCatalog?.(page.url, { quote, fetchedAt: page.fetchedAt })
    }
    let modelLinks = 0
    for (const link of linksIn(page.html, page.url)) {
      if (isModel.test(link)) {
        modelLinks++
        models.add(link)
        if (fromCatalog) inCatalog.add(link)
      } else if (isDatasheet?.test(link)) datasheets.add(link)
    }
    if (fromCatalog && modelLinks === 0) opts.onEmpty?.(url)
  }
  const { sources, unmatched } = linkDocuments(brand, [...models], [...datasheets], inCatalog)
  if (unmatched > 0) console.warn(`${brand.slug}: ${unmatched} documents match no model page`)
  return sources
}

// What the LLM returns. It never names a URL: the code cites the page by `sourceIndex`.
const cited = { quote: z.string().min(1), sourceIndex: z.number().int().min(0) }
const field = <T extends z.ZodType>(value: T) => z.strictObject({ value, ...cited })
// Measurements carry the unit as written, and a derivation when the code has to convert it.
const measured = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value,
    unit: z.string(),
    ...cited,
    derivation: z.strictObject({ op: z.enum(['oz-to-g', 'pair-to-unit', 'in-to-mm']), input: z.string().min(1) }).optional(),
  })

const ExtractedVariant = z.strictObject({
  name: z.string().min(1),
  techLevel: z.string().optional(),
  formFactor: FormFactor,
  weightG: measured(z.number()).optional(),
  dimensionsMm: measured(z.strictObject({ l: z.number(), w: z.number(), h: z.number() })).optional(),
  power: field(
    z.strictObject({ type: PowerType, batteryHours: z.number().optional(), chargingCase: z.boolean().optional() }),
  ).optional(),
  ipRating: field(z.string()).optional(),
  priceUsd: field(z.number()).optional(),
})

const Extraction = z.strictObject({
  name: z.string().min(1),
  type: field(ModelType).optional(),
  releaseDate: field(z.string()).optional(),
  platform: field(z.string()).optional(),
  materials: field(z.array(z.string())).optional(),
  colors: field(z.array(z.string())).optional(),
  connectivity: field(
    z.strictObject({
      mfi: z.boolean().optional(),
      asha: z.boolean().optional(),
      leAudio: z.boolean().optional(),
      auracast: z.boolean().optional(),
    }),
  ).optional(),
  tinnitus: field(z.boolean()).optional(),
  variants: z.array(ExtractedVariant),
})

/** Where a field's value is stated. */
type Cited = { quote: string; sourceIndex: number }
type Measured = NonNullable<z.infer<typeof ExtractedVariant>['weightG']>

const PROMPT = `You extract hearing aid specifications from official manufacturer sources. Describe the one model the sources below are about.

Rules:
- Use only the sources. Never use outside knowledge and never guess. Leave out every field the sources do not state; never output null or empty values.
- Every field has "quote": an exact, character-for-character copy of the source text that states the value (one line or sentence, at most about 300 characters), and "sourceIndex": the number N of the [Source N] the quote comes from.
- name: the model family's product name as the sources write it, without the brand name and without the style, receiver or battery suffix (such as "miniRITE R", "RIC R D", "BTE"): one family has one name across its pages, and its styles go into variants.
- type: "otc" if it is sold over the counter without a prescription, "rx" if it is fitted by a hearing care professional, "consumer" for earbuds with a hearing feature. Only if a source says so; quote the text that shows it.
- releaseDate: "YYYY-MM-DD" or "YYYY-MM", only if a source says when the model was released or launched.
- variants: one per hearing aid style or model number (such as receiver-in-canal versus in-the-ear, or battery sizes). formFactor: RIC, BTE, ITE, ITC, CIC, IIC or earbud. techLevel: the performance level if named (such as "I90").
- weightG: the weight as written, with its unit as written. Grams: no derivation. Ounces: add "derivation": {"op": "oz-to-g", "input": "<the number and unit copied from the quote, such as 0.07 oz>"}. Weight of a pair: add {"op": "pair-to-unit", "input": "<the number and unit copied from the quote>"}.
- dimensionsMm: {"l", "w", "h"} with the unit as written. Millimetres: no derivation. Inches: add {"op": "in-to-mm", "input": "<the three numbers and the unit copied from the quote>"}.
- power: type is "rechargeable" or the battery size "10", "312", "13" or "675"; batteryHours is the hours per charge; chargingCase is whether a charging case is included.
- ipRating: such as "IP68". priceUsd: the regular (non-sale) price in US dollars, as a number; leave it out if only a sale price is shown.
- connectivity: mfi (Made for iPhone), asha (Audio Streaming for Hearing Aids on Android), leAudio (Bluetooth LE Audio), auracast (Auracast). Include only the flags the sources state.
- tinnitus: true if the model has a tinnitus feature such as a sound generator.
- platform: the chip or technology platform name. materials, colors: as the sources list them.`

const SPEC_WORDS = /\b(?:technical data|specifications?|weight|dimensions?|battery|grams?|mm|hours|IP\d{2}|bluetooth)\b/gi

/** Splits the budget so that short pages are whole and long pages share what is left. */
function budgets(lengths: number[], total: number): number[] {
  const result = new Array<number>(lengths.length)
  let left = total
  const byLength = lengths.map((length, i) => ({ length, i })).sort((a, b) => a.length - b.length)
  byLength.forEach(({ length, i }, k) => {
    result[i] = Math.min(length, Math.floor(left / (byLength.length - k)))
    left -= result[i]
  })
  return result
}

function sourcesText(pages: Page[]): string {
  const limits = budgets(
    pages.map((page) => page.text.length),
    PROMPT_TEXT_BUDGET,
  )
  // Datasheets and other documents first: they hold the spec tables.
  const order = pages.map((_, i) => i).sort((a, b) => Number(pages[a].html !== undefined) - Number(pages[b].html !== undefined))
  return order.map((i) => `[Source ${i}] ${pages[i].url}\n${excerpt(pages[i].text, limits[i], SPEC_WORDS)}`).join('\n\n')
}

const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits

type Converted<T> = { value: T; unit: string; derivation?: Derivation }

/** Grams for one hearing aid, computed here from the quoted input; the LLM's own number is not used when derived. */
function grams(field: Measured): Converted<number> | undefined {
  const { derivation } = field
  if (derivation === undefined) return canonicalUnit(field.unit) === 'g' ? { value: field.value, unit: 'g' } : undefined
  const measurement = parseMeasurement(derivation.input)
  if (measurement === null || !['g', 'mg', 'oz'].includes(measurement.unit)) return undefined
  const total = toGrams(measurement.value, measurement.unit)
  if (derivation.op === 'oz-to-g' && measurement.unit === 'oz') return { value: round(total, 2), unit: 'g', derivation }
  if (derivation.op === 'pair-to-unit') return { value: round(total / 2, 2), unit: 'g', derivation }
  return undefined
}

type Dimensions = { l: number; w: number; h: number }

function millimetres(field: NonNullable<z.infer<typeof ExtractedVariant>['dimensionsMm']>): Converted<Dimensions> | undefined {
  const { derivation } = field
  if (derivation === undefined) return canonicalUnit(field.unit) === 'mm' ? { value: field.value, unit: 'mm' } : undefined
  if (derivation.op !== 'in-to-mm') return undefined
  const numbers = findNumbers(derivation.input)
  if (numbers.length !== 3 || !unitFollows(derivation.input, numbers[2].end, 'in')) return undefined
  const [l, w, h] = numbers.map((n) => round(toMm(n.value, 'in'), 1))
  return { value: { l, w, h }, unit: 'mm', derivation }
}

/**
 * Reads one model's specs from its official pages. Each field cites the page at its `sourceIndex`, and is
 * checked at once against that page's full text and the plausibility ranges.
 */
export async function extractModel(brand: Brand, pages: Page[]): Promise<ModelCandidate> {
  const prompt = `${PROMPT}\n\nBrand: ${brand.name}\n\nSources:\n\n${sourcesText(pages)}`
  const out = await llm({ prompt, schema: Extraction, provider: 'claude' })
  const fieldChecks: Record<string, CheckResult[]> = {}

  /**
   * The field as stored, with checks recorded under `path`; undefined when it is empty or cites a page it was
   * not given. `readings` are keys of the value that interpret the text (see literalCheck).
   */
  function cite<T>(
    path: string,
    field: Cited,
    value: T,
    converted?: Partial<Converted<T>>,
    readings?: readonly string[],
  ): Sourced<T> | undefined {
    const page = pages[field.sourceIndex]
    // An empty list or object would pass every check while saying nothing.
    if (page === undefined || isEmpty(value)) return undefined
    const sourced: Sourced<T> = {
      value,
      ...(converted?.unit !== undefined && { unit: converted.unit }),
      sourceUrl: page.url,
      quote: field.quote,
      fetchedAt: page.fetchedAt,
      sourceType: converted?.derivation ? 'derived' : 'official',
      ...(converted?.derivation && { derivation: converted.derivation }),
    }
    fieldChecks[path] = [literalCheck(sourced, page.text, { readings }), rangeCheck(path, sourced.value)]
    return sourced
  }
  const plain = <T>(path: string, field: (Cited & { value: T }) | undefined, readings?: readonly string[]) =>
    field === undefined ? undefined : cite(path, field, field.value, undefined, readings)
  const converted = <T>(path: string, field: Cited | undefined, value: Converted<T> | undefined) =>
    field === undefined || value === undefined ? undefined : cite(path, field, value.value, value)

  // The type is the brand's unless a page says otherwise; a page that does is flagged for the owner. A
  // stated type is a reading of the text, like a boolean: only its quote can be looked up.
  const type = out.type?.value ?? brand.defaultType
  fieldChecks.type = [{ name: 'brand-type', ok: true }]
  if (out.type !== undefined) {
    const { value, quote, sourceIndex } = out.type
    const page = pages[sourceIndex]
    const quoted: CheckResult = page
      ? literalCheck({ value: null, quote, sourceUrl: page.url, fetchedAt: page.fetchedAt, sourceType: 'official' }, page.text)
      : { name: 'literal', ok: false, detail: `cites source ${sourceIndex}, which was not given` }
    const agrees: CheckResult =
      value === brand.defaultType
        ? { name: 'brand-type', ok: true }
        : { name: 'brand-type', ok: false, detail: `the page says ${value} ("${quote}"); the brand default is ${brand.defaultType}` }
    fieldChecks.type = [quoted, agrees]
  }

  const releaseDate = out.releaseDate && ISO_DATE.test(out.releaseDate.value) ? plain('releaseDate', out.releaseDate) : undefined

  const ids = new Set<string>()
  const variants = out.variants.map((variant, i): Variant => {
    const base = slugify(variant.name) || 'variant'
    let id = base
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
    ids.add(id)

    const at = `variants.${i}`
    const fields = {
      weightG: converted(`${at}.weightG`, variant.weightG, variant.weightG && grams(variant.weightG)),
      dimensionsMm: converted(`${at}.dimensionsMm`, variant.dimensionsMm, variant.dimensionsMm && millimetres(variant.dimensionsMm)),
      // The battery type is a reading ("rechargeable" from "up to 24 hours per charge"), left to the cross-check.
      power: plain(`${at}.power`, variant.power, ['type']),
      ipRating: plain(`${at}.ipRating`, variant.ipRating),
      priceUsd: variant.priceUsd && cite(`${at}.priceUsd`, variant.priceUsd, variant.priceUsd.value, { unit: 'USD' }),
    }
    if (fields.priceUsd) fieldChecks[`${at}.priceUsd`].push(priceBasisCheck(fields.priceUsd.quote))
    return {
      id,
      ...(variant.techLevel !== undefined && { techLevel: variant.techLevel }),
      formFactor: variant.formFactor,
      ...defined(fields),
    }
  })

  const fields = {
    releaseDate,
    platform: plain('platform', out.platform),
    materials: plain('materials', out.materials),
    colors: plain('colors', out.colors),
    connectivity: plain('connectivity', out.connectivity),
    tinnitus: plain('tinnitus', out.tinnitus),
  }
  const model = Model.parse({
    slug: modelSlug(brand.slug, out.name),
    brand: brand.slug,
    name: out.name,
    aliases: [],
    type,
    ...defined(fields),
    sameHardwareAs: [],
    variants,
  })
  return { model, fieldChecks }
}

/** A blank string, or a list or object with nothing but blanks in it. */
function isEmpty(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.every(isEmpty)
  if (typeof value === 'object' && value !== null) return Object.values(value).every((child) => child === undefined || isEmpty(child))
  return false
}

/** The entries that have a value: a field without a source is absent, not null. */
function defined<T extends Record<string, unknown>>(fields: T): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: NonNullable<T[K]>
  }
}

/** Model-wide fields a page may state; the rest (slug, names, twins) is the same on every page of a family. */
const FAMILY_FIELDS = ['type', 'releaseDate', 'platform', 'materials', 'colors', 'connectivity', 'tinnitus'] as const

const allPass = (checks: CheckResult[] | undefined) => checks !== undefined && checks.every((check) => check.ok)

/** One candidate for the pages of one family (see mergeCandidates). */
function mergeFamily(pages: ModelCandidate[]): ModelCandidate {
  if (pages.length === 1) return pages[0]
  const fieldChecks: Record<string, CheckResult[]> = {}
  const model: Record<string, unknown> = { ...pages[0].model }
  for (const key of FAMILY_FIELDS) {
    const has = (page: ModelCandidate) => page.model[key] !== undefined
    // The first page whose reading passes its checks; else the first that has the field; else the checks
    // of a field none has (such as `no-release-date`).
    const from =
      pages.find((page) => has(page) && allPass(page.fieldChecks[key])) ??
      pages.find(has) ??
      pages.find((page) => page.fieldChecks[key] !== undefined)
    delete model[key]
    if (from === undefined) continue
    if (has(from)) model[key] = from.model[key]
    if (from.fieldChecks[key] !== undefined) fieldChecks[key] = from.fieldChecks[key]
  }

  const variants: Variant[] = []
  for (const page of pages) {
    page.model.variants.forEach((variant, i) => {
      if (variants.some((kept) => kept.id === variant.id)) return
      const [from, to] = [`variants.${i}`, `variants.${variants.length}`]
      for (const [path, checks] of Object.entries(page.fieldChecks)) {
        if (path.startsWith(`${from}.`)) fieldChecks[to + path.slice(from.length)] = checks
      }
      variants.push(variant)
    })
  }
  return { model: Model.parse({ ...model, variants }), fieldChecks }
}

/**
 * One candidate per model slug, in the order first seen. A family's styles often have a page each: their
 * variants are united by id (the first page's variant wins), each with its checks under its new index, and
 * a model-wide field is taken from the first page whose reading of it passes its checks.
 */
export function mergeCandidates(candidates: ModelCandidate[]): ModelCandidate[] {
  const bySlug = new Map<string, ModelCandidate[]>()
  for (const candidate of candidates) bySlug.set(candidate.model.slug, [...(bySlug.get(candidate.model.slug) ?? []), candidate])
  return [...bySlug.values()].map(mergeFamily)
}

/** The stored model of the same brand whose name or an alias is the candidate's name, written differently. */
export function matchExistingModel(candidate: Model, models: Model[]): Model | null {
  const key = nameWithoutBrand(candidate.brand, candidate.name)
  return (
    models.find(
      (model) =>
        model.brand === candidate.brand && [model.name, ...model.aliases].some((name) => nameWithoutBrand(model.brand, name) === key),
    ) ?? null
  )
}
