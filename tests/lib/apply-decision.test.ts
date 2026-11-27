// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { diffModel, route } from '@/pipeline/apply'
import type { Dataset } from '@/src/lib/data/load'
import { applyDecision } from '@/src/lib/review/apply-decision'
import type { Sourced } from '@/src/lib/schema/field'
import { Model } from '@/src/lib/schema/model'
import type { CandidateChange, PendingChange } from '@/src/lib/schema/pending'

const PAGE = 'https://www.jabraenhance.com/product/select-500'
const OTHER = 'https://shop.example/select-500'
const NOW = '2026-11-26T10:00:00.000Z'
const SLUG = 'jabra-enhance-select-500'

const field = <T>(value: T, extra: Partial<Sourced<T>> = {}): Sourced<T> => ({
  value,
  quote: String(value),
  sourceUrl: PAGE,
  fetchedAt: NOW,
  sourceType: 'official',
  ...extra,
})
const price = (value: number) => field(value, { unit: 'USD', quote: `$${value}` })
const weight = (value: number) => field(value, { unit: 'g', quote: `${value} g` })

const ite = { id: 'select-500-ite', formFactor: 'ITE' as const, weightG: weight(1.5) }

const model = (extra: Partial<Model> = {}): Model =>
  Model.parse({
    slug: SLUG,
    brand: 'jabra-enhance',
    name: 'Select 500',
    aliases: [],
    type: 'otc',
    sameHardwareAs: [],
    variants: [{ id: 'select-500', formFactor: 'RIC', priceUsd: price(1195), weightG: weight(2.1) }],
    ...extra,
  })

const pending = (change: Omit<CandidateChange, 'modelSlug' | 'checks'>, kind: PendingChange['kind'] = 'spec-change'): PendingChange => ({
  checks: {},
  modelSlug: SLUG,
  createdAt: NOW,
  ...change,
  kind,
  id: `${SLUG}-${change.path.replaceAll('.', '-').toLowerCase() || 'model'}`,
})

const dataset = (items: PendingChange[], extra: Partial<Dataset> = {}): Dataset => ({
  brands: [
    {
      slug: 'jabra-enhance',
      name: 'Jabra Enhance',
      group: 'GN',
      website: 'https://www.jabraenhance.com',
      imageLicense: 'none',
      defaultType: 'otc',
      status: 'active',
      scraper: { catalogUrls: [], modelUrlPattern: '', render: false },
    },
  ],
  models: [model()],
  reviews: [],
  events: [],
  pending: items,
  rejections: [],
  blocklist: [],
  comparePairs: [],
  graph: { entities: [], edges: [] },
  ...extra,
})

/** Approves the first pending change; the left-out fields were unticked by the owner (rejected) unless `rejectPaths` says otherwise. */
const approve = (data: Dataset, skipPaths?: string[], rejectPaths = skipPaths) =>
  applyDecision(data, data.pending[0].id, { action: 'approve', skipPaths, rejectPaths })
const written = (result: ReturnType<typeof applyDecision>) => result.writes[0].value as Model

