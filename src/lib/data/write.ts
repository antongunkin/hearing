import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function sortKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
}

/** Writes through a temp file and rename, so readers never see a partial file. */
export async function writeJson(path: string, value: unknown): Promise<void> {
  const json: string | undefined = JSON.stringify(value, sortKeys, 2)
  if (json === undefined) throw new TypeError(`Cannot write a non-JSON value to ${path}`)

  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, `${json}\n`, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

export async function deleteJson(path: string): Promise<void> {
  await rm(path, { force: true })
}
