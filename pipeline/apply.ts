// What happens to a candidate change: dropped, applied at once (with its feed events), or queued for review.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { crossCheck, isRisky } from '@/pipeline/checks/crosscheck'
import { isDuplicateEvent } from '@/pipeline/checks/dedupe'
import { forbiddenCheck } from '@/pipeline/checks/forbidden'
import { llm, LlmLimitError } from '@/pipeline/llm'
import type { ModelCandidate } from '@/pipeline/sources/brand-site'
import type { Dataset } from '@/src/lib/data/load'
import { slugify } from '@/src/lib/data/slug'
import { writeJson } from '@/src/lib/data/write'
import { Event } from '@/src/lib/schema/event'
import type { Sourced } from '@/src/lib/schema/field'
import { Model } from '@/src/lib/schema/model'
import { PendingChange, type CandidateChange, type CheckResult } from '@/src/lib/schema/pending'
import { Reviews } from '@/src/lib/schema/reviews'

type Json = Record<string, unknown>

const isSourced = (node: unknown): node is Sourced<unknown> =>
  typeof node === 'object' && node !== null && !Array.isArray(node) && 'sourceType' in node && 'value' in node && 'quote' in node

/** The sourced values inside `node` by field path, not looking inside a sourced value. */
function sourcedLeaves(node: unknown, path = ''): [string, Sourced<unknown>][] {
  if (isSourced(node)) return [[path, node]]
  if (typeof node !== 'object' || node === null) return []
  return Object.entries(node).flatMap(([key, child]) => sourcedLeaves(child, path === '' ? key : `${path}.${key}`))
}

/** JSON with object keys sorted, so equal values always give the same text. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, node) =>
    node === null || typeof node !== 'object' || Array.isArray(node)
      ? node
      : Object.fromEntries(Object.entries(node).sort(([a], [b]) => (a < b ? -1 : 1))),
  )
}

/** The value without fetch dates: the same value read again later is the same change. */
const withoutFetchDates = (value: unknown): unknown =>
  JSON.parse(stableStringify(value ?? null), (key, node) => (key === 'fetchedAt' ? undefined : node))

const sameValue = (a: unknown, b: unknown) => stableStringify(withoutFetchDates(a)) === stableStringify(withoutFetchDates(b))

/** Identifies a change across runs, so that a rejected one is not proposed again. Fetch dates are left out. */
export function fingerprint(c: { modelSlug: string | null; path: string; after: unknown }): string {
  return createHash('sha256')
    .update(`${c.modelSlug}|${c.path}|${stableStringify(withoutFetchDates(c.after))}`)
    .digest('hex')
}

/**
 * The changes from the stored model to a freshly extracted one. A new model is one `new-model` change
 * (path `''`). Otherwise there is one change per sourced value whose value differs (an official price is
 * a `price`, anything else a `spec-change`); variants are matched by id, and a new variant is one change
 * appended to the list. A value the candidate lacks is kept: the source may have left it out this time.
 */
