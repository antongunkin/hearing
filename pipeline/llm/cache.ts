import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function cachePath(dir: string, parts: unknown[]): string {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return join(dir, `${hash}.json`)
}

/** The stored value, or `undefined` when there is no readable entry. */
export async function readCache(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
