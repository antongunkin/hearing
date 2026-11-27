// The owner's decision on one pending change, as the files to write and delete. No I/O: see app/review/actions.ts.
import { z } from 'zod'
import {
  diffModel,
  fingerprint,
  planChange,
  sameValue,
  sourcedKind,
  VARIANT_PATH,
  type Change,
  type EventContext,
  type NewEvent,
  type Write,
} from '@/pipeline/apply'
import type { Dataset } from '@/src/lib/data/load'
import { Model } from '@/src/lib/schema/model'
import type { PendingChange } from '@/src/lib/schema/pending'

export type Decision = { action: 'approve'; skipPaths?: string[] } | { action: 'reject' }

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
  if (kind === 'new-model') return 'new-model'
  switch (path) {
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
  if (change.kind === 'fda-event') return

  if (VARIANT_PATH.test(path)) {
    if (after !== null || !model) return
    const index = model.variants.findIndex((v) => v.id === (before as Model['variants'][number]).id)
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
    throw new Error(`${path} of ${modelSlug} has changed since this was proposed: reject it, or run the update again`)
  }
}

/**
 * `approve` gives the writes that make the change (a new model without `skipPaths`) and the events it
 * gives; `reject` gives the fingerprint that keeps the pipeline from proposing it again. What `approve`
 * leaves out of a new model is rejected the same way. Both delete the pending file.
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
    const model = without(item.after, decision.skipPaths ?? [])
    // The changes the next run would find between the stored model and the same extraction: what was left out.
    leftOut = diffModel(model, { model: item.after as Model, fieldChecks: {} }).map(fingerprint)
    after = model
  }
  const change: Change = { kind, modelSlug: item.modelSlug, path: item.path, before: item.before, after }
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
