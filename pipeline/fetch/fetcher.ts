import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { config } from '@/pipeline/config'
import { readCache } from '@/pipeline/llm/cache'
import { loadBlocklist } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'
import { looksLikeBotWall } from './bot-detect'
import { isHtml, visibleText } from './html'
import { pdfText } from './pdf'
import { BrowserLaunchError, renderPage } from './render'
import { readRobots } from './robots'

export type FetchResult =
  | { status: 'ok'; url: string; text: string; html?: string; contentHash: string; fetchedAt: string }
  | { status: 'skipped'; url: string; reason: 'robots' | 'blocklist' | 'bot-protection' | 'http-error'; detail?: string }

type Ok = Extract<FetchResult, { status: 'ok' }>

/** Why a request was not made or gave nothing. */
export type Refusal = Pick<Extract<FetchResult, { status: 'skipped' }>, 'reason' | 'detail'>

/** One HTTP answer, redirects not followed. */
export type Reply = { status: number; contentType: string; location: string | null; body: Uint8Array }

export interface FetchOptions {
  /** Run the page's scripts in headless Chromium. */
  render?: boolean
  /** Ignore the cached copy. */
  refresh?: boolean
  /** Domains not to touch; read from `data/blocklist.json` when omitted. */
  blocklist?: string[]
}

/** Google and Amazon under any country domain are not scraped whatever the list says. */
const NEVER_FETCH = /(?:^|\.)(?:google|amazon)\.(?:com?\.[a-z]{2}|[a-z]{2,3})$/
const CACHE_DIR = '.cache/pages'
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 30_000
const MAX_TIMER_MS = 2 ** 31 - 1

