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

/** A CDX request was not answered: `reason` is the fetcher's skip reason (`rate-limited`, `bot-protection`, …). */
export class WaybackError extends Error {
  readonly reason: string

  constructor(reason: string, detail?: string) {
    super(`Web Archive CDX skipped: ${reason}${detail ? ` (${detail})` : ''}`)
    this.name = 'WaybackError'
    this.reason = reason
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

/** The copies the index lists for the query. Throws a WaybackError when the request is skipped. */
export async function cdx(q: CdxQuery, opts: { refresh?: boolean } = {}): Promise<CdxRow[]> {
  const page = await fetchPage(cdxUrl(q), { refresh: opts.refresh })
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
