// The owner's decision on one pending change, as the files to write and delete. No I/O: see app/review/actions.ts.
import { z } from 'zod'
import {
  diffModel,
  entryChange,
  fingerprint,
  planChange,
  sameValue,
  sourcedKind,
  type Change,
  type EventContext,
  type NewEvent,
  type Write,
} from '@/pipeline/apply'
import type { Dataset } from '@/src/lib/data/load'
import { Model } from '@/src/lib/schema/model'
import type { PendingChange } from '@/src/lib/schema/pending'

/**
 * `skipPaths` are left out of a new model; of those, `rejectPaths` (the fields the owner unticked) are
 * rejected. A field left out because it started unticked comes back with the next run, as a change to review.
 */
export type Decision = { action: 'approve'; skipPaths?: string[]; rejectPaths?: string[] } | { action: 'reject' }

export type DecisionResult = {
  /** Paths are relative to the data directory. */
  writes: Write[]
  deletes: string[]
  /** Fingerprints to add to `rejections.json`. */
  rejections: string[]
  newEvents: NewEvent[]
  /** `eventContexts[i]` words `newEvents[i]`. */
  eventContexts: EventContext[]
}

/**
 * The kind the pipeline gave the change. A pending file does not keep it (`kind` there says how to show
 * the change), but its path and value tell what it writes.
 */
function changeKind({ kind, path, after }: PendingChange): Change['kind'] {
  if (kind === 'new-model' || kind === 'brand-config' || kind === 'relation' || kind === 'brand-history') return kind
  if (/^documents\.\d+$/.test(path)) return 'document'
  switch (path) {
    case 'discontinued':
      return 'discontinued'
    case 'events':
      return 'fda-event'
    case 'app.iosVersion':
      return 'app-version'
    case 'reviews.customer':
      return 'review-stats'
    case 'reviews.complaintThemes':
      return 'complaint-themes'
    case 'reviews.prosCons':
    case 'reviews.videos':
      return 'pros-cons'
    default:
      return sourcedKind(path, after)
  }
}

type Json = Record<string, unknown>

