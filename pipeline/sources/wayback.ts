// The Web Archive's CDX index: which copies exist of a URL. Fetched through fetchPage like any other request,
// so the archive's pause and refusals apply.
import { fetchPage } from '@/pipeline/fetch/fetcher'

export const CDX_URL = 'https://web.archive.org/cdx/search/cdx'

const FIELDS = ['timestamp', 'original', 'statuscode', 'mimetype', 'digest'] as const

export type CdxRow = { timestamp: string; original: string; statusCode: string; mimeType: string; digest: string }

export type CdxQuery = {
  url: string
  matchType?: 'exact' | 'prefix' | 'host' | 'domain'
  from?: string
  to?: string
  filters?: string[]
  collapse?: string
  limit?: number
}

/** A CDX request was not answered: `reason` is the fetcher's skip reason (`rate-limited`, `bot-protection`, …).
 * `archive-excluded` (an empty 403) is per site: the owner asked the archive not to serve it. Only `rate-limited` and `bot-protection` stop a run. */
export class WaybackError extends Error {
  readonly reason: string
  readonly detail?: string

  constructor(reason: string, detail?: string) {
    super(`Web Archive CDX skipped: ${reason}${detail ? ` (${detail})` : ''}`)
    this.name = 'WaybackError'
    this.reason = reason
    this.detail = detail
  }
}

/** The CDX query URL; the parameters come in this fixed order. */
export function cdxUrl(q: CdxQuery): string {
  const params = new URLSearchParams()
  params.append('url', q.url)
  if (q.matchType) params.append('matchType', q.matchType)
  if (q.from) params.append('from', q.from)
  if (q.to) params.append('to', q.to)
  for (const filter of q.filters ?? []) params.append('filter', filter)
  if (q.collapse) params.append('collapse', q.collapse)
  if (q.limit !== undefined) params.append('limit', String(q.limit))
  params.append('output', 'json')
  params.append('fl', FIELDS.join(','))
  return `${CDX_URL}?${params}`
}

/** The JSON answer: an array of rows, the first of which names the columns. An empty answer has no rows. */
export function parseCdx(text: string): CdxRow[] {
  if (text.trim() === '') return []
  const [header, ...rows] = JSON.parse(text) as string[][]
  return rows.map((cells) => {
    const field = Object.fromEntries(header.map((name, i) => [name, cells[i]]))
    return {
      timestamp: field.timestamp,
      original: field.original,
      statusCode: field.statuscode,
      mimeType: field.mimetype,
      digest: field.digest,
    }
  })
}

const isTimeout = (detail?: string) => detail === 'HTTP 503' || detail === 'HTTP 504'

/** The copies the index lists for the query. Throws a WaybackError when the request is skipped. */
export async function cdx(q: CdxQuery, opts: { refresh?: boolean; retryTimeout?: boolean } = {}): Promise<CdxRow[]> {
  let page = await fetchPage(cdxUrl(q), { refresh: opts.refresh })
  // A heavy listing the archive times out on (503/504) is asked once more, after the fetcher's usual archive pause; a second timeout is `listing-timeout`.
  if (opts.retryTimeout && page.status === 'skipped' && isTimeout(page.detail)) {
    page = await fetchPage(cdxUrl(q), { refresh: opts.refresh })
    if (page.status === 'skipped' && isTimeout(page.detail)) throw new WaybackError('listing-timeout', page.detail)
  }
  if (page.status === 'skipped') throw new WaybackError(page.reason, page.detail)
  return parseCdx(page.text)
}

const yearOf = (row: CdxRow) => Number(row.timestamp.slice(0, 4))

/** The latest successful (200) copy of each year from `sinceYear` on, oldest year first. */
export function lastCopyPerYear(rows: CdxRow[], sinceYear: number): CdxRow[] {
  const latest = new Map<number, CdxRow>()
  for (const r of rows) {
    if (r.statusCode !== '200' || yearOf(r) < sinceYear) continue
    const year = yearOf(r)
    const kept = latest.get(year)
    if (!kept || r.timestamp > kept.timestamp) latest.set(year, r)
  }
  return [...latest.keys()].sort((a, b) => a - b).map((year) => latest.get(year)!)
}

/** How many successful (200) copies the index holds of each year from `sinceYear` on; years without copies are absent. */
export function copiesPerYear(rows: CdxRow[], sinceYear: number): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    if (r.statusCode !== '200' || yearOf(r) < sinceYear) continue
    const year = String(yearOf(r))
    counts[year] = (counts[year] ?? 0) + 1
  }
  return counts
}

type Opts = { refresh?: boolean }

/** The latest 200 copy of each year from 2018 on; the index is asked for one copy per month, and the last of each year is kept. */
export async function yearlyCopies(url: string, opts: Opts = {}): Promise<CdxRow[]> {
  const rows = await cdx({ url, from: '2018', filters: ['statuscode:200'], collapse: 'timestamp:6' }, opts)
  return lastCopyPerYear(rows, 2018)
}

/** The most PDF copies one listing asks for; a domain-wide listing of a big site times out in the archive without a limit. */
export const PDF_LIMIT = 5000

export type PdfTarget = { url: string; matchType: 'prefix' | 'domain' }

/**
 * Where to list a brand's PDFs: the literal host and path at the start of `documentUrlPattern`
 * (`^https://www\.phonak\.com/content/dam/` gives the prefix `www.phonak.com/content/dam/`), else the whole domain.
 */
export function pdfTarget(website: string, documentUrlPattern?: string): PdfTarget {
  const domain: PdfTarget = { url: new URL(website).hostname.replace(/^www\./, ''), matchType: 'domain' }
  const head = /^\^https\??:\/\//.exec(documentUrlPattern ?? '')
  if (!documentUrlPattern || !head || documentUrlPattern.includes('|')) return domain
  const rest = documentUrlPattern.slice(head[0].length)
  let literal = ''
  let i = 0
  for (; i < rest.length; i++) {
    const c = rest[i]
    if (c === '\\' && /[./-]/.test(rest[i + 1] ?? '')) {
      literal += rest[i + 1]
      i++
    } else if (/[\w/%~-]/.test(c)) literal += c
    else break
  }
  // A quantifier binds to the character before it, which is then not certain.
  if (/[?*{]/.test(rest[i] ?? '')) literal = literal.slice(0, -1)
  const slash = literal.indexOf('/')
  if (slash <= 0 || slash === literal.length - 1) return domain
  return { url: literal, matchType: 'prefix' }
}

/** The PDFs the archive holds under the target, one copy per URL, at most PDF_LIMIT. A listing the archive times out on twice throws `listing-timeout`. */
export function pdfCopies(target: PdfTarget, opts: Opts = {}): Promise<CdxRow[]> {
  return cdx(
    { url: target.url, matchType: target.matchType, filters: ['mimetype:application/pdf', 'statuscode:200'], collapse: 'urlkey', limit: PDF_LIMIT },
    { ...opts, retryTimeout: true },
  )
}

/** The earliest successful copy of the URL, or null when there is none. */
export async function earliestCopy(url: string, opts: Opts = {}): Promise<CdxRow | null> {
  return (await cdx({ url, filters: ['statuscode:200'], limit: 1 }, opts))[0] ?? null
}

/** The latest successful copy of the URL, or null when there is none. */
export async function latestCopy(url: string, opts: Opts = {}): Promise<CdxRow | null> {
  return (await cdx({ url, filters: ['statuscode:200'], limit: -1 }, opts))[0] ?? null
}
