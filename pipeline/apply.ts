// What happens to a candidate change: dropped, applied at once (with its feed events), or queued for review.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { crossCheck, isRisky } from '@/pipeline/checks/crosscheck'
import { config } from '@/pipeline/config'
import { isDuplicateEvent } from '@/pipeline/checks/dedupe'
import { forbiddenCheck } from '@/pipeline/checks/forbidden'
import { graphFiles, upsertEdge, upsertEntity } from '@/pipeline/atlas/graph-store'
import { llm, LlmLimitError } from '@/pipeline/llm'
import type { ModelCandidate } from '@/pipeline/sources/brand-site'
import { readJson, type Dataset } from '@/src/lib/data/load'
import { slugify } from '@/src/lib/data/slug'
import { sortKeys, writeJson } from '@/src/lib/data/write'
import { parseArchiveUrl } from '@/src/lib/archive-url'
import { Brand, BrandHistory } from '@/src/lib/schema/brand'
import { Event } from '@/src/lib/schema/event'
import type { Sourced } from '@/src/lib/schema/field'
import { Edge, Entity, Graph } from '@/src/lib/schema/graph'
import { Lineage, Model } from '@/src/lib/schema/model'
import { PendingChange, type CandidateChange, type CheckResult } from '@/src/lib/schema/pending'
import { Reviews } from '@/src/lib/schema/reviews'

type Json = Record<string, unknown>

const isSourced = (node: unknown): node is Sourced<unknown> =>
  typeof node === 'object' && node !== null && !Array.isArray(node) && 'sourceType' in node && 'value' in node && 'quote' in node

/** The sourced values inside `node` by field path, not looking inside a sourced value. */
export function sourcedLeaves(node: unknown, path = ''): [string, Sourced<unknown>][] {
  if (isSourced(node)) return [[path, node]]
  if (typeof node !== 'object' || node === null) return []
  return Object.entries(node).flatMap(([key, child]) => sourcedLeaves(child, path === '' ? key : `${path}.${key}`))
}

/** JSON with object keys sorted, so equal values always give the same text. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, sortKeys)
}

/** A sourced value as its value and unit only: the same value cited from another page or quote is the same. */
const withoutCitations = (node: unknown): unknown => {
  if (isSourced(node)) return { value: node.value, unit: node.unit }
  if (typeof node !== 'object' || node === null) return node
  if (Array.isArray(node)) return node.map(withoutCitations)
  return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, withoutCitations(child)]))
}

/** What a value says, as text: no citations and no fetch dates, so a value read again later is the same. */
const substance = (value: unknown): string =>
  stableStringify(JSON.parse(stableStringify(withoutCitations(value ?? null)), (key, node) => (key === 'fetchedAt' ? undefined : node)))

export const sameValue = (a: unknown, b: unknown) => substance(a) === substance(b)

/**
 * Identifies a change across runs, so that a rejected one is not proposed again: by what it says, not
 * where it was read (a sourced value counts by value and unit only). A new model counts by its slug, so a
 * rejected model stays rejected whatever its page says next time.
 */
export function fingerprint(c: { kind: CandidateChange['kind']; modelSlug: string | null; path: string; after: unknown }): string {
  const what = c.kind === 'new-model' ? 'new-model' : substance(c.after)
  return createHash('sha256').update(`${c.modelSlug}|${c.path}|${what}`).digest('hex')
}

/** The kind of a change to one sourced value: an official price is a `price`, anything else a `spec-change`. */
export const sourcedKind = (path: string, after: unknown): 'price' | 'spec-change' =>
  isSourced(after) && after.sourceType === 'official' && path.endsWith('.priceUsd') ? 'price' : 'spec-change'

