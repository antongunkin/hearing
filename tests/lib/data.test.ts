import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DataValidationError, loadDataset } from '@/src/lib/data/load'
import { containsName, modelSlug, namesModel, normalizeName } from '@/src/lib/data/slug'
import { deleteJson, writeJson } from '@/src/lib/data/write'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hearing-data-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function put(path: string, content: unknown) {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content))
}

const brand = {
  slug: 'phonak',
  name: 'Phonak',
  group: 'Sonova',
  website: 'https://www.phonak.com',
  imageLicense: 'none',
  defaultType: 'rx',
  status: 'active',
  scraper: { catalogUrls: ['https://www.phonak.com/en-us'], modelUrlPattern: '/hearing-aids/', render: false },
}
const model = { slug: 'phonak-x', brand: 'phonak', name: 'X', aliases: [], type: 'rx', sameHardwareAs: [], variants: [] }
const reviews = { slug: 'phonak-x', customer: [], complaintThemes: [], prosCons: null, videos: [] }
const event = { id: 'e1', type: 'new-model', modelSlug: 'phonak-x', date: '2026-11-26', key: 'k', text: 't', sources: [] }
const pending = { id: 'p1', kind: 'new-model', modelSlug: null, path: '', after: model, checks: {}, createdAt: '2026-11-26T00:00:00Z' }

describe('loadDataset', () => {
  beforeEach(async () => {
    await put('rejections.json', [])
    await put('blocklist.json', [])
  })

  test('loads every kind of record', async () => {
    await put('brands/phonak.json', brand)
    await put('models/phonak-x.json', model)
    await put('reviews/phonak-x.json', reviews)
    await put('events/e1.json', event)
    await put('pending/p1.json', pending)
    await put('rejections.json', ['abc'])
    await put('blocklist.json', ['example.com'])
    await put('compare-pairs.json', ['phonak-x-vs-phonak-y'])
    await put('graph/entities.json', [{ id: 'brand:phonak', kind: 'brand', name: 'Phonak' }])
    await put('graph/edges.json', [])

    expect(await loadDataset(dir)).toEqual({
      brands: [brand],
      models: [model],
      reviews: [reviews],
      events: [event],
      pending: [pending],
      rejections: ['abc'],
      blocklist: ['example.com'],
      comparePairs: ['phonak-x-vs-phonak-y'],
      graph: { entities: [{ id: 'brand:phonak', kind: 'brand', name: 'Phonak' }], edges: [] },
    })
  })

  test('treats missing record directories as empty', async () => {
    expect(await loadDataset(dir)).toEqual({
      brands: [], models: [], reviews: [], events: [], pending: [], rejections: [], blocklist: [], comparePairs: [],
      graph: { entities: [], edges: [] },
    })
  })

  test('refuses a graph edge to an entity that is not in the graph', async () => {
    await put('graph/entities.json', [])
    await put('graph/edges.json', [{
      from: 'company:gn-store-nord', to: 'brand:phonak', kind: 'owns', visibility: 'internal', status: 'proposed',
      sources: [{ url: 'https://www.gnhearing.com/about', fetchedAt: '2026-11-26T10:00:00Z', kind: 'company-page' }],
    }])

    await expect(loadDataset(dir)).rejects.toThrow('unknown entity brand:phonak')
  })

  test.each(['blocklist.json', 'rejections.json'])('fails when %s is missing', async (list) => {
    await rm(join(dir, list))

    await expect(loadDataset(dir)).rejects.toThrow(list)
  })

  test.each([
    ['is not JSON', '['],
    ['is not a list', { pairs: [] }],
    ['has a pair in the wrong order', ['b-vs-a']],
    ['has a self-pair', ['a-vs-a']],
    ['has text that is no pair', ['a']],
    ['is not sorted', ['c-vs-d', 'a-vs-b']],
    ['repeats a pair', ['a-vs-b', 'a-vs-b']],
  ])('fails when compare-pairs.json %s', async (_, content) => {
    await put('compare-pairs.json', content)

    await expect(loadDataset(dir)).rejects.toThrow(/compare-pairs\.json/)
    await expect(loadDataset(dir)).rejects.toBeInstanceOf(DataValidationError)
  })

  test.each([
    ['brands', brand, 'slug'],
    ['models', model, 'slug'],
    ['reviews', reviews, 'slug'],
    ['events', event, 'id'],
    ['pending', pending, 'id'],
  ])('fails when a %s file name does not match its record', async (folder, record, key) => {
    await put(`${folder}/other.json`, record)

    await expect(loadDataset(dir)).rejects.toThrow(new RegExp(`${folder}/other\\.json`))
    await expect(loadDataset(dir)).rejects.toMatchObject({ issues: [{ path: [key] }] })
  })

  test('reports file name on a misspelled key', async () => {
    await put('models/phonak-x.json', { ...model, succesor: 'phonak-y' })

    await expect(loadDataset(dir)).rejects.toThrow(/models\/phonak-x\.json/)
  })

  test('reports file name on invalid model', async () => {
    const { variants: _, ...bad } = model
    await put('models/bad.json', bad)

    await expect(loadDataset(dir)).rejects.toThrow(/models\/bad\.json/)
    await expect(loadDataset(dir)).rejects.toBeInstanceOf(DataValidationError)
    await expect(loadDataset(dir)).rejects.toMatchObject({ issues: [{ path: ['variants'] }] })
  })

  test('reports file name on malformed JSON', async () => {
    await put('blocklist.json', '[')

    await expect(loadDataset(dir)).rejects.toThrow(/blocklist\.json/)
    await expect(loadDataset(dir)).rejects.toBeInstanceOf(DataValidationError)
  })

  test("accepts the repository's own data/", async () => {
    await expect(loadDataset()).resolves.toBeDefined()
  })
})

