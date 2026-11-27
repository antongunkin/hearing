// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { applyAuto, diffModel, enqueue, eventText, fingerprint, route, withCrossChecks } from '@/pipeline/apply'
import { crossCheck } from '@/pipeline/checks/crosscheck'
import { llm, LlmLimitError, LlmOutputError } from '@/pipeline/llm'
import type { Dataset } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'
import type { Sourced } from '@/src/lib/schema/field'
import { Model } from '@/src/lib/schema/model'
import { PendingChange, type CandidateChange, type CheckResult } from '@/src/lib/schema/pending'
import { EVENT_LABELS } from '@/src/lib/site/format'

vi.mock('@/pipeline/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/llm')>()),
  llm: vi.fn(),
}))
vi.mock('@/pipeline/checks/crosscheck', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/checks/crosscheck')>()),
  crossCheck: vi.fn(),
}))

const llmMock = vi.mocked(llm)
const crossCheckMock = vi.mocked(crossCheck)

const PAGE = 'https://www.jabraenhance.com/product/select-500'
const at = (fetchedAt: string) => ({ sourceUrl: PAGE, fetchedAt, sourceType: 'official' as const })
const OLD = '2026-10-01T10:00:00.000Z'
const NEW = '2026-11-26T10:00:00.000Z'
const ok: CheckResult[] = [
  { name: 'literal', ok: true },
  { name: 'range', ok: true },
]

const price = (value: number, fetchedAt = NEW): Sourced<number> => ({ value, unit: 'USD', quote: `$${value}`, ...at(fetchedAt) })
const weight = (value: number, fetchedAt = NEW): Sourced<number> => ({ value, unit: 'g', quote: `${value} g`, ...at(fetchedAt) })

const model = (extra: Partial<Model> = {}): Model =>
  Model.parse({
    slug: 'jabra-enhance-select-500',
    brand: 'jabra-enhance',
    name: 'Select 500',
    aliases: [],
    type: 'otc',
    sameHardwareAs: [],
    variants: [{ id: 'select-500', formFactor: 'RIC', priceUsd: price(1195, OLD), weightG: weight(2.1, OLD) }],
    ...extra,
  })

const change = (extra: Partial<CandidateChange>): CandidateChange => ({
  kind: 'price',
  modelSlug: 'jabra-enhance-select-500',
  path: 'variants.0.priceUsd',
  before: price(1195, OLD),
  after: price(995),
  checks: { 'variants.0.priceUsd': ok },
  ...extra,
})

const brand = {
  slug: 'jabra-enhance',
  name: 'Jabra Enhance',
  group: 'GN',
  website: 'https://www.jabraenhance.com',
  imageLicense: 'none' as const,
  defaultType: 'otc' as const,
  status: 'active' as const,
  scraper: { catalogUrls: [], modelUrlPattern: '', render: false },
}

const dataset = (extra: Partial<Dataset> = {}): Dataset => ({
  brands: [brand],
  models: [model()],
  reviews: [],
  events: [],
  pending: [],
  rejections: [],
  blocklist: [],
  comparePairs: [],
  graph: { entities: [], edges: [] },
  ...extra,
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'apply-'))
})
afterEach(async () => {
  vi.resetAllMocks()
  await rm(dir, { recursive: true, force: true })
})

const readJsonFile = async (path: string) => JSON.parse(await readFile(join(dir, path), 'utf8'))

