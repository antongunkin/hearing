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
import { robotsRules } from './robots'

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

/** Not scraped whatever the list says. */
const NEVER_FETCH = ['google.com', 'amazon.com']
const CACHE_DIR = '.cache/pages'
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 30_000

function blocks(domains: string[], url: URL): boolean {
  const host = url.hostname.replace(/\.$/, '')
  return domains.some((domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`))
}

let listed: string[] | undefined

/** Per host: settles when the next request to it may start. */
const queues = new Map<string, Promise<unknown>>()

/** Runs requests to one host one at a time, with a random pause after each. */
function paced<T>(host: string, request: () => Promise<T>): Promise<T> {
  const result = (queues.get(host) ?? Promise.resolve()).then(request)
  const pause = () => {
    const { minDelayMs, maxDelayMs } = config
    return new Promise((resolve) => setTimeout(resolve, minDelayMs + Math.random() * (maxDelayMs - minDelayMs)))
  }
  queues.set(host, result.then(pause, pause))
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
  const blocklist = [...NEVER_FETCH, ...(opts.blocklist ?? (listed ??= await loadBlocklist()))]

  const refuse = (target: URL): Refusal | undefined => {
    if (!/^https?:$/.test(target.protocol)) return { reason: 'http-error', detail: `not http(s): ${target.href}` }
    if (blocks(blocklist, target)) return { reason: 'blocklist', detail: target.hostname }
  }
  const rulesFor = (origin: string) => robotsRules(origin, (file) => follow(file, refuse, plainRequest))
  const check = async (target: URL): Promise<Refusal | undefined> => {
    const refusal = refuse(target)
    if (refusal) return refusal
    const why = (await rulesFor(target.origin))(target)
    if (why) return { reason: 'robots', detail: why }
  }
  const renderRequest = async (target: URL) => {
    const rules = await rulesFor(target.origin)
    // Only this origin's robots.txt is at hand, so other origins are held to the blocklist alone.
    return renderPage(target, (sub) => !refuse(sub) && (sub.origin !== target.origin || !rules(sub)))
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