describe('applyDecision: new model', () => {
  const fresh = model({
    platform: field('SoundScape', { sourceUrl: OTHER }),
    tinnitus: field(true),
    variants: [{ id: 'select-500', formFactor: 'RIC', priceUsd: price(1195), weightG: weight(2.1) }, ite],
  })
  const item = pending({ path: '', kind: 'new-model', after: fresh }, 'new-model')

  test('approve new-model with skipPaths omits those fields and emits new-model event', () => {
    const data = dataset([item], { models: [] })
    const before = structuredClone(data)

    const result = approve(data, ['platform', 'variants.0.weightG', 'variants.1.weightG'])

    const expected = model({
      tinnitus: field(true),
      variants: [
        { id: 'select-500', formFactor: 'RIC', priceUsd: price(1195) },
        { id: 'select-500-ite', formFactor: 'ITE' },
      ],
    })
    expect(result.writes).toEqual([{ path: `models/${SLUG}.json`, value: expected }])
    expect(result.deletes).toEqual([`pending/${item.id}.json`])
    expect(result.rejections).toHaveLength(3)
    expect(result.newEvents).toEqual([
      { type: 'new-model', modelSlug: SLUG, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), key: SLUG, sources: [PAGE] },
    ])
    expect(result.eventContexts).toEqual([{ product: 'Jabra Enhance Select 500', facts: {} }])
    expect(data).toEqual(before) // pure
  })

  test('what was left out stays out: the same value later routes to drop, another value to review', () => {
    // A price and a sourced value, on the second variant too, and a whole hardware twin.
    const offered = model({
      ...fresh,
      sameHardwareAs: [{ slug: 'a', source: field('A', { sourceType: 'third-party' }) }],
    })
    const skip = ['platform', 'sameHardwareAs.0', 'variants.0.priceUsd', 'variants.1.weightG']
    const result = approve(dataset([{ ...item, after: offered }], { models: [] }), skip)
    const stored = written(result)

    // The next run reads the same values from another page.
    const recited = JSON.parse(JSON.stringify(offered).replaceAll(PAGE, OTHER)) as Model
    const again = diffModel(stored, { model: recited, fieldChecks: {} })
    expect(again.map((change) => change.path)).toEqual(['platform', 'sameHardwareAs.0', 'variants.0.priceUsd', 'variants.1.weightG'])
    for (const change of again) expect(route(change, result.rejections), change.path).toBe('drop')

    const heavier = model({ ...offered, variants: [offered.variants[0], { ...ite, weightG: weight(1.7) }] })
    const other = diffModel(stored, { model: heavier, fieldChecks: {} }).find((change) => change.path === 'variants.1.weightG')!
    expect(route(other, result.rejections)).toBe('pending')

    // Already rejected: not stored twice.
    const repeat = approve(dataset([{ ...item, after: offered }], { models: [], rejections: result.rejections }), skip)
    expect(repeat.rejections).toEqual([])
  })

  test('a field left out that started unticked is not rejected: the next run proposes it again', () => {
    const skip = ['platform', 'variants.0.weightG', 'variants.1.weightG']
    // The owner unticked only the second variant's weight; the rest started unticked (a check failed).
    const result = approve(dataset([item], { models: [] }), skip, ['variants.1.weightG'])
    expect(written(result).platform).toBeUndefined()

    const again = diffModel(written(result), { model: fresh, fieldChecks: {} })
    expect(Object.fromEntries(again.map((change) => [change.path, route(change, result.rejections)]))).toEqual({
      platform: 'pending',
      'variants.0.weightG': 'pending',
      'variants.1.weightG': 'drop',
    })
    expect(() => approve(dataset([item], { models: [] }), ['platform'], ['tinnitus'])).toThrow(/tinnitus is not left out/)
  })

  test('a whole entry of a list can be left out without shifting the other skipped paths', () => {
    const twins = model({
      sameHardwareAs: [
        { slug: 'a', source: field('A', { sourceType: 'third-party' }) },
        { slug: 'b', source: field('B', { sourceType: 'third-party' }) },
      ],
    })
    const result = approve(dataset([{ ...item, after: twins }], { models: [] }), ['sameHardwareAs.0', 'sameHardwareAs.1'])
    expect(written(result).sameHardwareAs).toEqual([])
  })

  test('refuses when a skipped path is required or does not exist', () => {
    const data = () => dataset([item], { models: [] })
    expect(() => approve(data(), ['variants.0.formFactor'])).toThrow(/without variants\.0\.formFactor[\s\S]*formFactor/)
    expect(() => approve(data(), ['type'])).toThrow(/without type/)
    expect(() => approve(data(), ['materials'])).toThrow(/no field materials/)
  })

  test('refuses to overwrite a different stored model; the same model again is only cleared', () => {
    expect(() => approve(dataset([item]))).toThrow(/already exists/)
    expect(approve(dataset([item], { models: [fresh] })).deletes).toEqual([`pending/${item.id}.json`])
  })

  test('unknown pending id is refused', () => {
    expect(() => applyDecision(dataset([]), 'nope', { action: 'reject' })).toThrow(/no pending change nope/)
  })
})