describe('diffModel', () => {
  test('new model → single new-model; official price change → price; field missing in candidate is not removed', () => {
    const fieldChecks = { 'variants.0.priceUsd': ok, releaseDate: [{ name: 'range' as const, ok: false, detail: 'no-release-date' }] }
    const fresh = model({ variants: [{ id: 'select-500', formFactor: 'RIC', priceUsd: price(995) }] })

    expect(diffModel(null, { model: fresh, fieldChecks })).toEqual([
      { kind: 'new-model', modelSlug: fresh.slug, path: '', after: fresh, checks: fieldChecks },
    ])

    // The candidate has a new price and no weight: the weight stays as stored.
    expect(diffModel(model(), { model: fresh, fieldChecks })).toEqual([change({})])
  })

  test('an official price that moves by more than 25% fails a check, so it waits for a person', () => {
    const at = (value: number) => model({ variants: [{ id: 'select-500', formFactor: 'RIC', priceUsd: price(value) }] })
    const [drop] = diffModel(model(), { model: at(895), fieldChecks: { 'variants.0.priceUsd': ok } })
    expect(drop.checks['variants.0.priceUsd']).toEqual([
      ...ok,
      { name: 'range', ok: false, detail: 'price changes by -25.1% (from 1195 to 895): more than ±25% is reviewed' },
    ])
    expect(route(drop, [])).toBe('pending')
    const [rise] = diffModel(model(), { model: at(1500), fieldChecks: { 'variants.0.priceUsd': ok } })
    expect(route(rise, [])).toBe('pending')
    // Within 25% either way: applied.
    for (const value of [900, 1490]) {
      const [small] = diffModel(model(), { model: at(value), fieldChecks: { 'variants.0.priceUsd': ok } })
      expect(route(small, []), String(value)).toBe('auto')
    }
  })

  test('a value read again with a new fetch date is no change; other changed fields are spec changes', () => {
    const candidate = model({
      variants: [{ id: 'select-500', formFactor: 'RIC', priceUsd: price(1195), weightG: weight(2.3) }],
      tinnitus: { value: true, quote: 'Tinnitus', ...at(NEW) },
    })
    const changes = diffModel(model(), { model: candidate, fieldChecks: { 'variants.0.weightG': ok, tinnitus: ok } })
    expect(changes.map(({ kind, path, before }) => [kind, path, before])).toEqual([
      ['spec-change', 'tinnitus', undefined],
      ['spec-change', 'variants.0.weightG', weight(2.1, OLD)],
    ])
    expect(changes[1].checks).toEqual({ 'variants.0.weightG': ok })
  })

  test('variants are matched by id; a new variant is appended as a whole with its checks', () => {
    const extra = { id: 'select-500-ite', formFactor: 'ITE' as const, weightG: weight(1.5) }
    const candidate = model({ variants: [extra, { id: 'select-500', formFactor: 'RIC', priceUsd: price(995) }] })
    const changes = diffModel(model(), { model: candidate, fieldChecks: { 'variants.0.weightG': ok, 'variants.1.priceUsd': ok } })
    expect(changes).toEqual([
      { kind: 'spec-change', modelSlug: 'jabra-enhance-select-500', path: 'variants.1', after: extra, checks: { 'variants.1.weightG': ok } },
      change({}),
    ])
  })
  test('type, form factor and tech level changes and removed variants are spec changes', () => {
    const typeChecks = [{ name: 'literal' as const, ok: true }]
    const stored = model({
      variants: [
        { id: 'select-500', formFactor: 'RIC', techLevel: 'Premium', priceUsd: price(1195, OLD) },
        { id: 'select-500-bte', formFactor: 'BTE' },
      ],
    })
    const candidate = model({
      type: 'rx',
      variants: [{ id: 'select-500', formFactor: 'BTE', techLevel: 'Advanced', priceUsd: price(1195) }],
    })

    const changes = diffModel(stored, { model: candidate, fieldChecks: { type: typeChecks } })

    const base = { kind: 'spec-change', modelSlug: 'jabra-enhance-select-500' }
    expect(changes).toEqual([
      { ...base, path: 'type', before: 'otc', after: 'rx', checks: { type: typeChecks } },
      { ...base, path: 'variants.0.formFactor', before: 'RIC', after: 'BTE', checks: { 'variants.0.formFactor': [] } },
      { ...base, path: 'variants.0.techLevel', before: 'Premium', after: 'Advanced', checks: { 'variants.0.techLevel': [] } },
      // null: the variant is no longer listed. Only a person removes it.
      { ...base, path: 'variants.1', before: stored.variants[1], after: null, checks: { 'variants.1': [] } },
    ])
    for (const c of changes) expect(route(c, [])).toBe('pending')

    // A tech level the candidate leaves out is kept, as any other field.
    const quiet = model({ variants: [{ id: 'select-500', formFactor: 'RIC', priceUsd: price(1195) }, stored.variants[1]] })
    expect(diffModel(stored, { model: quiet, fieldChecks: {} })).toEqual([])
  })
})

