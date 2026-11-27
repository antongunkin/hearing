// FDA 510(k) clearances and recalls from openFDA. An API, but fetched like any page: robots.txt and pauses
// included.
import { z } from 'zod'
import { config } from '@/pipeline/config'
import { fetchPage } from '@/pipeline/fetch/fetcher'
import type { LogRef } from '@/pipeline/fetch/raw-store'
import { containsName, normalizeName } from '@/src/lib/data/slug'
import type { Brand } from '@/src/lib/schema/brand'
import type { Event } from '@/src/lib/schema/event'
import type { Model } from '@/src/lib/schema/model'

export type FdaEvent = { event: Omit<Event, 'id' | 'text'>; matched: boolean }

export type Clearance510k = { kNumber: string; applicant: string; deviceName: string; decisionDate: string; cdrhUrl: string; ref: LogRef }

// openFDA writes dates both as 2026-04-10 and 20260410.
const FdaDate = z
  .string()
  .transform((date) => date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'))
  .pipe(z.iso.date())

const Clearance = z.object({ k_number: z.string().min(1), applicant: z.string(), device_name: z.string(), decision_date: FdaDate })
const Recall = z.object({
  product_res_number: z.string().min(1),
  cfres_id: z.string().optional(),
  event_date_posted: FdaDate,
  recalling_firm: z.string().default(''),
  product_description: z.string().default(''),
})

const PAGE_SIZE = 1000
const CDRH = 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs'

/** A record and the openFDA page that held it. */
type Hit<T> = { record: T; ref: LogRef }

/** All records of one endpoint with our product codes, dated from `since` to today. */
async function search<T>(endpoint: '510k' | 'recall', dateField: string, since: string, record: z.ZodType<T>): Promise<Hit<T>[]> {
  const Reply = z.object({ meta: z.object({ results: z.object({ total: z.number() }) }), results: z.array(record) })
  const codes = config.fdaProductCodes.map((code) => `"${code}"`).join('+')
  const today = new Date().toISOString().slice(0, 10)
  // Built by hand: openFDA reads "+" as a space, which URLSearchParams would escape.
  const url = `${config.openFdaUrl}/${endpoint}.json?search=product_code:(${codes})+AND+${dateField}:[${since}+TO+${today}]&limit=${PAGE_SIZE}`

  const hits: Hit<T>[] = []
  for (;;) {
    const page = await fetchPage(`${url}&skip=${hits.length}`, { refresh: true })
    if (page.status === 'skipped') {
      // openFDA answers 404 when nothing matches. Anything else must not pass for "no events".
      if (page.detail === 'HTTP 404') return hits
      throw new Error(`openFDA ${endpoint} skipped: ${page.reason}${page.detail ? ` (${page.detail})` : ''}`)
    }
    const { meta, results } = Reply.parse(JSON.parse(page.text))
    const ref = { url: page.url, fetchedAt: page.fetchedAt }
    hits.push(...results.map((record) => ({ record, ref })))
    if (results.length === 0 || hits.length >= meta.results.total) return hits
  }
}

/** The CDRH database page of a 510(k) or De Novo grant (DEN… numbers have their own page). */
function cdrhSource(kNumber: string): string {
  const id = encodeURIComponent(kNumber)
  return kNumber.startsWith('DEN') ? `${CDRH}/cfpmn/denovo.cfm?id=${id}` : `${CDRH}/cfpmn/pmn.cfm?ID=${id}`
}

/** The 510(k) clearances (and De Novo grants) of our product codes decided since `sinceISO`. */
export async function fetchClearances(sinceISO: string): Promise<Clearance510k[]> {
  const since = z.iso.date().parse(sinceISO.slice(0, 10))
  const hits = await search('510k', 'decision_date', since, Clearance)
  return hits.map(({ record: c, ref }) => ({
    kNumber: c.k_number,
    applicant: c.applicant,
    deviceName: c.device_name,
    decisionDate: c.decision_date,
    cdrhUrl: cdrhSource(c.k_number),
    ref,
  }))
}

/**
 * The stored model the FDA record is about: made by a brand the company name mentions (by brand or group
 * name), and named in the device text. The longest name wins; two models with equally long names are
 * ambiguous and give none.
 */
function matchModel(company: string, device: string, brands: Brand[], models: Model[]): Model | undefined {
  const makers = new Set(
    brands.filter((brand) => [brand.name, brand.group].some((name) => containsName(company, name))).map((brand) => brand.slug),
  )
  const [best, second] = models
    .filter((model) => makers.has(model.brand))
    .map((model) => ({
      model,
      length: Math.max(0, ...[model.name, ...model.aliases].filter((name) => containsName(device, name)).map((name) => normalizeName(name).length)),
    }))
    .filter((match) => match.length > 0)
    .sort((a, b) => b.length - a.length)
  return best && best.length !== second?.length ? best.model : undefined
}

/**
 * Clearances decided and recalls posted since `sinceISO`. `matched` is false when no stored model could be
 * named; the event then has `modelSlug: null`.
 */
export async function fetchFdaEvents(sinceISO: string, brands: Brand[], models: Model[]): Promise<FdaEvent[]> {
  const since = z.iso.date().parse(sinceISO.slice(0, 10))
  const clearances = (await search('510k', 'decision_date', since, Clearance)).map((hit) => hit.record)
  // By posting date: a recall can be published long after it was initiated.
  const recalls = (await search('recall', 'event_date_posted', since, Recall)).map((hit) => hit.record)

  const found = (company: string, device: string, event: Omit<Event, 'id' | 'text' | 'modelSlug'>): FdaEvent => {
    const model = matchModel(company, device, brands, models)
    return { event: { ...event, modelSlug: model?.slug ?? null }, matched: model !== undefined }
  }
  return [
    ...clearances.map((c) =>
      found(c.applicant, c.device_name, { type: 'fda-clearance', date: c.decision_date, key: c.k_number, sources: [cdrhSource(c.k_number)] }),
    ),
    ...recalls.map((r) => {
      const source = r.cfres_id
        ? `${CDRH}/cfres/res.cfm?id=${encodeURIComponent(r.cfres_id)}`
        : `${config.openFdaUrl}/recall.json?search=product_res_number:%22${encodeURIComponent(r.product_res_number)}%22`
      return found(r.recalling_firm, r.product_description, {
        type: 'fda-recall',
        date: r.event_date_posted,
        key: r.product_res_number,
        sources: [source],
      })
    }),
  ]
}
