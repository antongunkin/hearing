// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { applyAuto, diffModel, enqueue, eventText, fingerprint, route, withCrossChecks } from '@/pipeline/apply'
import { crossCheck } from '@/pipeline/checks/crosscheck'
import { llm, LlmLimitError, LlmOutputError } from '@/pipeline/llm'
import type { Dataset } from '@/src/lib/data/load'
import type { Sourced } from '@/src/lib/schema/field'
import { Model } from '@/src/lib/schema/model'
import { PendingChange, type CandidateChange, type CheckResult } from '@/src/lib/schema/pending'

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
})

test('fingerprint: key order does not matter, the value does', () => {
  const a = { modelSlug: 'm', path: 'p', after: { a: 1, b: [1, { c: 2, d: 3 }] } }
  const b = { modelSlug: 'm', path: 'p', after: { b: [1, { d: 3, c: 2 }], a: 1 } }
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

    llmMock.mockRejectedValueOnce(new LlmLimitError('limit'))
    await expect(eventText(event, 'Jabra Enhance Select 500', {})).rejects.toBeInstanceOf(LlmLimitError)
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