test('diffModel: twins are matched by slug and proposed as whole entries, always for review', () => {
  const twin = (slug: string, name = slug.toUpperCase()) => ({
    slug,
    source: { value: name, quote: name, ...at(NEW), sourceType: 'third-party' as const },
  })
  const diff = (stored: Model['sameHardwareAs'], listed: Model['sameHardwareAs'], fieldChecks: Record<string, CheckResult[]> = {}) =>
    diffModel(model({ sameHardwareAs: stored }), { model: model({ sameHardwareAs: listed }), fieldChecks })
  const base = { kind: 'spec-change', modelSlug: 'jabra-enhance-select-500' }

  // A twin listed first is still new, and appended: the stored one is not overwritten. Its checks move with it.
  const added = diff([twin('b')], [twin('a'), twin('b')], { 'sameHardwareAs.0.source': ok })
  expect(added).toEqual([{ ...base, path: 'sameHardwareAs.1', after: twin('a'), checks: { 'sameHardwareAs.1.source': ok } }])
  const renamed = diff([twin('a'), twin('b')], [twin('b', 'B 2'), twin('a')])
  expect(renamed).toEqual([{ ...base, path: 'sameHardwareAs.1', before: twin('b'), after: twin('b', 'B 2'), checks: {} }])
  const removed = diff([twin('a'), twin('b')], [twin('b')])
  expect(removed).toEqual([{ ...base, path: 'sameHardwareAs.0', before: twin('a'), after: null, checks: { 'sameHardwareAs.0': [] } }])
  for (const change of [...added, ...renamed, ...removed]) expect(route(change, [])).toBe('pending')

  // A source that names no twins at all (a brand page) says nothing about the stored ones.
  expect(diff([twin('a'), twin('b')], [])).toEqual([])
})

