import robotsParser from 'robots-parser'
import { config } from '@/pipeline/config'
import type { Refusal, Reply } from './fetcher'

/** Why the URL (of this origin) may not be fetched, or `undefined` when it may. */
export type RobotsRules = (url: URL) => string | undefined

const rulesByOrigin = new Map<string, Promise<RobotsRules>>()

async function read(origin: string, get: (url: URL) => Promise<Reply | Refusal>): Promise<RobotsRules> {
  const file = new URL('/robots.txt', origin)
  const reply = await get(file)
  // Only a missing file means "no rules". Anything that hides the rules means "keep out".
  if ('reason' in reply) return () => `robots.txt unavailable: ${reply.detail ?? reply.reason}`
  if (reply.status === 404 || reply.status === 410) return () => undefined
  if (reply.status < 200 || reply.status > 299) return () => `robots.txt: HTTP ${reply.status}`

  const parser = robotsParser(file.href, new TextDecoder().decode(reply.body))
  return (url) => (parser.isAllowed(url.href, config.userAgent) ? undefined : 'disallowed by robots.txt')
}

/** The rules of one origin, requested once per run. */
export function robotsRules(origin: string, get: (url: URL) => Promise<Reply | Refusal>): Promise<RobotsRules> {
  let rules = rulesByOrigin.get(origin)
  if (!rules) rulesByOrigin.set(origin, (rules = read(origin, get)))
  return rules
}
