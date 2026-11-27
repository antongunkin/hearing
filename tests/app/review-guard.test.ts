// @vitest-environment node
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { approveChange, rejectChange } from '@/app/review/actions'
import { llm } from '@/pipeline/llm'
import { loadDataset } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
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

describe('in development', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
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

  test('a refused approval writes nothing', async () => {
    await expect(approveChange('one-model', ['type'])).rejects.toThrow(/without type/)
    expect(await files('models')).toEqual([])
    expect(await files('events')).toEqual([])
    expect(await files('pending')).toHaveLength(2)
    expect(llmMock).not.toHaveBeenCalled()
  })
})