describe('route', () => {
  test('price change with passing checks → auto', () => {
    expect(route(change({}), [])).toBe('auto')
  })

  test('spec change → pending even if checks pass', () => {
    expect(route(change({ kind: 'spec-change', path: 'variants.0.weightG', before: weight(2.1), after: weight(2.3) }), [])).toBe(
      'pending',
    )
    expect(route(change({ kind: 'new-model', path: '', before: undefined, after: model(), checks: {} }), [])).toBe('pending')
  })

  test('auto kind with failing check → pending failed-check', async () => {
    const failing = change({ checks: { 'variants.0.priceUsd': [{ name: 'range', ok: false, detail: 'outside' }] } })
    expect(route(failing, [])).toBe('pending')

    await enqueue(failing, dir)
    const [file] = await readdir(join(dir, 'pending'))
    const pending = PendingChange.parse(await readJsonFile(`pending/${file}`))
    expect(pending).toMatchObject({ kind: 'failed-check', path: 'variants.0.priceUsd', after: price(995), before: price(1195, OLD) })
    expect(file).toBe(`${pending.id}.json`)
  })

  test('enqueue keeps the kind of a brand-config with a failed check', async () => {
    const failing: CandidateChange = {
      kind: 'brand-config',
      modelSlug: null,
      path: 'brands/jabra-enhance',
      before: brand,
      after: { ...brand, scraper: { ...brand.scraper, modelUrlPattern: '(' } },
      checks: { 'scraper.modelUrlPattern': [{ name: 'pattern', ok: false, detail: 'not a regular expression' }] },
      refs: ['data/atlas/sites/jabraenhance.com/report.json'],
    }
    expect(route(failing, [])).toBe('pending')
    const id = await enqueue(failing, dir)
    const stored = PendingChange.parse(await readJsonFile(`pending/${id}.json`))
    expect(stored).toMatchObject({ kind: 'brand-config', modelSlug: null, path: 'brands/jabra-enhance', refs: failing.refs })
    expect(id).toBe('industry-brands-jabra-enhance')
  })

  test('enqueue keeps the kind of a relation', async () => {
    const after = { edge: { from: 'company:gn', to: 'brand:jabra-enhance', kind: 'owns' }, entities: [] }
    const id = await enqueue({ kind: 'relation', modelSlug: null, path: 'graph/company:gn owns brand:jabra-enhance', after, checks: {} }, dir)
    expect(PendingChange.parse(await readJsonFile(`pending/${id}.json`)).kind).toBe('relation')
  })

  test('a third-party value never applies automatically', () => {
    const rx = { value: { min: 3000, max: 5000, perPair: true }, unit: 'USD', quote: '$3,000–$5,000 per pair', ...at(NEW) }
    expect(route(change({ after: { ...rx, sourceType: 'third-party' } }), [])).toBe('pending')
  })

  test('rejected fingerprint → drop; after equal to before → drop', () => {
    const c = change({})
    expect(route(c, [fingerprint(c)])).toBe('drop')
    // The same value fetched again later is the change that was rejected.
    expect(route({ ...c, after: price(995, '2027-01-01T00:00:00.000Z') }, [fingerprint(c)])).toBe('drop')
    expect(route(change({ after: price(1195) }), [])).toBe('drop')
  })

  test('a rejected value re-cited from another page or with another quote is still dropped', () => {
    const c = change({})
    const recited = { ...price(995), quote: 'Now only $995', sourceUrl: 'https://shop.example/select-500' }
    expect(route({ ...c, after: recited }, [fingerprint(c)])).toBe('drop')
    expect(route({ ...c, after: { ...recited, derivation: 'per pair / 2' } }, [fingerprint(c)])).toBe('drop')
    expect(route({ ...c, after: price(899) }, [fingerprint(c)])).toBe('auto')
    expect(fingerprint({ ...c, after: { ...price(995), unit: 'EUR' } })).not.toBe(fingerprint(c))
    // The stored value cited again elsewhere changes nothing.
    expect(route(change({ after: { ...price(1195), quote: 'Price: $1,195', sourceUrl: 'https://shop.example/x' } }), [])).toBe('drop')
  })

  test('a rejected new model re-extracted from different page text is dropped', () => {
    const c = change({ kind: 'new-model', path: '', before: undefined, after: model(), checks: {} })
    const again = model({
      aliases: ['Select 500 RIC'],
      variants: [{ id: 'select-500', formFactor: 'RIC', priceUsd: { ...price(1095), quote: 'from $1,095' }, weightG: weight(2.2) }],
    })
    expect(route({ ...c, after: again }, [fingerprint(c)])).toBe('drop')
    expect(route({ ...c, modelSlug: 'jabra-enhance-select-300', after: model({ slug: 'jabra-enhance-select-300' }) }, [fingerprint(c)])).toBe(
      'pending',
    )
  })
})

test('fingerprint: key order does not matter, the value does', () => {
  const a = { kind: 'spec-change' as const, modelSlug: 'm', path: 'p', after: { a: 1, b: [1, { c: 2, d: 3 }] } }
  const b = { kind: 'spec-change' as const, modelSlug: 'm', path: 'p', after: { b: [1, { d: 3, c: 2 }], a: 1 } }
  expect(fingerprint(a)).toBe(fingerprint(b))
  expect(fingerprint(a)).toMatch(/^[0-9a-f]{64}$/)
  expect(fingerprint({ ...a, after: { a: 2, b: [] } })).not.toBe(fingerprint(a))
})