/** Whether the bot may not touch the URL's host: Google, Amazon, or a blocklisted domain or its subdomain. */
export function isBlocked(url: URL, blocklist: string[]): boolean {
  const host = url.hostname.replace(/\.$/, '')
  return (
    NEVER_FETCH.test(host) ||
    blocklist.some((domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`))
  )
}

let listed: string[] | undefined

/** Per host: settles with the time its last request ended. */
const queues = new Map<string, Promise<number>>()
/** Per host: the Crawl-delay its robots.txt asks for. */
const crawlDelays = new Map<string, number>()

/**
 * Runs requests to one host one at a time. Between them passes a random pause, or the host's
 * Crawl-delay when that is longer.
 */
function paced<T>(host: string, request: () => Promise<T>): Promise<T> {
  const result = (queues.get(host) ?? Promise.resolve(-Infinity)).then(async (endedAt) => {
    const { minDelayMs, maxDelayMs } = config
    // Worked out only now: the robots.txt just received may have asked for a longer pause.
    const pause = Math.max(minDelayMs + Math.random() * (maxDelayMs - minDelayMs), crawlDelays.get(host) ?? 0)
    const wait = Math.min(endedAt + pause - Date.now(), MAX_TIMER_MS) // A longer timer fires at once.
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    return request()
  })
  const now = () => Date.now()
  queues.set(host, result.then(now, now))
  return result
}

async function plainRequest(url: URL): Promise<Reply> {
  const response = await fetch(url, {
    headers: { 'user-agent': config.userAgent },
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    location: response.headers.get('location'),
    body: new Uint8Array(await response.arrayBuffer()),
  }
}

/** Follows redirects by hand, so that every hop is checked before it is requested, and paced. */
async function follow(
  url: URL,
  check: (url: URL) => Refusal | undefined | Promise<Refusal | undefined>,
  send: (url: URL) => Promise<Reply>,
): Promise<(Reply & { url: URL }) | Refusal> {
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const refusal = await check(url)
    if (refusal) return refusal
    let reply: Reply
    try {
      reply = await paced(url.hostname, () => send(url))
    } catch (error) {
      if (error instanceof BrowserLaunchError) throw error // The setup is broken, not the source.
      const { message, cause } = error as Error & { cause?: { code?: string } }
      return { reason: 'http-error', detail: `${url.href}: ${cause?.code ?? message}` }
    }
    if (reply.status < 300 || reply.status > 399 || !reply.location) return { ...reply, url }
    const next = URL.parse(reply.location, url)
    if (!next) return { reason: 'http-error', detail: `${url.href}: invalid redirect to ${reply.location}` }
    url = next
  }
  return { reason: 'http-error', detail: `more than ${MAX_REDIRECTS} redirects` }
}

/**
 * Gets one public page, politely: blocklist and robots.txt first, a pause between requests to a host,
 * and no attempt to get past a refusal. Raw results are cached; skips are not.
 */
export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  void config.userAgent // Throws before anything happens when the bot cannot name itself.
  const blocklist = opts.blocklist ?? (listed ??= await loadBlocklist())

  const refuse = (target: URL): Refusal | undefined => {
    if (!/^https?:$/.test(target.protocol)) return { reason: 'http-error', detail: `not http(s): ${target.href}` }
    if (isBlocked(target, blocklist)) return { reason: 'blocklist', detail: target.hostname }
  }
  const robotsFor = async ({ origin, hostname }: URL) => {
    const robots = await readRobots(origin, (file) => follow(file, refuse, plainRequest))
    crawlDelays.set(hostname, Math.max(crawlDelays.get(hostname) ?? 0, robots.crawlDelayMs))
    return robots
  }
  const check = async (target: URL): Promise<Refusal | undefined> => {
    const refusal = refuse(target)
    if (refusal) return refusal
    const why = (await robotsFor(target)).refusal(target)
    if (why) return { reason: 'robots', detail: why }
  }
  const renderRequest = async (target: URL) => {
    const { refusal } = await robotsFor(target)
    // Only this origin's robots.txt is at hand, so other origins are held to the blocklist alone.
    return renderPage(target, (sub) => !refuse(sub) && (sub.origin !== target.origin || !refusal(sub)))
  }
  const skipped = (refusal: Refusal): FetchResult => ({ status: 'skipped', url, ...refusal })

  const start = new URL(url)
  const refusal = refuse(start)
  if (refusal) return skipped(refusal)

  const cache = join(CACHE_DIR, `${createHash('sha256').update(url).digest('hex')}.json`)
  if (!opts.refresh) {
    const hit = (await readCache(cache)) as { rendered: boolean; result: Ok } | undefined
    // A copy fetched without scripts does not answer a render request, and a domain may be blocked since.
    if (hit && (hit.rendered || !opts.render) && !refuse(new URL(hit.result.url))) return hit.result
  }

  const reply = await follow(start, check, opts.render ? renderRequest : plainRequest)
  if ('reason' in reply) return skipped(reply)

  const { status, contentType, body } = reply
  const isPdf = /application\/pdf/i.test(contentType)
  const source = isPdf ? '' : new TextDecoder().decode(body)
  if (looksLikeBotWall(status, source)) return skipped({ reason: 'bot-protection', detail: `HTTP ${status}` })
  if (status < 200 || status > 299) return skipped({ reason: 'http-error', detail: `HTTP ${status}` })

  const html = !isPdf && isHtml(contentType) ? source : undefined
  let text: string
  try {
    text = isPdf ? await pdfText(body) : html === undefined ? source : visibleText(html)
  } catch (error) {
    return skipped({ reason: 'http-error', detail: `unreadable document: ${(error as Error).message}` })
  }

  const result: Ok = {
    status: 'ok',
    url: reply.url.href,
    text,
    ...(html !== undefined && { html }),
    // Of the text, not the bytes: tokens and nonces in the markup would change it on every visit.
    contentHash: createHash('sha256').update(text).digest('hex'),
    fetchedAt: new Date().toISOString(),
  }
  await writeJson(cache, { rendered: opts.render ?? false, result })
  return result
}