/** A failed check for an official price that moves by more than `config.maxAutoPriceChange`; null otherwise. */
function priceJump(before: unknown, after: unknown): CheckResult | null {
  if (typeof before !== 'number' || typeof after !== 'number' || before <= 0) return null
  const change = (after - before) / before
  if (Math.abs(change) <= config.maxAutoPriceChange) return null
  const percent = `${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}%`
  const limit = `${config.maxAutoPriceChange * 100}%`
  return { name: 'range', ok: false, detail: `price changes by ${percent} (from ${before} to ${after}): more than ±${limit} is reviewed` }
}

/** Lists whose entries are proposed whole, as `<list>.<index>`, and the field that tells their entries apart. */
const ENTRY_KEYS = { variants: 'id', sameHardwareAs: 'slug', documents: 'url' } as const

/** What a change to a whole list entry is about; null for any other path. */
export function entryChange({ path, before, after }: { path: string; before?: unknown; after: unknown }) {
  const list = /^(variants|sameHardwareAs|documents)\.\d+$/.exec(path)?.[1] as keyof typeof ENTRY_KEYS | undefined
  if (list === undefined) return null
  const key: string = ENTRY_KEYS[list]
  const name = ((after ?? before) as Json)[key]
  /** Where the entry stands in the model now, whatever index it was proposed at; -1 when it is not there. */
  const indexIn = (model: Model) => {
    const entries = model[list] as unknown as Json[]
    const at = entries.findIndex((entry) => entry[key] === name)
    // A replacement has a new key (a dead document link becomes its archive copy): it takes the place of the entry it replaces.
    const replaced = before === undefined ? undefined : (before as Json)[key]
    return at !== -1 || replaced === undefined ? at : entries.findIndex((entry) => entry[key] === replaced)
  }
  return { list, name, indexIn }
}

/**
 * The changes from the stored model to a freshly extracted one. A new model is one `new-model` change
 * (path `''`). Otherwise there is one change per sourced value whose value differs (an official price is
 * a `price`, which fails a check when it moves too far: see `priceJump`; anything else a `spec-change`),
 * and a `spec-change` for a new `type`, `formFactor` or
 * `techLevel`. Variants are matched by id: a new variant is one change appended to the list, and a stored
 * variant the candidate no longer lists is one change with `after: null` (removal, by a person only).
 * Hardware twins are matched by slug and proposed the same way, a changed twin as its whole new entry.
 * Documents are matched by URL (an archive copy by the URL it was taken from): each one the stored model
 * lacks is proposed as a `document` at the next index, with its checks; none is ever removed.
 * A value the candidate lacks is kept: the source may have left it out this time. So a candidate that
 * names no twins at all (a brand page never does) removes none.
 */
