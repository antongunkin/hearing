import robotsParser from 'robots-parser'
import type { Refusal, Reply } from './fetcher'

export type Robots = {
  /** Why the URL (of this origin) may not be fetched, or `undefined` when it may. */
  refusal: (url: URL) => string | undefined
  /** The pause the site asks for between requests; 0 when it asks for none. */
  crawlDelayMs: number
}

/** We send no product token, so only the wildcard (`*`) group of robots.txt applies to us. */
const ROBOTS_TOKEN = '*'

const byOrigin = new Map<string, Promise<Robots>>()

const keepOut = (why: string): Robots => ({ refusal: () => why, crawlDelayMs: 0 })

async function read(origin: string, get: (url: URL) => Promise<Reply | Refusal>): Promise<Robots> {
  const file = new URL('/robots.txt', origin)
  const reply = await get(file)
  // Only a missing file means "no rules". Anything that hides the rules means "keep out".
  if ('reason' in reply) return keepOut(`robots.txt unavailable: ${reply.detail ?? reply.reason}`)
  if (reply.status === 404 || reply.status === 410) return { refusal: () => undefined, crawlDelayMs: 0 }
  if (reply.status < 200 || reply.status > 299) return keepOut(`robots.txt: HTTP ${reply.status}`)

  const parser = robotsParser(file.href, new TextDecoder().decode(reply.body))
  return {
    refusal: (url) => (parser.isAllowed(url.href, ROBOTS_TOKEN) ? undefined : 'disallowed by robots.txt'),
    crawlDelayMs: (parser.getCrawlDelay(ROBOTS_TOKEN) ?? 0) * 1000,
  }
}

/** What one origin's robots.txt says, requested once per run. */
export function readRobots(origin: string, get: (url: URL) => Promise<Reply | Refusal>): Promise<Robots> {
  let robots = byOrigin.get(origin)
  if (!robots) byOrigin.set(origin, (robots = read(origin, get)))
  return robots
}