test('withCrossChecks re-reads risky fields of a new model; skips paths without a stored quote', async () => {
  crossCheckMock.mockResolvedValue({ name: 'crosscheck', ok: true })
  const c = change({ kind: 'new-model', path: '', before: undefined, after: model(), checks: { type: ok, 'variants.0.weightG': ok } })

  const checked = await withCrossChecks(c)

  expect(crossCheckMock.mock.calls).toEqual([['variants.0.weightG', '2.1 g', 2.1]])
  expect(checked.checks).toEqual({ type: ok, 'variants.0.weightG': [...ok, { name: 'crosscheck', ok: true }] })
  expect(c.checks['variants.0.weightG']).toEqual(ok) // not changed in place

  crossCheckMock.mockClear()
  expect(await withCrossChecks(change({}))).toEqual(change({})) // price is not risky
  expect(crossCheckMock).not.toHaveBeenCalled()
})

describe('applyAuto', () => {
  test('price change with passing checks → writes the model and emits price-change event', async () => {
    llmMock.mockResolvedValue({ text: 'Jabra Enhance Select 500 now lists at $995, down from $1,195.' })
    const data = dataset()

    const events = await applyAuto(change({}), data, dir)

    expect(events).toEqual([
      {
        id: expect.stringMatching(/^\d{4}-\d{2}-\d{2}-price-change-jabra-enhance-select-500-/),
        type: 'price-change',
        modelSlug: 'jabra-enhance-select-500',
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        key: 'variants.0.priceUsd:995',
        text: 'Jabra Enhance Select 500 now lists at $995, down from $1,195.',
        sources: [PAGE],
      },
    ])
    const stored = Model.parse(await readJsonFile('models/jabra-enhance-select-500.json'))
    expect(stored.variants[0].priceUsd).toEqual(price(995))
    expect(stored.variants[0].weightG).toEqual(weight(2.1, OLD))
    expect(await readJsonFile(`events/${events[0].id}.json`)).toEqual(events[0])
    expect(data.models[0]).toEqual(stored)
    expect(data.events).toEqual(events)

    // Applied again (a re-run), the event is a duplicate.
    expect(await applyAuto(change({}), data, dir)).toEqual([])
  })

  test('event text with a forbidden phrase or an invalid answer falls back to a template', async () => {
    llmMock.mockResolvedValueOnce({ text: 'We tested it: now $995.' })
    const [event] = await applyAuto(change({}), dataset(), dir)
    expect(event.text).toBe('Jabra Enhance Select 500 (select-500) price changed from $1195 to $995.')

    llmMock.mockRejectedValueOnce(new LlmOutputError('bad'))
    expect(await eventText(event, 'Jabra Enhance Select 500', { before: 1195, after: 995, variant: 'select-500' })).toBe(event.text)

    llmMock.mockRejectedValueOnce(new LlmLimitError('claude', 'limit'))
    await expect(eventText(event, 'Jabra Enhance Select 500', {})).rejects.toBeInstanceOf(LlmLimitError)
  })

  test('model-discontinued has a label and a template sentence', async () => {
    expect(EVENT_LABELS['model-discontinued']).toBe('Discontinued')
    llmMock.mockRejectedValueOnce(new LlmOutputError('bad'))
    const discontinued = { type: 'model-discontinued' as const, modelSlug: 'phonak-x', date: '2026-11-27', key: 'phonak-x', sources: [] }
    expect(await eventText(discontinued, 'Phonak Paradise', {})).toBe('Phonak Paradise is no longer listed by its maker.')
  })

  test('first known price or app version gives no event; fda event is written once', async () => {
    const data = dataset()
    const app = { value: '2.4.1', quote: '2.4.1', ...at(NEW), sourceUrl: 'https://apps.apple.com/us/app/x/id1' }
    data.models[0].app = { name: 'Jabra Enhance', iosId: '1' }
    expect(await applyAuto(change({ kind: 'app-version', path: 'app.iosVersion', before: undefined, after: app }), data, dir)).toEqual([])
    expect(Model.parse(await readJsonFile('models/jabra-enhance-select-500.json')).app?.iosVersion).toEqual(app)

    llmMock.mockResolvedValue({ text: 'FDA cleared Jabra Enhance Select 500 under K254108.' })
    const fda = {
      type: 'fda-clearance',
      modelSlug: 'jabra-enhance-select-500',
      date: '2026-06-25',
      key: 'K254108',
      sources: ['https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=K254108'],
    }
    const c = change({ kind: 'fda-event', path: 'events', before: undefined, after: fda, checks: {} })
    const [event] = await applyAuto(c, data, dir)
    expect(event).toMatchObject({ ...fda, id: '2026-06-25-fda-clearance-jabra-enhance-select-500-k254108' })
    expect(await applyAuto(c, data, dir)).toEqual([])
    expect(await readdir(join(dir, 'events'))).toEqual([`${event.id}.json`])
  })

  test('an FDA recall is worded by the template, never by the LLM', async () => {
    const recall = {
      type: 'fda-recall',
      modelSlug: 'jabra-enhance-select-500',
      date: '2026-06-25',
      key: 'Z-1234-2026',
      sources: ['https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfres/res.cfm?id=1'],
    }
    const c = change({ kind: 'fda-event', path: 'events', before: undefined, after: recall, checks: {} })
    const [event] = await applyAuto(c, dataset(), dir)
    expect(event.text).toBe('FDA posted a recall for Jabra Enhance Select 500 (Z-1234-2026).')
    expect(llmMock).not.toHaveBeenCalled()
  })

  test('the model file is read again before a change: an approval made during the run is kept', async () => {
    const data = dataset()
    // Approved in /review while the run was going: the file has a platform the loaded dataset lacks.
    const approved = model({ platform: { value: 'SoundScape', quote: 'SoundScape', ...at(NEW) } })
    await writeJson(join(dir, 'models', 'jabra-enhance-select-500.json'), approved)
    llmMock.mockResolvedValue({ text: 'Jabra Enhance Select 500 now lists at $995.' })

    await applyAuto(change({}), data, dir)

    const stored = Model.parse(await readJsonFile('models/jabra-enhance-select-500.json'))
    expect(stored.platform?.value).toBe('SoundScape')
    expect(stored.variants[0].priceUsd).toEqual(price(995))
    expect(data.models[0]).toEqual(stored)
  })

  test('a new version of an app that models share gives one app-update event, not one per model', async () => {
    llmMock.mockResolvedValue({ text: 'The Jabra Enhance app for iOS was updated to version 2.5.0.' })
    const app = { name: 'Jabra Enhance', iosId: '1', iosVersion: { value: '2.4.1', quote: '2.4.1', ...at(OLD) } }
    const other = model({ slug: 'jabra-enhance-select-300', name: 'Select 300', app })
    const data = dataset({ models: [model({ app }), other] })
    const newVersion = { value: '2.5.0', quote: '2.5.0', ...at(NEW), sourceUrl: 'https://apps.apple.com/us/app/x/id1' }
    const update = (modelSlug: string) =>
      change({ kind: 'app-version', modelSlug, path: 'app.iosVersion', before: app.iosVersion, after: newVersion, checks: {} })

    const events = await applyAuto(update('jabra-enhance-select-500'), data, dir)
    expect(events).toEqual([
      {
        id: expect.stringMatching(/^\d{4}-\d{2}-\d{2}-app-update-1-2-5-0$/),
        type: 'app-update',
        modelSlug: null,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        key: '1:2.5.0',
        text: 'The Jabra Enhance app for iOS was updated to version 2.5.0.',
        sources: [newVersion.sourceUrl],
      },
    ])
    expect(await applyAuto(update('jabra-enhance-select-300'), data, dir)).toEqual([])
    expect(await readdir(join(dir, 'events'))).toEqual([`${events[0].id}.json`])
    expect(llmMock).toHaveBeenCalledTimes(1)
    for (const slug of ['jabra-enhance-select-500', 'jabra-enhance-select-300']) {
      expect(Model.parse(await readJsonFile(`models/${slug}.json`)).app?.iosVersion).toEqual(newVersion)
    }
  })

  test('review stats go to the reviews file of the model', async () => {
    const customer = [{ sourceUrl: 'https://shop.example/select-500', rating: 4.4, count: 120, fetchedAt: NEW }]
    const c = change({ kind: 'review-stats', path: 'reviews.customer', before: [], after: customer, checks: {} })
    expect(await applyAuto(c, dataset(), dir)).toEqual([])
    expect(await readJsonFile('reviews/jabra-enhance-select-500.json')).toEqual({
      slug: 'jabra-enhance-select-500',
      customer,
      complaintThemes: [],
      prosCons: null,
      videos: [],
    })
  })
})