export function diffModel(existing: Model | null, cand: ModelCandidate): CandidateChange[] {
  if (existing === null) {
    return [{ kind: 'new-model', modelSlug: cand.model.slug, path: '', after: cand.model, checks: cand.fieldChecks }]
  }
  const changes: CandidateChange[] = []
  const push = (kind: CandidateChange['kind'], path: string, before: unknown, after: unknown, checks: Record<string, CheckResult[]>) =>
    changes.push({ kind, modelSlug: existing.slug, path, ...(before !== undefined && { before }), after, checks })

  const stored = new Map(sourcedLeaves(existing))
  /** A sourced value, when its value differs from the stored one. */
  const proposeSourced = (path: string, after: Sourced<unknown>, checks: Record<string, CheckResult[]>) => {
    const before = stored.get(path)
    if (before !== undefined && sameValue(before.value, after.value)) return
    const kind = sourcedKind(path, after)
    const jump = kind === 'price' && before !== undefined && priceJump(before.value, after.value)
    push(kind, path, before, after, jump ? { ...checks, [path]: [...checks[path], jump] } : checks)
  }
  /** A plain field the candidate states, when it differs from the stored one. */
  const proposePlain = (path: string, before: unknown, after: unknown) => {
    if (after !== undefined && !sameValue(before, after)) push('spec-change', path, before, after, { [path]: cand.fieldChecks[path] ?? [] })
  }

  /** The candidate's checks of a list entry, under the path the entry will be stored at. */
  const entryChecks = (from: string, to: string) =>
    Object.fromEntries(
      Object.entries(cand.fieldChecks)
        .filter(([path]) => path === from || path.startsWith(`${from}.`))
        .map(([path, results]) => [to + path.slice(from.length), results]),
    )
  const removed = (path: string, before: unknown) => push('spec-change', path, before, null, { [path]: [] })

  const { variants, sameHardwareAs, documents, ...fields } = cand.model
  proposePlain('type', existing.type, cand.model.type)
  for (const [path, after] of sourcedLeaves(fields)) proposeSourced(path, after, { [path]: cand.fieldChecks[path] ?? [] })

  let twins = existing.sameHardwareAs.length
  sameHardwareAs.forEach((twin, i) => {
    const j = existing.sameHardwareAs.findIndex((t) => t.slug === twin.slug)
    const before = existing.sameHardwareAs[j]
    if (before !== undefined && sameValue(before, twin)) return
    const target = `sameHardwareAs.${j === -1 ? twins++ : j}`
    push('spec-change', target, before, twin, entryChecks(`sameHardwareAs.${i}`, target))
  })
  if (sameHardwareAs.length > 0) {
    existing.sameHardwareAs.forEach((twin, j) => {
      if (!sameHardwareAs.some((t) => t.slug === twin.slug)) removed(`sameHardwareAs.${j}`, twin)
    })
  }

  /** A document by the page it is a copy of: the live URL and an archive copy of it are one document. */
  const original = (url: string) => parseArchiveUrl(url)?.original ?? url
  let nextDocument = existing.documents.length
  // A model read from a stored proposal may predate the field.
  ;(documents ?? []).forEach((document, i) => {
    if (existing.documents.some((d) => d.url === document.url || original(d.url) === original(document.url))) return
    const target = `documents.${nextDocument++}`
    push('document', target, undefined, document, entryChecks(`documents.${i}`, target))
  })

  let appended = existing.variants.length
  variants.forEach((variant, i) => {
    const j = existing.variants.findIndex((v) => v.id === variant.id)
    const target = `variants.${j === -1 ? appended++ : j}`
    if (j === -1) {
      push('spec-change', target, undefined, variant, entryChecks(`variants.${i}`, target))
      return
    }
    proposePlain(`${target}.formFactor`, existing.variants[j].formFactor, variant.formFactor)
    proposePlain(`${target}.techLevel`, existing.variants[j].techLevel, variant.techLevel)
    for (const [path, after] of sourcedLeaves(variant)) {
      proposeSourced(`${target}.${path}`, after, { [`${target}.${path}`]: cand.fieldChecks[`variants.${i}.${path}`] ?? [] })
    }
  })

  existing.variants.forEach((variant, j) => {
    if (!variants.some((v) => v.id === variant.id)) removed(`variants.${j}`, variant)
  })
  return changes
}

/** The sourced values of the change, by their full field path. */
const changedLeaves = (c: CandidateChange) => sourcedLeaves(c.after, c.path)

/**
 * Adds a second model's reading to every risky sourced value the change carries. A risky field stored
 * without a quote (the model type) has nothing to read again and is left to its extraction checks.
 */
export async function withCrossChecks(c: CandidateChange): Promise<CandidateChange> {
  const checks = { ...c.checks }
  for (const [path, field] of changedLeaves(c)) {
    if (!isRisky(path)) continue
    checks[path] = [...(checks[path] ?? []), await crossCheck(path, field.quote, field.value)]
  }
  return { ...c, checks }
}

const AUTO_KINDS = new Set<CandidateChange['kind']>(['price', 'app-version', 'fda-event', 'review-stats', 'complaint-themes', 'document'])

const passes = (c: CandidateChange) => Object.values(c.checks).every((checks) => checks.every((check) => check.ok))

