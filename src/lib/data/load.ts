import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { Brand } from '../schema/brand'
import { Event } from '../schema/event'
import { Model } from '../schema/model'
import { PendingChange } from '../schema/pending'
import { Reviews } from '../schema/reviews'

export type Dataset = {
  brands: Brand[]
  models: Model[]
  reviews: Reviews[]
  events: Event[]
  pending: PendingChange[]
  rejections: string[]
  blocklist: string[]
}

export class DataValidationError extends Error {
  constructor(
    readonly file: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(`Invalid data in ${file}:\n${z.prettifyError({ issues })}`)
    this.name = 'DataValidationError'
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  const text = await readFile(file, 'utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new DataValidationError(file, [{ code: 'custom', path: [], message: (error as Error).message }])
  }
  const result = schema.safeParse(json)
  if (!result.success) throw new DataValidationError(file, result.error.issues)
  return result.data
}

/** All `*.json` records in a directory, in file name order. A missing directory has none. */
async function readRecords<T>(dir: string, schema: z.ZodType<T>): Promise<T[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const files = names.filter((name) => name.endsWith('.json')).sort()
  return Promise.all(files.map((name) => readJson(join(dir, name), schema)))
}

async function readList(file: string): Promise<string[]> {
  try {
    return await readJson(file, z.array(z.string()))
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

export async function loadDataset(dir = 'data'): Promise<Dataset> {
  const [brands, models, reviews, events, pending, rejections, blocklist] = await Promise.all([
    readRecords(join(dir, 'brands'), Brand),
    readRecords(join(dir, 'models'), Model),
    readRecords(join(dir, 'reviews'), Reviews),
    readRecords(join(dir, 'events'), Event),
    readRecords(join(dir, 'pending'), PendingChange),
    readList(join(dir, 'rejections.json')),
    readList(join(dir, 'blocklist.json')),
  ])
  return { brands, models, reviews, events, pending, rejections, blocklist }
}
