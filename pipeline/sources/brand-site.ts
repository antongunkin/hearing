import { z } from 'zod'
import { literalCheck } from '@/pipeline/checks/literal'
import { rangeCheck } from '@/pipeline/checks/ranges'
import { config } from '@/pipeline/config'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { linksIn } from '@/pipeline/fetch/html'
import { llm } from '@/pipeline/llm'
import { canonicalUnit, findNumbers, parseMeasurement, toGrams, toMm, unitFollows } from '@/pipeline/units'
import { modelSlug, normalizeName, slugify } from '@/src/lib/data/slug'
import type { Brand } from '@/src/lib/schema/brand'
import type { Derivation, Sourced } from '@/src/lib/schema/field'
import { FormFactor, Model, ModelType, PowerType, type Variant } from '@/src/lib/schema/model'
import type { CheckResult } from '@/src/lib/schema/pending'

type Page = Extract<FetchResult, { status: 'ok' }>

export type ModelCandidate = { model: Model; fieldChecks: Record<string, CheckResult[]> }

/** One model page and the documents (datasheets, user guides) that name it. */
export type ModelSources = { modelUrl: string; documentUrls: string[] }

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
function linkDocuments(brand: Brand, modelUrls: string[], documentUrls: string[]): { sources: ModelSources[]; unmatched: number } {
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
  return { sources: models.map(({ modelUrl, documentUrls }) => ({ modelUrl, documentUrls })), unmatched }
}

/**
 * Model pages linked from the brand's catalog pages, each once, with the linked documents that match
 * `datasheetUrlPattern` given to the model page they name. A catalog page that is skipped (robots, bot
 * protection, …) is reported and gives no links; so is the number of documents that name no model page.
 */