describe('writeJson', () => {
  test('is atomic and stable', async () => {
    const p = join(dir, 'a.json')
    await writeJson(p, { b: 1, a: 2 })

    expect(await readFile(p, 'utf8')).toBe('{\n  "a": 2,\n  "b": 1\n}\n')
    expect(await readdir(dir)).toEqual(['a.json'])
  })

  test('sorts nested keys, keeps array order, creates missing directories', async () => {
    const p = join(dir, 'pending', 'a.json')
    await writeJson(p, [{ b: { d: 1, c: 2 }, a: 0 }, 1])

    const text = await readFile(p, 'utf8')
    expect(JSON.stringify(JSON.parse(text))).toBe('[{"a":0,"b":{"c":2,"d":1}},1]')
  })

  test('leaves no temp file behind when the write fails', async () => {
    const p = join(dir, 'taken.json')
    await mkdir(p)

    await expect(writeJson(p, {})).rejects.toThrow()
    expect(await readdir(dir)).toEqual(['taken.json'])
  })

  test('refuses a value that has no JSON form, keeping the old file', async () => {
    const p = join(dir, 'a.json')
    await writeJson(p, { a: 1 })

    await expect(writeJson(p, undefined)).rejects.toThrow()
    expect(await readFile(p, 'utf8')).toBe('{\n  "a": 1\n}\n')
  })
})

describe('deleteJson', () => {
  test('removes the file and tolerates a missing one', async () => {
    const p = join(dir, 'a.json')
    await writeJson(p, {})

    await deleteJson(p)
    await deleteJson(p)

    expect(await readdir(dir)).toEqual([])
  })
})

describe('slugs', () => {
  test('normalizeName unifies trademark and diacritics', () => {
    expect(normalizeName('Audéo Sphere™ Infinio Hearing Aids')).toBe(normalizeName('audeo sphere infinio'))
  })

  test('normalizeName strips ®, ©, "hearing aid" and extra spaces', () => {
    expect(normalizeName('  Jabra®   Enhance© Hearing Aid  Select ')).toBe('jabra enhance select')
  })

  test('modelSlug is url-safe and prefixed with the brand', () => {
    expect(modelSlug('Phonak', 'Audéo Sphere™ Infinio (I90-R)')).toBe('phonak-audeo-sphere-infinio-i90-r')
  })

  test.each([
    ['phonak', 'Phonak Audéo', 'phonak-audeo'],
    ['Phonak', 'PHONAK® Audéo', 'phonak-audeo'],
    ['jabra-enhance', 'Jabra Enhance Select', 'jabra-enhance-select'],
    ['phonak', 'Phonak', 'phonak'],
    ['phonak', 'Phonakia One', 'phonak-phonakia-one'],
  ])('modelSlug(%j, %j) does not repeat the brand', (brandName, name, slug) => {
    expect(modelSlug(brandName, name)).toBe(slug)
  })

  test('modelSlug keeps "+" models apart from their base model', () => {
    expect(modelSlug('signia', 'Pure+')).toBe('signia-pure-plus')
    expect(modelSlug('signia', 'Pure')).toBe('signia-pure')
  })
})

describe('namesModel', () => {
  const model = (brand: string, name: string, aliases: string[] = []) => ({ brand, name, aliases })
  const eargo7 = model('eargo', 'Eargo 7')
  const plus = model('jabra-enhance', 'Jabra Enhance Plus')

  test.each([
    ['a number inside a rating', eargo7, 'Some Other Aid. 4.7 out of 5 stars, 120 reviews'],
    ['a common word', plus, 'Acme hearing aid, $99 plus tax'],
    ['a number apart from the brand', eargo7, 'Eargo: 7 day trial'],
    ['a number after "brand hearing aids"', eargo7, 'Eargo hearing aids 7 day trial'],
    ['a number that goes on', eargo7, 'The Eargo 7.5 and Eargo 70'],
    ['one word without the brand', model('phonak', 'Virto'), 'A virto of patience'],
    ['common words without the brand', model('jabra-enhance', 'Pro Max'), 'Comes in pro, max and basic plans. Pro Max'],
  ])('%s is not the model', (_, wanted, text) => {
    expect(namesModel(text, wanted)).toBe(false)
  })

  test.each([
    ['a numbered model with its brand', eargo7, 'Eargo 7 hearing aids are rated 4.7 out of 5'],
    ['trademark signs between brand and name', eargo7, 'The new EARGO®7 and its case'],
    ['a hyphen and a line break', plus, 'Jabra-Enhance\nPlus, in stock'],
    ['a name of several words without the brand', model('phonak', 'Audeo Sphere Infinio'), 'Audéo Sphere™ Infinio'],
    ['a full name with diacritics', model('phonak', 'Audeo Sphere Infinio'), 'Phonak Audéo Sphere Infinio'],
    ['an alias', model('eargo', 'Seven', ['Eargo 7']), 'Buy the Eargo 7.'],
  ])('%s is the model', (_, wanted, text) => {
    expect(namesModel(text, wanted)).toBe(true)
  })

  test('containsName keeps a decimal as one word', () => {
    expect(containsName('Rated 4.7 of 5, from 1,248 reviews', '7')).toBe(false)
    expect(containsName('Rated 4.7 of 5, from 1,248 reviews', '248')).toBe(false)
    expect(containsName('Version 4.7. Now', 'version 4.7')).toBe(true)
  })
})