const getPath = (node: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((at, key) => (at as Json | undefined)?.[key], node)

/**
 * The new model without the fields at `skipPaths` (such as `variants.0.weightG`). Throws when a path
 * names nothing, or when the model cannot do without it.
 */
function without(after: unknown, skipPaths: string[]): Model {
  const model = structuredClone(after) as Json
  // Last first, so that taking an entry out of a list does not move the ones still to go.
  for (const path of [...new Set(skipPaths)].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))) {
    const keys = path.split('.')
    const key = keys.pop()!
    const parent = (keys.length === 0 ? model : getPath(model, keys.join('.'))) as Json | undefined
    if (typeof parent !== 'object' || parent === null || !Object.hasOwn(parent, key)) throw new Error(`no field ${path} to leave out`)
    if (Array.isArray(parent)) parent.splice(Number(key), 1)
    else delete parent[key]
  }
  const parsed = Model.safeParse(model)
  if (!parsed.success) {
    const left = skipPaths.length > 0 ? ` without ${skipPaths.join(', ')}` : ''
    throw new Error(`Cannot add the model${left}:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

/** An empty list or null says as little as a missing value: a reviews file starts with those. */
const orNothing = (value: unknown) => (value === null || (Array.isArray(value) && value.length === 0) ? undefined : value)

/**
 * Throws when approving would overwrite something the proposal did not see: another model under the same
 * slug, a value changed since, or (for a variant removal) the variants that other pending changes point at.
 * A change already made passes, so that an approval stopped half-way can be repeated.
 */
function assertCurrent(item: PendingChange, change: Change, dataset: Dataset): void {
  const { modelSlug, path, before, after } = change
  const model = dataset.models.find((m) => m.slug === modelSlug)
  if (change.kind === 'new-model') {
    if (model && !sameValue(model, after)) throw new Error(`model ${model.slug} already exists: reject this change`)
    return
  }
  if (change.kind === 'fda-event' || change.kind === 'relation') return
  if (change.kind === 'brand-history') {
    const slug = /^brands\/([^/]+)\.history$/.exec(path)?.[1]
    const stored = dataset.brands.find((b) => b.slug === slug)?.history
    if (stored && !sameValue(stored, after) && (before === undefined || !sameValue(stored, before))) {
      throw new Error(`brand ${slug} has a different history now: reject this proposal`)
    }
    return
  }
  if (change.kind === 'brand-config') {
    const slug = path.replace(/^brands\//, '')
    const stored = dataset.brands.find((b) => b.slug === slug)
    if (stored && !sameValue(stored, after) && (before === undefined || !sameValue(stored, before))) {
      throw new Error(
        before === undefined
          ? `brand ${slug} already exists: reject this proposal`
          : `brand ${slug} has changed since this was proposed: reject it, or run atlas:describe again`,
      )
    }
    return
  }
  const stale = (what: string) =>
    new Error(`${what} of ${modelSlug} has changed since this was proposed: reject it, or run the update again`)

  const entry = entryChange(change)
  if (entry) {
    if (!model) return
    const index = entry.indexIn(model)
    if (after !== null) {
      // A new entry has no `before`: a clash with a stored one is refused when it is written.
      const stored = model[entry.list][index]
      if (before !== undefined && !(stored && (sameValue(stored, before) || sameValue(stored, after)))) {
        throw stale(`${entry.list} entry ${entry.name}`)
      }
      return
    }
    // Twin changes name their entry by slug, so only the variants' indices matter to other changes.
    if (entry.list !== 'variants') return
    // Removing a variant moves the later ones down, under the feet of changes that name them by index.
    const stranded = dataset.pending.filter((other) => {
      const at = /^variants\.(\d+)\./.exec(other.path)?.[1]
      return other.id !== item.id && other.modelSlug === modelSlug && index !== -1 && at !== undefined && Number(at) >= index
    })
    if (stranded.length > 0) throw new Error(`first decide ${stranded.map((other) => other.id).join(', ')}`)
    return
  }

  const record = path.startsWith('reviews.') ? { reviews: dataset.reviews.find((r) => r.slug === modelSlug) } : model
  const current = orNothing(getPath(record, path))
  if (!sameValue(current, orNothing(before)) && !sameValue(current, orNothing(after))) {
    throw stale(path)
  }
}

/** Whether a change the next run would find is about one of the fields at `paths` of the new model `after`. */
function aboutPaths(change: Change, paths: string[], after: unknown): boolean {
  const entry = entryChange(change)
  if (entry === null) return paths.some((path) => change.path === path || change.path.startsWith(`${path}.`))
  // A whole entry is proposed at the index it will have in the stored list: matched by its id or slug instead.
  return paths.some((path) => {
    const left = entryChange({ path, after: getPath(after, path) })
    return left !== null && left.list === entry.list && left.name === entry.name
  })
}

/**
 * `approve` gives the writes that make the change (a new model without `skipPaths`) and the events it
 * gives; `reject` gives the fingerprint that keeps the pipeline from proposing it again. What `approve`
 * leaves out of a new model at `rejectPaths` is rejected the same way. Both delete the pending file.
 */
export function applyDecision(dataset: Dataset, pendingId: string, decision: Decision): DecisionResult {
  const item = dataset.pending.find((p) => p.id === pendingId)
  if (!item) throw new Error(`no pending change ${pendingId}`)
  const kind = changeKind(item)
  const deletes = [`pending/${item.id}.json`]
  const unseen = (prints: string[]) => [...new Set(prints)].filter((print) => !dataset.rejections.includes(print))

  if (decision.action === 'reject') {
    const rejections = unseen([fingerprint({ ...item, kind })])
    return { writes: [], deletes, rejections, newEvents: [], eventContexts: [] }
  }

  let after = item.after
  let leftOut: string[] = []
  if (kind === 'new-model') {
    const skipPaths = decision.skipPaths ?? []
    const rejectPaths = decision.rejectPaths ?? []
    const stray = rejectPaths.find((path) => !skipPaths.includes(path))
    if (stray !== undefined) throw new Error(`${stray} is not left out, so it cannot be rejected`)
    const model = without(item.after, skipPaths)
    // The changes the next run would find between the stored model and the same extraction: what was left out.
    leftOut = diffModel(model, { model: item.after as Model, fieldChecks: {} })
      .filter((left) => aboutPaths(left, rejectPaths, item.after))
      .map(fingerprint)
    after = model
  }
  const change: Change = { kind, modelSlug: item.modelSlug, path: item.path, before: item.before, after, origin: item.origin }
  assertCurrent(item, change, dataset)
  const { writes, events } = planChange(change, dataset)
  return {
    writes,
    deletes,
    rejections: unseen(leftOut),
    newEvents: events.map(({ event }) => event),
    eventContexts: events.map(({ product, facts }) => ({ product, facts })),
  }
}
