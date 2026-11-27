import { createHash, randomUUID } from 'node:crypto'
import { appendFile, link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { IsoDateTime } from '@/src/lib/schema/field'

export const RAW_DIR = '.cache/raw'
const LOG_FILE = 'log.jsonl'

/** One line of the fetch log: what was asked for, what came back, and where the body is kept. */
export const FetchLogEntry = z.strictObject({
  /** As requested. */
  url: z.string(),
  finalUrl: z.string().optional(),
  /** Each 3xx hop, in order. */
  redirects: z.array(z.strictObject({ url: z.string(), status: z.number() })),
  fetchedAt: IsoDateTime,
  /** Absent when no request was sent. */
  status: z.number().optional(),
  contentType: z.string().optional(),
  bodyHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  via: z.enum(['live', 'archive']),
  rendered: z.boolean(),
  skipped: z.enum(['robots', 'blocklist', 'bot-protection', 'rate-limited', 'archive-excluded', 'http-error']).optional(),
  detail: z.string().optional(),
})
export type FetchLogEntry = z.infer<typeof FetchLogEntry>

/** Points at one log line. */
export type LogRef = { url: string; fetchedAt: string }

/** Keeps the body under its hash. A file already there stays as it is: `link` never replaces. */
export async function storeBody(body: Uint8Array, dir = RAW_DIR): Promise<string> {
  const hash = createHash('sha256').update(body).digest('hex')
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `${hash}.${randomUUID()}.tmp`)
  try {
    await writeFile(tmp, body)
    await link(tmp, join(dir, hash))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    await rm(tmp, { force: true })
  }
  return hash
}

export async function readBody(hash: string, dir = RAW_DIR): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(dir, hash)))
}

/** Appends are serialized in this process, so lines never interleave. */
let appending: Promise<unknown> = Promise.resolve()

export async function appendLog(entry: FetchLogEntry, dir = RAW_DIR): Promise<void> {
  const line = `${JSON.stringify(FetchLogEntry.parse(entry))}\n`
  const done = appending.then(async () => {
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, LOG_FILE), line, 'utf8')
  })
  appending = done.catch(() => {})
  await done
}

export async function readLog(dir = RAW_DIR): Promise<FetchLogEntry[]> {
  let text: string
  try {
    text = await readFile(join(dir, LOG_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => FetchLogEntry.parse(JSON.parse(line)))
}

/** The newest entry that got a reply, requested or ended at `ref.url` (and fetched at `ref.fetchedAt`, if given). */
export function findInLog(
  log: FetchLogEntry[],
  ref: { url: string; fetchedAt?: string },
): FetchLogEntry | undefined {
  return log.findLast(
    (e) =>
      !e.skipped &&
      (e.url === ref.url || e.finalUrl === ref.url) &&
      (ref.fetchedAt === undefined || e.fetchedAt === ref.fetchedAt),
  )
}