const hasThirdParty = (c: CandidateChange) => changedLeaves(c).some(([, field]) => field.sourceType === 'third-party')

/** The checks a new document must pass to apply itself: its URL pattern, a readable PDF, the model name in its text. */
export const DOCUMENT_CHECKS = 3

/** Drop what was rejected or changes nothing; apply small checked changes; queue the rest. Third-party values are always reviewed. */
export function route(c: CandidateChange, rejections: string[]): 'auto' | 'pending' | 'drop' {
  if (rejections.includes(fingerprint(c)) || sameValue(c.after, c.before)) return 'drop'
  // A document is verified only when every one of its checks ran: no checks at all is not a pass.
  const checked = c.kind !== 'document' || (c.checks[c.path] ?? []).filter((check) => check.ok).length >= DOCUMENT_CHECKS
  return AUTO_KINDS.has(c.kind) && checked && passes(c) && !hasThirdParty(c) ? 'auto' : 'pending'
}

/**
 * How the review page shows a queued change. A new model, a brand config and a relation keep their kind
 * with failed checks marked on the card; any other change with a failed check is a `failed-check`.
 */
function pendingKind(c: CandidateChange): PendingChange['kind'] {
  if (c.kind === 'new-model' || c.kind === 'brand-config' || c.kind === 'relation' || c.kind === 'brand-history') return c.kind
  // A discontinuation, or a document that failed a check, is shown as a spec change, or as a failed check
  // (an orphan product page carries a failed `lifecycle` check).
  if (!passes(c)) return 'failed-check'
  return c.kind === 'pros-cons' ? 'pros-cons' : 'spec-change'
}

/**
 * Writes the change to `data/pending/`, one file per model and path: a newer proposal replaces an older one.
 * Returns the pending id.
 */
export async function enqueue(c: CandidateChange, dir = 'data'): Promise<string> {
  const id = [c.modelSlug ?? 'industry', slugify(c.path) || 'model'].join('-')
  const pending = PendingChange.parse({ ...c, id, kind: pendingKind(c), createdAt: new Date().toISOString() })
  await writeJson(join(dir, 'pending', `${id}.json`), pending)
  return id
}

const EventSentence = z.strictObject({ text: z.string().min(1) })

export type NewEvent = Omit<Event, 'id' | 'text'>

function templateText(event: NewEvent, product: string | null, facts: Json): string {
  const subject = product ?? 'A hearing aid'
  switch (event.type) {
    case 'new-model':
      return `${subject} was added to the database.`
    case 'price-change': {
      const variant = facts.variant ? ` (${facts.variant})` : ''
      return `${subject}${variant} price changed from $${facts.before} to $${facts.after}.`
    }
    case 'fda-clearance':
      return `FDA cleared ${subject} (${event.key}).`
    case 'fda-recall':
      return `FDA posted a recall for ${subject} (${event.key}).`
    case 'app-update':
      return `${facts.app ?? `The app for ${subject}`} for iOS was updated to version ${facts.version}.`
    case 'model-discontinued':
      return `${subject} is no longer listed by its maker.`
  }
}

/**
 * One neutral sentence for the event feed, written by Claude from the facts given. A sentence that
 * fails the forbidden-phrase check, or no usable answer, gives a fixed template instead; only a usage
 * limit stops it. A recall, the most sensitive claim, always gets the template. `product` is the display
 * name, such as "Jabra Enhance Select 500".
 */
export async function eventText(event: NewEvent, product: string | null, facts: Json = {}): Promise<string> {
  if (event.type === 'fda-recall') return templateText(event, product, facts)
  const prompt = `Write one short, neutral sentence (at most 30 words) for the news feed of a hearing aid database about the event below.
Use only the facts given; add nothing. Third person, no opinions, no advice. Never write as if anyone tried the product (no "tested", "hands-on", "we wore", "in our testing", "our audiologist").

${JSON.stringify({ type: event.type, product, date: event.date, key: event.key, ...facts })}`
  try {
    const { text } = await llm({ prompt, schema: EventSentence, provider: 'claude' })
    if (forbiddenCheck(text).ok) return text.trim()
  } catch (error) {
    if (error instanceof LlmLimitError) throw error
  }
  return templateText(event, product, facts)
}