describe('documents and lifecycle changes', () => {
  const doc = { kind: 'user-guide' as const, title: 'Guide', url: 'https://www.jabraenhance.com/guide.pdf', fetchedAt: NEW }
  const documentChange = (checks: CheckResult[]): CandidateChange => ({
    kind: 'document',
    modelSlug: 'jabra-enhance-select-500',
    path: 'documents.0',
    after: doc,
    checks: { 'documents.0': checks },
  })

  test('diffModel proposes the documents the model lacks (an archive copy by its original), and removes none', () => {
    const checks = { 'documents.1': [{ name: 'document' as const, ok: true }] }
    const archived = { ...doc, url: 'https://web.archive.org/web/20200101000000id_/https://www.jabraenhance.com/guide.pdf' }
    const second = { ...doc, url: 'https://www.jabraenhance.com/two.pdf' }
    const stored = model({ documents: [doc] })
    const found = diffModel(stored, { model: model({ documents: [archived, second] }), fieldChecks: checks })
    expect(found).toEqual([{ kind: 'document', modelSlug: stored.slug, path: 'documents.1', after: second, checks }])
    expect(diffModel(stored, { model: model(), fieldChecks: {} })).toEqual([])
  })

  test('a new document passing its checks is applied automatically; a failed one is reviewed', async () => {
    const passing = documentChange(Array(3).fill({ name: 'document', ok: true }))
    const failing = documentChange([{ name: 'document', ok: false, detail: 'model name not in text' }])
    expect(route(passing, [])).toBe('auto')
    expect(route(failing, [])).toBe('pending')
    const okCheck = { name: 'document' as const, ok: true }
    expect(route({ ...passing, checks: {} }, [])).toBe('pending')
    expect(route(documentChange([]), [])).toBe('pending')
    expect(route(documentChange([okCheck, okCheck]), [])).toBe('pending')
    expect(route(documentChange([okCheck, okCheck, okCheck]), [])).toBe('auto')
    const data = dataset()
    expect(await applyAuto(passing, data, dir)).toEqual([])
    expect((await readJsonFile('models/jabra-enhance-select-500.json')).documents).toEqual([doc])
    const id = await enqueue(failing, dir)
    expect(PendingChange.parse(await readJsonFile(`pending/${id}.json`)).kind).toBe('failed-check')
  })

  test('a discontinuation always waits for review; an orphan page shows as a failed check, an origin is kept', async () => {
    const gone = { kind: 'discontinued' as const, modelSlug: 'jabra-enhance-select-500', path: 'discontinued', after: null, checks: {} }
    expect(route({ ...gone, after: { source: { value: 'Select 500', quote: 'x', ...at(NEW) } } }, [])).toBe('pending')
    const orphan = { ...gone, origin: 'archive' as const, checks: { discontinued: [{ name: 'lifecycle' as const, ok: false, detail: 'orphan-product-page' }] } }
    const id = await enqueue(orphan, dir)
    expect(await readJsonFile(`pending/${id}.json`)).toMatchObject({ kind: 'failed-check', origin: 'archive' })
    expect(await enqueue({ ...gone, checks: {} }, dir)).toBe(id)
    expect(await readJsonFile(`pending/${id}.json`)).toMatchObject({ kind: 'spec-change' })
  })

  test('a brand history keeps its kind when queued', async () => {
    const id = await enqueue({ kind: 'brand-history', modelSlug: null, path: 'brands/jabra-enhance.history', after: {}, checks: {} }, dir)
    expect(await readJsonFile(`pending/${id}.json`)).toMatchObject({ kind: 'brand-history' })
  })
})
