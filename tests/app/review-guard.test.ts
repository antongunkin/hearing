// @vitest-environment node
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { approveChange, rejectChange } from '@/app/review/actions'
import { llm } from '@/pipeline/llm'
import { loadDataset } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'

const request = vi.hoisted(() => ({ host: 'localhost:3000' as string | null }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers(request.host === null ? {} : { host: request.host }) }))
vi.mock('@/pipeline/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline/llm')>()),
  llm: vi.fn(),
}))

const llmMock = vi.mocked(llm)

const candidate = (slug: string) => ({
  id: `${slug}-model`,
  kind: 'new-model',
  modelSlug: slug,
  path: '',
  after: {
    slug,
    brand: 'jabra-enhance',
    name: 'Select 500',
    aliases: [],
    type: 'otc',
    sameHardwareAs: [],
    variants: [{ id: 'select-500', formFactor: 'RIC' }],
  },
  checks: {},
  createdAt: '2026-11-26T10:00:00.000Z',
})

const root = process.cwd()
let dir: string
beforeEach(async () => {
  request.host = 'localhost:3000'
  // The actions use `data/` of the working directory: a copy of the fixture brands in a temp directory.
  dir = await mkdtemp(join(tmpdir(), 'review-'))
  await cp(join(root, 'data/brands'), join(dir, 'data/brands'), { recursive: true })
  await writeJson(join(dir, 'data/rejections.json'), [])
  await writeJson(join(dir, 'data/blocklist.json'), [])
  for (const slug of ['one', 'two']) await writeJson(join(dir, `data/pending/${slug}-model.json`), candidate(slug))
  process.chdir(dir)
})
afterEach(async () => {
  process.chdir(root)
  vi.unstubAllEnvs()
  vi.resetAllMocks()
  await rm(dir, { recursive: true, force: true })
})

const files = (name: string) => readdir(join(dir, 'data', name)).catch(() => [])

test('actions throw outside development', async () => {
  for (const env of ['production', 'test']) {
    vi.stubEnv('NODE_ENV', env)
    await expect(approveChange('one-model')).rejects.toThrow('review is dev-only')
    await expect(rejectChange('one-model')).rejects.toThrow('review is dev-only')
  }
  expect(await files('pending')).toEqual(['one-model.json', 'two-model.json'])
  expect(await files('models')).toEqual([])
})

const relationCard = {
  id: 'industry-graph-gn-owns-phonak',
  kind: 'relation',
  modelSlug: null,
  path: 'graph/company:gn owns brand:phonak',
  after: {
    edge: {
      from: 'company:gn',
      to: 'brand:phonak',
      kind: 'owns',
      visibility: 'internal',
      status: 'proposed',
      sources: [{ url: 'https://www.gn.example/about', quote: 'GN owns Phonak', fetchedAt: '2026-11-26T10:00:00.000Z', kind: 'company-page' }],
    },
    entities: [
      { id: 'company:gn', kind: 'company', name: 'GN' },
      { id: 'brand:phonak', kind: 'brand', name: 'Phonak' },
    ],
  },
  checks: {},
  createdAt: '2026-11-26T10:00:00.000Z',
}

test('atlas cards are refused outside development and from a non-loopback host', async () => {
  await writeJson(join(dir, `data/pending/${relationCard.id}.json`), relationCard)
  vi.stubEnv('NODE_ENV', 'production')
  await expect(approveChange(relationCard.id)).rejects.toThrow('review is dev-only')
  vi.stubEnv('NODE_ENV', 'development')
  request.host = '192.168.0.8:3000'
  await expect(approveChange(relationCard.id)).rejects.toThrow('review is local-only')
  await expect(rejectChange(relationCard.id)).rejects.toThrow('review is local-only')
  expect(await files('pending')).toContain(`${relationCard.id}.json`)
  expect(await files('graph')).toEqual([])
})

describe('in development', () => {
  test('approving a relation card publishes the edge; rejecting another leaves the graph alone', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    await writeJson(join(dir, `data/pending/${relationCard.id}.json`), relationCard)
    await approveChange(relationCard.id)
    const { graph, pending } = await loadDataset('data')
    expect(graph.edges).toMatchObject([{ kind: 'owns', visibility: 'public', status: 'verified' }])
    expect(pending.map((item) => item.id)).not.toContain(relationCard.id)
  })

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
  })

  test('actions refuse a request addressed to any host but this machine', async () => {
    for (const host of ['192.168.0.8:3000', 'evil.example', 'localhost.evil.example', '127.0.0.1.evil.example', 'x.localhost:3000', null]) {
      request.host = host
      await expect(approveChange('one-model'), String(host)).rejects.toThrow('review is local-only')
      await expect(rejectChange('one-model'), String(host)).rejects.toThrow('review is local-only')
    }
    expect(await files('pending')).toEqual(['one-model.json', 'two-model.json'])
    expect(await files('models')).toEqual([])

    // Local names pass the guard, with or without a port: the refusal is then about the id.
    for (const host of ['localhost', '127.0.0.1:3000', '[::1]', '[::1]:3123']) {
      request.host = host
      await expect(approveChange('nope'), host).rejects.toThrow('no pending change nope')
      await expect(rejectChange('nope'), host).rejects.toThrow('no pending change nope')
    }
  })

  test('approve writes the model and its event and removes the pending file; reject records the fingerprint', async () => {
    llmMock.mockResolvedValue({ text: 'Jabra Enhance Select 500 joined the database.' })

    await approveChange('one-model')
    await rejectChange('two-model')

    const data = await loadDataset('data')
    expect(data.models.map((model) => model.slug)).toEqual(['one'])
    expect(data.events).toMatchObject([{ type: 'new-model', modelSlug: 'one', text: 'Jabra Enhance Select 500 joined the database.' }])
    expect(data.pending).toEqual([])
    expect(data.rejections).toHaveLength(1)
    expect(JSON.parse(await readFile('data/rejections.json', 'utf8'))).toEqual(data.rejections)
  })

  test('approve rejects only the left-out fields the owner unticked', async () => {
    llmMock.mockResolvedValue({ text: 'Jabra Enhance Select 500 joined the database.' })
    const at = { sourceUrl: 'https://www.jabraenhance.com/x', fetchedAt: '2026-11-26T10:00:00.000Z', sourceType: 'official' }
    const offered = candidate('one')
    Object.assign(offered.after, { platform: { value: 'A', quote: 'A', ...at }, tinnitus: { value: true, quote: 'yes', ...at } })
    await writeJson(join(dir, 'data/pending/one-model.json'), offered)

    await approveChange('one-model', ['platform', 'tinnitus'], ['tinnitus'])

    expect((await loadDataset('data')).rejections).toHaveLength(1)
  })

  test('a refused approval writes nothing', async () => {
    await expect(approveChange('one-model', ['type'])).rejects.toThrow(/without type/)
    expect(await files('models')).toEqual([])
    expect(await files('events')).toEqual([])
    expect(await files('pending')).toHaveLength(2)
    expect(llmMock).not.toHaveBeenCalled()
  })
})