const today = () => new Date().toISOString().slice(0, 10)

/** Sets `value` at a dot path such as `variants.0.priceUsd`, creating objects on the way. */
function setPath(target: Json, path: string, value: unknown): void {
  const keys = path.split('.')
  let node: Json = target
  for (const key of keys.slice(0, -1)) node = (node[key] ??= {}) as Json
  node[keys.at(-1)!] = value
}

const REVIEWS_PREFIX = 'reviews.'

/** What an event is still missing: what `eventText` needs to word it. `product` is the display name. */
export type EventContext = { product: string | null; facts: Json }

/** A file under the data directory, and its new content. */
export type Write = { path: string; value: unknown }

export type ChangePlan = { writes: Write[]; events: ({ event: NewEvent } & EventContext)[] }

export type Change = Pick<CandidateChange, 'kind' | 'modelSlug' | 'path' | 'before' | 'after' | 'origin'>

/**
 * The model with the change made. A whole list entry (see `entryChange`) is added at the end, replaced or
 * removed by its id or slug, wherever it stands now.
 */
function changedModel(model: Model, change: Change): Model {
  const { path, before, after } = change
  const updated = structuredClone(model)
  const entry = entryChange(change)
  if (entry === null) {
    // Back on sale: the key goes, it is not stored as null.
    if (after === null && !path.includes('.')) delete (updated as Json)[path]
    else setPath(updated as Json, path, after)
  } else {
    const list = updated[entry.list] as unknown[]
    const index = entry.indexIn(updated)
    if (after === null) {
      if (index !== -1) list.splice(index, 1)
    } else if (index === -1) {
      list.push(after)
    } else if (!sameValue(list[index], after)) {
      if (before === undefined) throw new Error(`${entry.list} entry ${entry.name} of ${model.slug} already exists`)
      list[index] = after
    }
  }
  return Model.parse(updated)
}

/**
 * What applying a change to the dataset writes, and the feed events it gives: `new-model`; `price-change`
 * and `app-update` when a known value changes (not when it is first learned); `fda-clearance`/`fda-recall`
 * for an FDA event. An `app-update` belongs to the app (no model, key `<iosId>:<version>`), so models that
 * share an app give one. Pure: nothing is read or written.
 */
