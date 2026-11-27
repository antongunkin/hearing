import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { Brand } from '../schema/brand'
import { ComparePairs } from '../schema/compare-pairs'
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
  /** Pair slugs that have had a comparison page. */
  comparePairs: string[]
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

/** One JSON file, checked against `schema`. */
export async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
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

/**
 * All `*.json` records in a directory, in file name order. A missing directory has none.
 * Each file must be named after its record's `key`.
 */
async function readRecords<K extends 'slug' | 'id', T extends Record<K, string>>(
  dir: string,
  schema: z.ZodType<T>,
  key: K,
): Promise<T[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    // Git does not keep empty directories.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files = names.filter((name) => name.endsWith('.json')).sort()
  return Promise.all(
    files.map(async (name) => {
      const file = join(dir, name)
      const record = await readJson(file, schema)
      if (record[key] !== basename(name, '.json')) {
        const message = `${key} "${record[key]}" does not match the file name`
        throw new DataValidationError(file, [{ code: 'custom', path: [key], message }])
      }
      return record
    }),
  )
}

const list = z.array(z.string())

/** No file yet means no pair has been recorded; a file that is there must be right. */
async function loadComparePairs(dir: string): Promise<string[]> {
  try {
    return await readJson(join(dir, 'compare-pairs.json'), ComparePairs)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Domains the pipeline must not touch. The file is required: without it they would be fetched again. */
export function loadBlocklist(dir = 'data'): Promise<string[]> {
  return readJson(join(dir, 'blocklist.json'), list)
}

export async function loadDataset(dir = 'data'): Promise<Dataset> {
  // The two lists are required: without them blocked domains and rejected changes would come back.
  const [brands, models, reviews, events, pending, rejections, blocklist, comparePairs] = await Promise.all([
    readRecords(join(dir, 'brands'), Brand, 'slug'),
    readRecords(join(dir, 'models'), Model, 'slug'),
    readRecords(join(dir, 'reviews'), Reviews, 'slug'),
    readRecords(join(dir, 'events'), Event, 'id'),
    readRecords(join(dir, 'pending'), PendingChange, 'id'),
    readJson(join(dir, 'rejections.json'), list),
    loadBlocklist(dir),
    loadComparePairs(dir),
  ])
  return { brands, models, reviews, events, pending, rejections, blocklist, comparePairs }
}