export function diffModel(existing: Model | null, cand: ModelCandidate): CandidateChange[] {
  if (existing === null) {
    return [{ kind: 'new-model', modelSlug: cand.model.slug, path: '', after: cand.model, checks: cand.fieldChecks }]
  }
  const changes: CandidateChange[] = []
  const stored = new Map(sourcedLeaves(existing))
  const propose = (path: string, after: unknown, checks: Record<string, CheckResult[]>) => {
    const before = stored.get(path)
    if (before !== undefined && sameValue(before.value, (after as Sourced<unknown>).value)) return
    const official = isSourced(after) && after.sourceType === 'official'
    changes.push({
      kind: official && path.endsWith('.priceUsd') ? 'price' : 'spec-change',
      modelSlug: existing.slug,
      path,
      ...(before !== undefined && { before }),
      after,
      checks,
    })
  }

  const { variants, ...fields } = cand.model
  for (const [path, after] of sourcedLeaves(fields)) propose(path, after, { [path]: cand.fieldChecks[path] ?? [] })

  let appended = existing.variants.length
  variants.forEach((variant, i) => {
    const j = existing.variants.findIndex((v) => v.id === variant.id)
    const target = `variants.${j === -1 ? appended++ : j}`
    // The candidate's checks, under the path the change will be stored at.
    const checksUnder = (prefix: string) =>
      Object.fromEntries(
        Object.entries(cand.fieldChecks)
          .filter(([path]) => path === prefix || path.startsWith(`${prefix}.`))
          .map(([path, checks]) => [target + path.slice(`variants.${i}`.length), checks]),
      )
    if (j === -1) {
      propose(target, variant, checksUnder(`variants.${i}`))
      return
    }
    for (const [path, after] of sourcedLeaves(variant)) {
      propose(`${target}.${path}`, after, { [`${target}.${path}`]: cand.fieldChecks[`variants.${i}.${path}`] ?? [] })
    }
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

const AUTO_KINDS = new Set<CandidateChange['kind']>(['price', 'app-version', 'fda-event', 'review-stats', 'complaint-themes'])

const passes = (c: CandidateChange) => Object.values(c.checks).every((checks) => checks.every((check) => check.ok))

const hasThirdParty = (c: CandidateChange) => changedLeaves(c).some(([, field]) => field.sourceType === 'third-party')

/** Drop what was rejected or changes nothing; apply small checked changes; queue the rest. Third-party values are always reviewed. */
export function route(c: CandidateChange, rejections: string[]): 'auto' | 'pending' | 'drop' {
  if (rejections.includes(fingerprint(c)) || sameValue(c.after, c.before)) return 'drop'
  return AUTO_KINDS.has(c.kind) && passes(c) && !hasThirdParty(c) ? 'auto' : 'pending'
}

/**
 * How the review page shows a queued change. A new model keeps its kind with its failed checks marked on
 * the card; any other change with a failed check is a `failed-check`.
 */
function pendingKind(c: CandidateChange): PendingChange['kind'] {
  if (c.kind === 'new-model') return 'new-model'
  if (!passes(c)) return 'failed-check'
  return c.kind === 'pros-cons' ? 'pros-cons' : 'spec-change'
}

/** Writes the change to `data/pending/`, one file per model and path: a newer proposal replaces an older one. */
export async function enqueue(c: CandidateChange, dir = 'data'): Promise<void> {
  const id = [c.modelSlug ?? 'industry', slugify(c.path) || 'model'].join('-')
  const pending = PendingChange.parse({ ...c, id, kind: pendingKind(c), createdAt: new Date().toISOString() })
  await writeJson(join(dir, 'pending', `${id}.json`), pending)
}

const EventSentence = z.strictObject({ text: z.string().min(1) })

type NewEvent = Omit<Event, 'id' | 'text'>

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
  }
}

/**
 * One neutral sentence for the event feed, written by Claude from the facts given. A sentence that
 * fails the forbidden-phrase check, or no usable answer, gives a fixed template instead; only a usage
 * limit stops it. `product` is the display name, such as "Jabra Enhance Select 500".
 */
export async function eventText(event: NewEvent, product: string | null, facts: Json = {}): Promise<string> {
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

/**
 * Applies a change that `route` sent to `auto`: writes the model, reviews or event file and keeps
 * `dataset` in step. Returns the feed events it wrote: `price-change` and `app-update` when a known
 * value changes (not when it is first learned), `fda-clearance`/`fda-recall` for an FDA event. Events
 * are written before the data, and a duplicate is not written again, so a run stopped in between is
 * safe to repeat.
 */
export async function applyAuto(c: CandidateChange, dataset: Dataset, dir = 'data'): Promise<Event[]> {
  const model = dataset.models.find((m) => m.slug === c.modelSlug) ?? null
  const brand = model && dataset.brands.find((b) => b.slug === model.brand)
  const product = model && `${brand?.name ?? model.brand} ${model.name}`

  const emit = async (event: NewEvent, facts: Json): Promise<Event[]> => {
    if (isDuplicateEvent({ ...event, id: 'new', text: '' }, dataset.events)) return []
    const id = slugify(`${event.date.slice(0, 10)} ${event.type} ${event.modelSlug ?? ''} ${event.key}`)
    const written = Event.parse({ ...event, id, text: await eventText(event, product, facts) })
    await writeJson(join(dir, 'events', `${id}.json`), written)
    dataset.events.push(written)
    return [written]
  }

  switch (c.kind) {
    case 'fda-event':
      return emit(c.after as NewEvent, {})

    case 'price':
    case 'app-version': {
      if (model === null) throw new Error(`${c.kind} for unknown model ${c.modelSlug}`)
      const updated = structuredClone(model) as Json
      setPath(updated, c.path, c.after)
      const parsed = Model.parse(updated)
      const before = c.before as Sourced<unknown> | undefined
      const after = c.after as Sourced<unknown>
      let events: Event[] = []
      if (before !== undefined) {
        const base = { modelSlug: model.slug, date: today(), sources: [after.sourceUrl] }
        events =
          c.kind === 'price'
            ? await emit(
                { ...base, type: 'price-change', key: `${c.path}:${stableStringify(after.value)}` },
                { variant: model.variants[Number(c.path.split('.')[1])]?.id, before: before.value, after: after.value },
              )
            : await emit(
                { ...base, type: 'app-update', key: String(after.value) },
                { app: model.app?.name, version: after.value },
              )
      }
      await writeJson(join(dir, 'models', `${model.slug}.json`), parsed)
      dataset.models[dataset.models.indexOf(model)] = parsed
      return events
    }

    case 'review-stats':
    case 'complaint-themes': {
      if (c.modelSlug === null || !c.path.startsWith(REVIEWS_PREFIX)) throw new Error(`bad ${c.kind} change at ${c.path}`)
      const index = dataset.reviews.findIndex((r) => r.slug === c.modelSlug)
      const updated = structuredClone(
        dataset.reviews[index] ?? { slug: c.modelSlug, customer: [], complaintThemes: [], prosCons: null, videos: [] },
      ) as Json
      setPath(updated, c.path.slice(REVIEWS_PREFIX.length), c.after)
      const parsed = Reviews.parse(updated)
      await writeJson(join(dir, 'reviews', `${parsed.slug}.json`), parsed)
      if (index === -1) dataset.reviews.push(parsed)
      else dataset.reviews[index] = parsed
      return []
    }

    default:
      throw new Error(`a ${c.kind} change is never applied automatically`)
  }
}
