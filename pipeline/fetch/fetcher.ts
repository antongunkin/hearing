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
import { appendLog, storeBody, type FetchLogEntry } from './raw-store'
import { readRobots } from './robots'

export type FetchResult =
  | { status: 'ok'; url: string; text: string; html?: string; contentHash: string; fetchedAt: string; bodyHash?: string; contentType?: string }
  | { status: 'skipped'; url: string; reason: 'robots' | 'blocklist' | 'bot-protection' | 'rate-limited' | 'archive-excluded' | 'http-error'; detail?: string }

type Ok = Extract<FetchResult, { status: 'ok' }>

/** Why a request was not made or gave nothing. */
export type Refusal = Pick<Extract<FetchResult, { status: 'skipped' }>, 'reason' | 'detail'>

/** One HTTP answer, redirects not followed. */
export type Reply = { status: number; contentType: string; location: string | null; body: Uint8Array; rendered?: true }

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

/** Domains this process never touches whatever list a caller gives: a gone brand's own hosts (see `blockDomains`). */
let alwaysBlocked: string[] = []

/**
 * Sets the domains no request of this process may touch, on top of every blocklist (replacing the ones set
 * before): a command sets a gone brand's own hosts, so that no step, redirect or search result reaches them.
 */
export function blockDomains(domains: string[]): void {
  alwaysBlocked = [...domains]
}

