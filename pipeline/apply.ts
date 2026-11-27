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

const sameValue = (a: unknown, b: unknown) => substance(a) === substance(b)

/**
 * Identifies a change across runs, so that a rejected one is not proposed again: by what it says, not
 * where it was read (a sourced value counts by value and unit only). A new model counts by its slug, so a
 * rejected model stays rejected whatever its page says next time.
 */
export function fingerprint(c: { kind: CandidateChange['kind']; modelSlug: string | null; path: string; after: unknown }): string {
  const what = c.kind === 'new-model' ? 'new-model' : substance(c.after)
  return createHash('sha256').update(`${c.modelSlug}|${c.path}|${what}`).digest('hex')
}

/**
 * The changes from the stored model to a freshly extracted one. A new model is one `new-model` change
 * (path `''`). Otherwise there is one change per sourced value whose value differs (an official price is
 * a `price`, anything else a `spec-change`), and a `spec-change` for a new `type`, `formFactor` or
 * `techLevel`. Variants are matched by id: a new variant is one change appended to the list, and a stored
 * variant the candidate no longer lists is one change with `after: null` (removal, by a person only).
 * A value the candidate lacks is kept: the source may have left it out this time.
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
    const price = after.sourceType === 'official' && path.endsWith('.priceUsd')
    push(price ? 'price' : 'spec-change', path, before, after, checks)
  }
  /** A plain field the candidate states, when it differs from the stored one. */
  const proposePlain = (path: string, before: unknown, after: unknown) => {
    if (after !== undefined && !sameValue(before, after)) push('spec-change', path, before, after, { [path]: cand.fieldChecks[path] ?? [] })
  }

  const { variants, ...fields } = cand.model
  proposePlain('type', existing.type, cand.model.type)
  for (const [path, after] of sourcedLeaves(fields)) proposeSourced(path, after, { [path]: cand.fieldChecks[path] ?? [] })

  let appended = existing.variants.length
  variants.forEach((variant, i) => {
    const j = existing.variants.findIndex((v) => v.id === variant.id)
    const target = `variants.${j === -1 ? appended++ : j}`
    if (j === -1) {
      // The candidate's checks, under the path the variant will be stored at.
      const checks = Object.fromEntries(
        Object.entries(cand.fieldChecks)
          .filter(([path]) => path === `variants.${i}` || path.startsWith(`variants.${i}.`))
          .map(([path, results]) => [target + path.slice(`variants.${i}`.length), results]),
      )
      push('spec-change', target, undefined, variant, checks)
      return
    }
    proposePlain(`${target}.formFactor`, existing.variants[j].formFactor, variant.formFactor)
    proposePlain(`${target}.techLevel`, existing.variants[j].techLevel, variant.techLevel)
    for (const [path, after] of sourcedLeaves(variant)) {
      proposeSourced(`${target}.${path}`, after, { [`${target}.${path}`]: cand.fieldChecks[`variants.${i}.${path}`] ?? [] })
    }
  })

  existing.variants.forEach((variant, j) => {
    if (!variants.some((v) => v.id === variant.id)) push('spec-change', `variants.${j}`, variant, null, { [`variants.${j}`]: [] })
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
 * value changes (not when it is first learned), `fda-clearance`/`fda-recall` for an FDA event. An
 * `app-update` belongs to the app (no model, key `<iosId>:<version>`), so models that share an app give
 * one. Events are written before the data, and a duplicate is not written again, so a run stopped in
 * between is safe to repeat.
 */
export async function applyAuto(c: CandidateChange, dataset: Dataset, dir = 'data'): Promise<Event[]> {
  const model = dataset.models.find((m) => m.slug === c.modelSlug) ?? null
  const brand = model && dataset.brands.find((b) => b.slug === model.brand)
  const product = model && `${brand?.name ?? model.brand} ${model.name}`

  const emit = async (event: NewEvent, facts: Json, subject = product): Promise<Event[]> => {
    if (isDuplicateEvent({ ...event, id: 'new', text: '' }, dataset.events)) return []
    const id = slugify(`${event.date.slice(0, 10)} ${event.type} ${event.modelSlug ?? ''} ${event.key}`)
    const written = Event.parse({ ...event, id, text: await eventText(event, subject, facts) })
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
            : // One event per app release, not per model: brand apps serve every model of the brand.
              await emit(
                { ...base, modelSlug: null, type: 'app-update', key: `${model.app?.iosId ?? model.slug}:${after.value}` },
                { app: model.app?.name, version: after.value },
                brand?.name ?? model.brand,
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
