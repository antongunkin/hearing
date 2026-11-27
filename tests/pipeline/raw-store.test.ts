// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  appendLog,
  findInLog,
  readBody,
  readLog,
  storeBody,
  type FetchLogEntry,
} from '@/pipeline/fetch/raw-store'

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-01-02T00:00:00.000Z'
const entry = (over: Partial<FetchLogEntry>): FetchLogEntry => ({
  url: 'https://a.test/',
  redirects: [],
  fetchedAt: T1,
  via: 'live',
  rendered: false,
  ...over,
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'raw-store-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

test('a body is stored once under its hash and never overwritten', async () => {
  const hash = await storeBody(new TextEncoder().encode('A'), dir)
  expect(hash).toBe(createHash('sha256').update('A').digest('hex'))
  await writeFile(join(dir, hash), 'tampered') // stands for a file that is already there
  expect(await storeBody(new TextEncoder().encode('A'), dir)).toBe(hash)
  expect(await readFile(join(dir, hash), 'utf8')).toBe('tampered')
  expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
})

test('a stored body reads back as its bytes', async () => {
  const bytes = new Uint8Array([0, 255, 37, 80, 68, 70])
  expect(await readBody(await storeBody(bytes, dir), dir)).toEqual(bytes)
})

test('the log is only appended to', async () => {
  await appendLog(entry({ url: 'https://a.test/1' }), dir)
  await appendLog(entry({ url: 'https://a.test/2' }), dir)
  expect((await readLog(dir)).map((e) => e.url)).toEqual(['https://a.test/1', 'https://a.test/2'])
})

test('concurrent appends each keep their own line', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => appendLog(entry({ url: `https://a.test/${i}` }), dir)))
  expect(await readLog(dir)).toHaveLength(20)
})

test('a missing log is empty, and an invalid entry is refused', async () => {
  expect(await readLog(join(dir, 'nowhere'))).toEqual([])
  await expect(appendLog({ ...entry({}), bodyHash: 'nope' }, dir)).rejects.toThrow()
})

test('findInLog matches the requested or the final URL, never a skipped entry', () => {
  const log = [
    entry({ url: 'https://a.test/x', finalUrl: 'https://a.test/y', fetchedAt: T1 }),
    entry({ url: 'https://a.test/z', skipped: 'robots', fetchedAt: T2 }),
  ]
  expect(findInLog(log, { url: 'https://a.test/y', fetchedAt: T1 })).toBe(log[0])
  expect(findInLog(log, { url: 'https://a.test/z' })).toBeUndefined()
})

test('findInLog returns the newest match, or the one at the given time', () => {
  const log = [entry({ fetchedAt: T1 }), entry({ fetchedAt: T2 })]
  expect(findInLog(log, { url: 'https://a.test/' })).toBe(log[1])
  expect(findInLog(log, { url: 'https://a.test/', fetchedAt: T1 })).toBe(log[0])
})