/** Whether the bot may not touch the URL's host: Google, Amazon, or a blocklisted (or `blockDomains`) domain or its subdomain. */
export function isBlocked(url: URL, blocklist: string[]): boolean {
  const host = url.hostname.replace(/\.$/, '').toLowerCase()
  return (
    NEVER_FETCH.test(host) ||
    [...blocklist, ...alwaysBlocked].some((domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`))
  )
}

let listed: string[] | undefined

/** Per host: settles with the time its last request ended. */
const queues = new Map<string, Promise<number>>()
/** Per host: the Crawl-delay its robots.txt asks for. */
const crawlDelays = new Map<string, number>()

/**
 * Runs requests to one host one at a time. Between them passes a random pause, or the host's
 * Crawl-delay or, for a Web Archive host, the archive pause, when that is longer.
 */
function paced<T>(host: string, request: () => Promise<T>): Promise<T> {
  const result = (queues.get(host) ?? Promise.resolve(-Infinity)).then(async (endedAt) => {
    const { minDelayMs, maxDelayMs } = config
    // Worked out only now: the robots.txt just received may have asked for a longer pause.
    const pause = Math.max(
      minDelayMs + Math.random() * (maxDelayMs - minDelayMs),
      crawlDelays.get(host) ?? 0,
      config.archiveHosts.includes(host) ? config.archiveDelayMs : 0,
    )
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

type Hop = { url: string; status: number }

/** Follows redirects by hand, so that every hop is checked before it is requested, and paced. */
async function follow(
  url: URL,
  check: (url: URL) => Refusal | undefined | Promise<Refusal | undefined>,
  send: (url: URL) => Promise<Reply>,
): Promise<(Reply & { url: URL; hops: Hop[] }) | (Refusal & { hops: Hop[] })> {
  const hops: Hop[] = []
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const refusal = await check(url)
    if (refusal) return { ...refusal, hops }
    let reply: Reply
    try {
      reply = await paced(url.hostname, () => send(url))
    } catch (error) {
      if (error instanceof BrowserLaunchError) throw error // The setup is broken, not the source.
      const { message, cause } = error as Error & { cause?: { code?: string } }
      return { reason: 'http-error', detail: `${url.href}: ${cause?.code ?? message}`, hops }
    }
    if (reply.status < 300 || reply.status > 399 || !reply.location) return { ...reply, url, hops }
    const next = URL.parse(reply.location, url)
    if (!next) return { reason: 'http-error', detail: `${url.href}: invalid redirect to ${reply.location}`, hops }
    hops.push({ url: url.href, status: reply.status })
    url = next
  }
  return { reason: 'http-error', detail: `more than ${MAX_REDIRECTS} redirects`, hops }
}

const baseEntry = (start: URL, fetchedAt: string, redirects: Hop[]): FetchLogEntry => ({
  url: start.href,
  redirects,
  fetchedAt,
  via: config.archiveHosts.includes(start.hostname) ? 'archive' : 'live',
  rendered: false,
})

/** Logs a request that was refused or failed, with the status of the last reply when there was one. */
const logRefusal = (start: URL, { reason, detail }: Refusal, fetchedAt: string, hops: Hop[] = [], status?: number) =>
  appendLog({
    ...baseEntry(start, fetchedAt, hops),
    ...(status !== undefined && { status }),
    skipped: reason,
    ...(detail !== undefined && { detail }),
  })

/**
 * One request through `follow`, written to the fetch log whatever came of it. `judge` may turn a
 * reply into a refusal (a bot wall, an error status); the log line then carries the reply's status.
 * The body of a final, non-3xx reply is kept in the raw store.
 */
async function request(
  start: URL,
  check: (url: URL) => Refusal | undefined | Promise<Refusal | undefined>,
  send: (url: URL) => Promise<Reply>,
  judge?: (reply: Reply) => Refusal | undefined,
): Promise<(Reply & { url: URL; fetchedAt: string; bodyHash?: string }) | Refusal> {
  const reached = await follow(start, check, send)
  const fetchedAt = new Date().toISOString()
  if ('reason' in reached) {
    const last = reached.hops.at(-1)
    await logRefusal(start, reached, fetchedAt, reached.hops, last?.status)
    return { reason: reached.reason, detail: reached.detail }
  }

  const { hops: _hops, ...reply } = reached
  const stored = reply.status < 300 || reply.status > 399
  const bodyHash = stored ? await storeBody(reply.body) : undefined
  const refusal = judge?.(reply)
  await appendLog({
    ...baseEntry(start, fetchedAt, reached.hops),
    ...(reply.url.href !== start.href && { finalUrl: reply.url.href }),
    status: reply.status,
    ...(reply.contentType && { contentType: reply.contentType }),
    ...(bodyHash && { bodyHash }),
    rendered: reply.rendered === true,
    ...(refusal && { skipped: refusal.reason, ...(refusal.detail !== undefined && { detail: refusal.detail }) }),
  })
  return refusal ?? { ...reply, fetchedAt, bodyHash }
}

/**
 * Gets one public page, politely: blocklist and robots.txt first, a pause between requests to a host,
 * and no attempt to get past a refusal. Raw results are cached; skips are not.
 */
export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const blocklist = opts.blocklist ?? (listed ??= await loadBlocklist())

  const refuse = (target: URL): Refusal | undefined => {
    if (!/^https?:$/.test(target.protocol)) return { reason: 'http-error', detail: `not http(s): ${target.href}` }
    if (isBlocked(target, blocklist)) return { reason: 'blocklist', detail: target.hostname }
  }
  const robotsFor = async ({ origin, hostname }: URL) => {
    const robots = await readRobots(origin, (file) => request(file, refuse, plainRequest))
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
  if (refusal) {
    await logRefusal(start, refusal, new Date().toISOString())
    return skipped(refusal)
  }

  const cache = join(CACHE_DIR, `${createHash('sha256').update(url).digest('hex')}.json`)
  if (!opts.refresh) {
    const hit = (await readCache(cache)) as { rendered: boolean; logged?: true; result: Ok } | undefined
    // A copy fetched without scripts does not answer a render request, and a domain may be blocked since.
    if (hit?.logged && (hit.rendered || !opts.render) && !refuse(new URL(hit.result.url))) return hit.result
  }

  const reply = await request(start, check, opts.render ? renderRequest : plainRequest, ({ status, contentType, body }) => {
    const source = /application\/pdf/i.test(contentType) ? '' : new TextDecoder().decode(body)
    if (status === 429) return { reason: 'rate-limited', detail: 'HTTP 429' }
    // The Web Archive answers an excluded site (its owner asked it not to serve it) with an empty 403; a 403 with a page is a wall.
    if (status === 403 && body.length === 0 && config.archiveHosts.includes(start.hostname)) return { reason: 'archive-excluded', detail: 'HTTP 403' }
    if (looksLikeBotWall(status, source)) return { reason: 'bot-protection', detail: `HTTP ${status}` }
    if (status < 200 || status > 299) return { reason: 'http-error', detail: `HTTP ${status}` }
  })
  if ('reason' in reply) return skipped(reply)

  const { contentType, body } = reply
  const isPdf = /application\/pdf/i.test(contentType)
  const source = isPdf ? '' : new TextDecoder().decode(body)

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
    fetchedAt: reply.fetchedAt,
    bodyHash: reply.bodyHash,
    contentType,
  }
  await writeJson(cache, { rendered: opts.render ?? false, logged: true, result })
  return result
}