describe('applyDecision: other pending kinds', () => {
  /** Changes as the pipeline makes them, so that approve and reject see the real shapes. */
  const diff = (stored: Model, candidate: Model) => diffModel(stored, { model: candidate, fieldChecks: {} })

  test('plain type, form factor and tech level, and a sourced value, are written to the model', () => {
    const stored = model({ variants: [{ id: 'select-500', formFactor: 'RIC', techLevel: 'Premium', weightG: weight(2.1) }] })
    const candidate = model({
      type: 'rx',
      variants: [{ id: 'select-500', formFactor: 'BTE', techLevel: 'Advanced', weightG: weight(2.3) }],
    })
    let current = stored
    for (const change of diff(stored, candidate)) {
      const result = approve(dataset([pending(change)], { models: [current] }))
      expect(result.newEvents).toEqual([])
      current = written(result)
    }
    expect(current).toEqual(candidate)
  })

  test('a new variant is appended and a removed variant (after: null) is dropped by its id', () => {
    const [added] = diff(model(), model({ variants: [model().variants[0], ite] }))
    // Whatever index it was proposed at, it goes to the end.
    const appended = approve(dataset([pending({ ...added, path: 'variants.3' })]))
    expect(written(appended).variants).toEqual([model().variants[0], ite])

    const two = model({ variants: [model().variants[0], ite] })
    const [removal] = diff(two, model({ variants: [ite] }))
    expect(removal).toMatchObject({ path: 'variants.0', after: null })
    const removed = approve(dataset([pending(removal)], { models: [two] }))
    expect(written(removed).variants).toEqual([ite])
  })

  const twin = (slug: string, name = slug.toUpperCase()) => ({ slug, source: field(name, { sourceType: 'third-party' }) })

  test.each([
    ['a new twin', [], [twin('a')], [twin('a')]],
    ['a twin listed before a stored one', [twin('b')], [twin('a'), twin('b')], [twin('b'), twin('a')]],
    ['a removed twin', [twin('a'), twin('b')], [twin('b')], [twin('b')]],
    ['a renamed twin', [twin('a'), twin('b')], [twin('a'), twin('b', 'B 2')], [twin('a'), twin('b', 'B 2')]],
  ])('%s, as diffModel proposes it, is written by slug', (_name, stored, listed, expected) => {
    const changes = diff(model({ sameHardwareAs: stored }), model({ sameHardwareAs: listed }))
    expect(changes).toHaveLength(1)
    const item = pending(JSON.parse(JSON.stringify(changes[0])))

    const result = approve(dataset([item], { models: [model({ sameHardwareAs: stored })] }))

    expect(written(result).sameHardwareAs).toEqual(expected)
    // Approved again after a run stopped half-way: nothing moves.
    expect(written(approve(dataset([item], { models: [written(result)] }))).sameHardwareAs).toEqual(expected)
  })

  test('a twin that changed or went since the proposal is refused', () => {
    const [change] = diff(model({ sameHardwareAs: [twin('a')] }), model({ sameHardwareAs: [twin('a', 'A 2')] }))
    for (const now of [[], [twin('a', 'A 3')]]) {
      expect(() => approve(dataset([pending(change)], { models: [model({ sameHardwareAs: now })] }))).toThrow(/changed since/)
    }
  })

  test('a variant is not removed while changes still point at it or past it', () => {
    const two = model({ variants: [model().variants[0], ite] })
    const removal = pending({ kind: 'spec-change', path: 'variants.0', before: two.variants[0], after: null })
    const later = pending({ kind: 'spec-change', path: 'variants.1.weightG', before: weight(1.5), after: weight(1.6) })
    expect(() => approve(dataset([removal, later], { models: [two] }))).toThrow(/first decide/)
  })

  test('a change to a value that has changed since it was proposed is refused', () => {
    const item = pending({ kind: 'price', path: 'variants.0.priceUsd', before: price(1500), after: price(995) }, 'failed-check')
    expect(() => approve(dataset([item]))).toThrow(/changed since/)
  })

  test('an official price gives a price-change event; a third-party price gives none', () => {
    const official = pending({ kind: 'price', path: 'variants.0.priceUsd', before: price(1195), after: price(995) }, 'failed-check')
    const result = approve(dataset([official]))
    expect(written(result).variants[0].priceUsd).toEqual(price(995))
    expect(result.newEvents).toMatchObject([{ type: 'price-change', key: 'variants.0.priceUsd:995' }])
    expect(result.eventContexts[0].facts).toEqual({ variant: 'select-500', before: 1195, after: 995 })

    const range = field({ min: 3000, max: 4000, perPair: true as const }, { sourceType: 'third-party' })
    const rx = model({ type: 'rx', variants: [{ id: 'select-500', formFactor: 'RIC' }] })
    const third = pending({ kind: 'spec-change', path: 'variants.0.priceUsd', after: range })
    const quiet = approve(dataset([third], { models: [rx] }))
    expect(written(quiet).variants[0].priceUsd).toEqual(range)
    expect(quiet.newEvents).toEqual([])
  })

  test('third-party hardware twins and an app version are written to the model', () => {
    const twins = [{ slug: 'twin', source: field('Twin', { sourceType: 'third-party' }) }]
    const hardware = pending({ kind: 'spec-change', path: 'sameHardwareAs', before: [], after: twins })
    expect(written(approve(dataset([hardware]))).sameHardwareAs).toEqual(twins)

    const app = model({ app: { name: 'Enhance', iosId: '1', iosVersion: field('2.4.1') } })
    const version = pending({ kind: 'app-version', path: 'app.iosVersion', before: field('2.4.1'), after: field('2.5.0') }, 'failed-check')
    const result = approve(dataset([version], { models: [app] }))
    expect(written(result).app?.iosVersion).toEqual(field('2.5.0'))
    expect(result.newEvents).toMatchObject([{ type: 'app-update', modelSlug: null, key: '1:2.5.0' }])
  })

  test.each([
    ['review-stats', 'customer', [{ sourceUrl: OTHER, rating: 4.4, count: 120, fetchedAt: NOW }]],
    ['complaint-themes', 'complaintThemes', [{ theme: 'battery', share: 0.4, n: 10, of: 25 }]],
    ['pros-cons', 'prosCons', { pros: [{ text: 'Clear sound', sources: [OTHER] }], cons: [] }],
    ['pros-cons', 'videos', [{ id: 'abc', channel: 'Channel', title: 'Review' }]],
  ] as const)('%s writes reviews.%s', (kind, name, after) => {
    const result = approve(dataset([pending({ kind, path: `reviews.${name}`, after }, 'pros-cons')]))
    expect(result.writes).toEqual([
      {
        path: `reviews/${SLUG}.json`,
        value: { slug: SLUG, customer: [], complaintThemes: [], prosCons: null, videos: [], [name]: after },
      },
    ])
    expect(result.newEvents).toEqual([])
  })

  test('an fda event is passed on as an event, with nothing else written', () => {
    const event = { type: 'fda-clearance', modelSlug: SLUG, date: '2026-06-25', key: 'K254108', sources: [PAGE] }
    const result = approve(dataset([pending({ kind: 'fda-event', path: 'events', after: event }, 'failed-check')]))
    expect(result.writes).toEqual([])
    expect(result.newEvents).toEqual([event])
  })

  test('a change that would make the model invalid is refused', () => {
    const item = pending({ kind: 'spec-change', path: 'variants.0.formFactor', before: 'RIC', after: 'XXL' })
    expect(() => approve(dataset([item]))).toThrow()
  })
})

describe('applyDecision: reject', () => {
  test('reject stores fingerprint; same change later routes to drop', () => {
    const candidate = model({ type: 'rx', variants: [ite] })
    const changes = [
      ...diffModel(null, { model: candidate, fieldChecks: {} }), // new-model
      ...diffModel(model(), { model: candidate, fieldChecks: {} }), // plain type, appended variant, removal
    ]
    expect(changes.length).toBeGreaterThan(3)
    for (const change of changes) {
      expect(route(change, [])).toBe('pending')
      // As read back from the pending file.
      const item = pending(JSON.parse(JSON.stringify(change)), change.kind === 'new-model' ? 'new-model' : 'spec-change')

      const result = applyDecision(dataset([item]), item.id, { action: 'reject' })

      expect(result).toMatchObject({ writes: [], deletes: [`pending/${item.id}.json`], newEvents: [] })
      expect(result.rejections).toHaveLength(1)
      expect(route(change, result.rejections)).toBe('drop')
      // Rejected before: not stored twice.
      expect(applyDecision(dataset([item], { rejections: result.rejections }), item.id, { action: 'reject' }).rejections).toEqual([])
    }
  })
})
