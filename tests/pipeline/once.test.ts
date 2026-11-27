// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { OnceLedger } from '@/pipeline/once'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'once-'))
  file = join(dir, 'cache', 'once.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('OnceLedger', () => {
  test('a missing file has nothing done', async () => {
    const ledger = await OnceLedger.open(file)

    expect(ledger.has('reviews:select-300')).toBe(false)
  })

  test('a mark is written at once and read back by a later open', async () => {
    const ledger = await OnceLedger.open(file)

    await ledger.mark('reviews:select-300')

    expect(ledger.has('reviews:select-300')).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ done: ['reviews:select-300'] })
    const reopened = await OnceLedger.open(file)
    expect(reopened.has('reviews:select-300')).toBe(true)
    expect(reopened.has('youtube:select-300')).toBe(false)
  })

  test('marking a key twice keeps one entry', async () => {
    const ledger = await OnceLedger.open(file)

    await ledger.mark('youtube:select-300')
    await ledger.mark('youtube:select-300')

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ done: ['youtube:select-300'] })
  })
})