export async function discoverModelUrls(brand: Brand, opts: { refresh?: boolean } = {}): Promise<ModelSources[]> {
  const { catalogUrls, modelUrlPattern, datasheetUrlPattern, render } = brand.scraper
  const isModel = new RegExp(modelUrlPattern)
  const isDatasheet = datasheetUrlPattern === undefined ? undefined : new RegExp(datasheetUrlPattern)
  const models = new Set<string>()
  const datasheets = new Set<string>()

  for (const url of catalogUrls) {
    // `refresh` skips the cached catalog, so that a re-run sees models listed since.
    const page = await fetchPage(url, { render, refresh: opts.refresh })
    if (page.status === 'skipped') {
      console.warn(`${brand.slug}: catalog ${url} skipped: ${page.reason}${page.detail ? ` (${page.detail})` : ''}`)
      continue
    }
    if (page.html === undefined) continue
    for (const link of linksIn(page.html, page.url)) {
      if (isModel.test(link)) models.add(link)
      else if (isDatasheet?.test(link)) datasheets.add(link)
    }
  }
  const { sources, unmatched } = linkDocuments(brand, [...models], [...datasheets])
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
  type: field(ModelType),
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
- name: the model's product name as the sources write it, without the brand name.
- type: "otc" if it is sold over the counter without a prescription, "rx" if it is fitted by a hearing care professional, "consumer" for earbuds with a hearing feature. Quote the text that shows it.
- releaseDate: "YYYY-MM-DD" or "YYYY-MM", only if a source says when the model was released or launched.
- variants: one per hearing aid style or model number (such as receiver-in-canal versus in-the-ear, or battery sizes). formFactor: RIC, BTE, ITE, ITC, CIC, IIC or earbud. techLevel: the performance level if named (such as "I90").
- weightG: the weight as written, with its unit as written. Grams: no derivation. Ounces: add "derivation": {"op": "oz-to-g", "input": "<the number and unit copied from the quote, such as 0.07 oz>"}. Weight of a pair: add {"op": "pair-to-unit", "input": "<the number and unit copied from the quote>"}.
- dimensionsMm: {"l", "w", "h"} with the unit as written. Millimetres: no derivation. Inches: add {"op": "in-to-mm", "input": "<the three numbers and the unit copied from the quote>"}.
- power: type is "rechargeable" or the battery size "10", "312", "13" or "675"; batteryHours is the hours per charge; chargingCase is whether a charging case is included.
- ipRating: such as "IP68". priceUsd: the listed price in US dollars, as a number.
- connectivity: mfi (Made for iPhone), asha (Audio Streaming for Hearing Aids on Android), leAudio (Bluetooth LE Audio), auracast (Auracast). Include only the flags the sources state.
- tinnitus: true if the model has a tinnitus feature such as a sound generator.
- platform: the chip or technology platform name. materials, colors: as the sources list them.`

/** Page text in one prompt (Ruling M: Ollama's context and Claude's budget). */
const PAGE_TEXT_BUDGET = 48_000
const SPEC_WORDS = /\b(?:technical data|specifications?|weight|dimensions?|battery|grams?|mm|hours|IP\d{2}|bluetooth)\b/gi

/** The part of the text that fits `max`, placed where spec words are densest. */
function excerpt(text: string, max: number): string {
  if (text.length <= max) return text
  const hits = [...text.matchAll(SPEC_WORDS)].map((match) => match.index)
  let best = { start: 0, count: 0 }
  for (const hit of hits) {
    const start = Math.min(Math.max(0, hit - 500), text.length - max)
    const count = hits.filter((other) => other >= start && other < start + max).length
    if (count > best.count) best = { start, count }
  }
  return text.slice(best.start, best.start + max)
}

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
    PAGE_TEXT_BUDGET,
  )
  // Datasheets and other documents first: they hold the spec tables.
  const order = pages.map((_, i) => i).sort((a, b) => Number(pages[a].html !== undefined) - Number(pages[b].html !== undefined))
  return order.map((i) => `[Source ${i}] ${pages[i].url}\n${excerpt(pages[i].text, limits[i])}`).join('\n\n')
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

  /** The field as stored, with checks recorded under `path`; undefined when it is empty or cites a page it was not given. */
  function cite<T>(path: string, field: Cited, value: T, converted?: Partial<Converted<T>>): Sourced<T> | undefined {
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
    fieldChecks[path] = [literalCheck(sourced, page.text), rangeCheck(path, sourced.value)]
    return sourced
  }
  const plain = <T>(path: string, field: (Cited & { value: T }) | undefined) =>
    field === undefined ? undefined : cite(path, field, field.value)
  const converted = <T>(path: string, field: Cited | undefined, value: Converted<T> | undefined) =>
    field === undefined || value === undefined ? undefined : cite(path, field, value.value, value)

  // The type is a reading of the text, like a boolean: only its quote can be looked up here, and the
  // cross-check reads the value again.
  if (cite('type', out.type, null) === undefined) {
    fieldChecks.type = [{ name: 'literal', ok: false, detail: `cites source ${out.type.sourceIndex}, which was not given` }]
  }

  const releaseDate = out.releaseDate && ISO_DATE.test(out.releaseDate.value) ? plain('releaseDate', out.releaseDate) : undefined
  // Kept in scope (see isInScope), but never applied without a person looking at it.
  if (releaseDate === undefined) fieldChecks.releaseDate = [{ name: 'range', ok: false, detail: 'no-release-date' }]

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
      power: plain(`${at}.power`, variant.power),
      ipRating: plain(`${at}.ipRating`, variant.ipRating),
      priceUsd: variant.priceUsd && cite(`${at}.priceUsd`, variant.priceUsd, variant.priceUsd.value, { unit: 'USD' }),
    }
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
    type: out.type.value,
    ...defined(fields),
    sameHardwareAs: [],
    variants,
  })
  return { model, fieldChecks }
}

/** A blank string, or a list or object with nothing but blanks in it. `null` (the type's quote check) is not empty. */
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

/** Matching key of a name: normalized, with a leading brand name taken off. */
function nameKey(brand: string, name: string): string {
  const prefix = normalizeName(brand.replaceAll('-', ' '))
  const key = normalizeName(name)
  return key.startsWith(`${prefix} `) ? key.slice(prefix.length + 1) : key
}

/** The stored model of the same brand whose name or an alias is the candidate's name, written differently. */
export function matchExistingModel(candidate: Model, models: Model[]): Model | null {
  const key = nameKey(candidate.brand, candidate.name)
  return (
    models.find(
      (model) =>
        model.brand === candidate.brand && [model.name, ...model.aliases].some((name) => nameKey(model.brand, name) === key),
    ) ?? null
  )
}

/**
 * Released on or after `config.releasedAfter`, compared at the precision of the date given ("2023-11"
 * counts). Without a date the model stays in: extractModel flags it with `no-release-date` for review.
 */
export function isInScope(m: Model): boolean {
  const date = m.releaseDate?.value
  if (date === undefined) return true
  return date >= config.releasedAfter.slice(0, date.length)
}