export function planChange(c: Change, dataset: Dataset): ChangePlan {
  const model = dataset.models.find((m) => m.slug === c.modelSlug) ?? null
  const brandName = (slug: string) => dataset.brands.find((b) => b.slug === slug)?.name ?? slug
  const productOf = (m: Model) => `${brandName(m.brand)} ${m.name}`
  const modelWrite = (value: Model): Write => ({ path: `models/${value.slug}.json`, value })

  switch (c.kind) {
    case 'fda-event': {
      const event = c.after as NewEvent
      const subject = dataset.models.find((m) => m.slug === event.modelSlug)
      return { writes: [], events: [{ event, product: subject ? productOf(subject) : null, facts: {} }] }
    }

    case 'new-model': {
      const added = Model.parse(c.after)
      // An archive import is history, not news.
      if (c.origin === 'archive') return { writes: [modelWrite(added)], events: [] }
      const sources = [...new Set(sourcedLeaves(added).map(([, field]) => field.sourceUrl))]
      const event: NewEvent = { type: 'new-model', modelSlug: added.slug, date: today(), key: added.slug, sources }
      return { writes: [modelWrite(added)], events: [{ event, product: productOf(added), facts: {} }] }
    }

    case 'brand-config': {
      const brand = Brand.parse(c.after)
      return { writes: [{ path: `brands/${brand.slug}.json`, value: brand }], events: [] }
    }

    case 'relation': {
      const { edge, entities } = z.strictObject({ edge: z.unknown(), entities: z.array(Entity) }).parse(c.after)
      // Approving is what makes an edge public: it must stand on a quoted primary source by itself.
      const approved = Edge.parse({ ...(edge as Json), visibility: 'public', status: 'verified' })
      const graph = Graph.parse(entities.reduce(upsertEntity, dataset.graph))
      const writes = graphFiles(upsertEdge(graph, approved))
      return { writes, events: [] }
    }

    case 'brand-history': {
      const slug = /^brands\/([^/]+)\.history$/.exec(c.path)?.[1]
      const stored = dataset.brands.find((b) => b.slug === slug)
      if (stored === undefined) throw new Error(`brand-history for unknown brand ${c.path}`)
      const brand = Brand.parse({ ...stored, history: BrandHistory.parse(c.after) })
      return { writes: [{ path: `brands/${brand.slug}.json`, value: brand }], events: [] }
    }

    case 'discontinued': {
      if (model === null) throw new Error(`discontinued for unknown model ${c.modelSlug}`)
      const writes = [modelWrite(changedModel(model, c))]
      const after = c.after as Model['discontinued'] | null
      // Back on sale, a change of an earlier finding and an archive import are no news.
      if (!after || c.before !== undefined || c.origin === 'archive') return { writes, events: [] }
      const event: NewEvent = { type: 'model-discontinued', modelSlug: model.slug, date: today(), key: model.slug, sources: [after.source.sourceUrl] }
      return { writes, events: [{ event, product: productOf(model), facts: {} }] }
    }

    case 'document': {
      if (model === null) throw new Error(`document for unknown model ${c.modelSlug}`)
      return { writes: [modelWrite(changedModel(model, c))], events: [] }
    }

    case 'price':
    case 'app-version':
    case 'spec-change': {
      if (model === null) throw new Error(`${c.kind} for unknown model ${c.modelSlug}`)
      if ((c.path === 'predecessor' || c.path === 'successor') && c.after !== null) {
        // Both sides state it: the other model names this one the other way round, with the same source.
        const lineage = Lineage.parse(c.after)
        const other = dataset.models.find((m) => m.slug === lineage.slug)
        if (other === undefined) throw new Error(`${c.path} ${lineage.slug} of ${model.slug} is not a stored model`)
        if (lineage.slug === model.slug) throw new Error(`${model.slug} cannot be its own ${c.path}`)
        const reverse = c.path === 'predecessor' ? 'successor' : 'predecessor'
        const held = other[reverse]
        if (held !== undefined && held.slug !== model.slug) {
          throw new Error(`${other.slug} already has ${held.slug} as its ${reverse}: cannot also be ${model.slug}`)
        }
        const linked = Model.parse({ ...structuredClone(other), [reverse]: { slug: model.slug, source: lineage.source } })
        return { writes: [modelWrite(changedModel(model, c)), modelWrite(linked)], events: [] }
      }
      const writes = [modelWrite(changedModel(model, c))]
      const before = c.before as Sourced<unknown> | undefined
      if (c.kind === 'spec-change' || before === undefined) return { writes, events: [] }
      const after = c.after as Sourced<unknown>
      const base = { modelSlug: model.slug, date: today(), sources: [after.sourceUrl] }
      if (c.kind === 'price') {
        const event: NewEvent = { ...base, type: 'price-change', key: `${c.path}:${stableStringify(after.value)}` }
        const facts = { variant: model.variants[Number(c.path.split('.')[1])]?.id, before: before.value, after: after.value }
        return { writes, events: [{ event, product: productOf(model), facts }] }
      }
      // One event per app release, not per model: brand apps serve every model of the brand.
      const key = `${model.app?.iosId ?? model.slug}:${after.value}`
      const event: NewEvent = { ...base, modelSlug: null, type: 'app-update', key }
      return { writes, events: [{ event, product: brandName(model.brand), facts: { app: model.app?.name, version: after.value } }] }
    }

    case 'review-stats':
    case 'complaint-themes':
    case 'pros-cons': {
      if (c.modelSlug === null || !c.path.startsWith(REVIEWS_PREFIX)) throw new Error(`bad ${c.kind} change at ${c.path}`)
      const updated = structuredClone(
        dataset.reviews.find((r) => r.slug === c.modelSlug) ??
          { slug: c.modelSlug, customer: [], complaintThemes: [], prosCons: null, videos: [] },
      ) as Json
      setPath(updated, c.path.slice(REVIEWS_PREFIX.length), c.after)
      const parsed = Reviews.parse(updated)
      return { writes: [{ path: `reviews/${parsed.slug}.json`, value: parsed }], events: [] }
    }
  }
}

