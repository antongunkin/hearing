'use server'

import { join } from 'node:path'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { writeEvent } from '@/pipeline/apply'
import { loadDataset } from '@/src/lib/data/load'
import { deleteJson, writeJson } from '@/src/lib/data/write'
import { applyDecision, type Decision } from '@/src/lib/review/apply-decision'

const DATA = 'data'

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

/**
 * Refuses a request addressed to this machine by another name (the LAN address, a rebound domain), in case
 * the dev server was started without `-H 127.0.0.1`. The header is the caller's word: the binding is the lock.
 */
async function assertLocalHost(): Promise<void> {
  if (!LOCAL_HOST.test((await headers()).get('host') ?? '')) throw new Error('review is local-only')
}

// One decision at a time: each reads the data and writes it back.
let queue: Promise<unknown> = Promise.resolve()

/**
 * Applies the decision to `data/`. Events come first and the pending file goes last, so a decision that
 * stops half-way (such as at the LLM usage limit) can be made again.
 */
function decide(id: string, decision: Decision): Promise<void> {
  const done = queue.then(async () => {
    const dataset = await loadDataset(DATA)
    const { writes, deletes, rejections, newEvents, eventContexts } = applyDecision(dataset, id, decision)
    for (const [i, event] of newEvents.entries()) await writeEvent({ event, ...eventContexts[i] }, dataset, DATA)
    for (const { path, value } of writes) await writeJson(join(DATA, path), value)
    if (rejections.length > 0) await writeJson(join(DATA, 'rejections.json'), [...dataset.rejections, ...rejections])
    for (const path of deletes) await deleteJson(join(DATA, path))
    revalidatePath('/review')
  })
  queue = done.catch(() => {})
  return done
}

export async function approveChange(id: string, skipPaths?: string[]): Promise<void> {
  if (process.env.NODE_ENV !== 'development') throw new Error('review is dev-only')
  await assertLocalHost()
  await decide(id, { action: 'approve', skipPaths })
}

export async function rejectChange(id: string): Promise<void> {
  if (process.env.NODE_ENV !== 'development') throw new Error('review is dev-only')
  await assertLocalHost()
  await decide(id, { action: 'reject' })
}