/**
 * Writes the event to `data/events/` with its id and sentence, and adds it to `dataset`. A duplicate is
 * not written again (and costs no LLM call). Returns what it wrote.
 */
export async function writeEvent(
  { event, product, facts }: ChangePlan['events'][number],
  dataset: Dataset,
  dir = 'data',
): Promise<Event[]> {
  if (isDuplicateEvent({ ...event, id: 'new', text: '' }, dataset.events)) return []
  const id = slugify(`${event.date.slice(0, 10)} ${event.type} ${event.modelSlug ?? ''} ${event.key}`)
  const written = Event.parse({ ...event, id, text: await eventText(event, product, facts) })
  await writeJson(join(dir, 'events', `${id}.json`), written)
  dataset.events.push(written)
  return [written]
}

/** Puts `record` in place of the one with its slug, or adds it. */
function upsert<T extends { slug: string }>(records: T[], record: T): void {
  const index = records.findIndex((r) => r.slug === record.slug)
  if (index === -1) records.push(record)
  else records[index] = record
}

/**
 * Puts the model or reviews file the change writes into `dataset` as it is on disk now: the owner may have
 * approved a change to it in /review since the run loaded the data.
 */
async function reloadRecord(c: CandidateChange, dataset: Dataset, dir: string): Promise<void> {
  if (c.modelSlug === null || c.kind === 'fda-event') return
  const reviews = c.path.startsWith(REVIEWS_PREFIX)
  // The review page imports this file: without the comment, the build traces the whole project for this path.
  const file = join(/*turbopackIgnore: true*/ dir, reviews ? 'reviews' : 'models', `${c.modelSlug}.json`)
  try {
    if (reviews) upsert(dataset.reviews, await readJson(file, Reviews))
    else upsert(dataset.models, await readJson(file, Model))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/**
 * Applies a change that `route` sent to `auto`: writes the model, reviews or event file and keeps
 * `dataset` in step. Returns the feed events it wrote (see `planChange`). Events are written before the
 * data, and a duplicate is not written again, so a run stopped in between is safe to repeat.
 */
export async function applyAuto(c: CandidateChange, dataset: Dataset, dir = 'data'): Promise<Event[]> {
  if (!AUTO_KINDS.has(c.kind)) throw new Error(`a ${c.kind} change is never applied automatically`)
  await reloadRecord(c, dataset, dir)
  const { writes, events } = planChange(c, dataset)
  const written: Event[] = []
  for (const event of events) written.push(...(await writeEvent(event, dataset, dir)))
  for (const { path, value } of writes) {
    // The review page imports this file: without the comment, the build traces the whole project for this path.
    await writeJson(join(/*turbopackIgnore: true*/ dir, path), value)
    if (path.startsWith('models/')) upsert(dataset.models, value as Model)
    else upsert(dataset.reviews, value as Reviews)
  }
  return written
}
