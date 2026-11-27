// `atlas:relations`: relations between companies, brands and apps found outside the brands' own sites:
// web search claims (every one fetched and quoted from its page), FDA 510(k) applicants and app store
// sellers. Nothing here writes the graph's edges: callers queue each ProposedRelation (relation.ts).
// SEC EDGAR is never asked (the pipeline sends no contact header), so there is no SEC step.
import { z } from 'zod'
import { literalCheck } from '@/pipeline/checks/literal'
import { config } from '@/pipeline/config'
import { fetchPage } from '@/pipeline/fetch/fetcher'
import { findInLog, RAW_DIR, readBody, readLog, type FetchLogEntry } from '@/pipeline/fetch/raw-store'
import { llm } from '@/pipeline/llm'
import { fetchClearances } from '@/pipeline/sources/openfda'
import { lookupApp } from '@/pipeline/sources/itunes'
import { currentMonth, fetchableUrls } from '@/pipeline/sources/reviews'
import { loadBlocklist } from '@/src/lib/data/load'
import { containsName, normalizeName, slugify } from '@/src/lib/data/slug'
import type { Brand } from '@/src/lib/schema/brand'
import type { Sourced } from '@/src/lib/schema/field'
import type { CheckResult } from '@/src/lib/schema/pending'
import { Edge, edgeKey, Entity, type EdgeKind, type SourceKind } from '@/src/lib/schema/graph'
import { entityFor, type ProposedRelation } from './relation'
import type { Site, SiteReport } from './schema'

/** A source the unit cannot do without refused or failed (openFDA, the App Store): the unit stops and can be resumed. */
export class RelationSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelationSourceError'
  }
}

/**
 * The checks of a quote that a record states: its fetch-log line exists (`log`) and the quote is in the
 * stored body of that reply (`literal`). Without the line or body there is only a failed `log`.
 */
async function recordChecks(quote: string, ref: { url: string; fetchedAt: string }, log: FetchLogEntry[], rawDir: string): Promise<Record<string, CheckResult[]>> {
  const entry = findInLog(log, ref)
  if (entry?.bodyHash === undefined) return { quote: [{ name: 'log', ok: false, detail: 'not in the fetch log' }] }
  let text: string
  try {
    text = new TextDecoder().decode(await readBody(entry.bodyHash, rawDir))
  } catch {
    return { quote: [{ name: 'log', ok: false, detail: 'stored body cannot be read' }] }
  }
  const field: Sourced<null> = { value: null, quote, sourceUrl: ref.url, fetchedAt: ref.fetchedAt, sourceType: 'official' }
  return { quote: [{ name: 'log', ok: true }, literalCheck(field, text)] }
}

/** A longer quote is a passage of someone else's text, not the statement of a relation. */
const MAX_QUOTE_CHARS = 300
const MAX_URLS = 8

const hostOf = (url: string) => URL.parse(url)?.hostname.replace(/^www\./, '').replace(/\.$/, '').toLowerCase() ?? ''
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

/**
 * The kind a source may have, or null: `sec-filing` only on sec.gov, `fda-record` only on fda.gov,
 * `app-store` only on the App Store, `company-page` only on the companies' own domains, `press-release` on
 * any host, `third-party` only for makes-for. `crawl` is never a claim's source.
 */
export function sourceKindFor(url: string, claimed: SourceKind, edgeKind: EdgeKind, ownDomains: string[]): SourceKind | null {
  const host = hostOf(url)
  if (host === '') return null
  switch (claimed) {
    case 'sec-filing':
      return onDomain(host, 'sec.gov') ? claimed : null
    case 'fda-record':
      return onDomain(host, 'fda.gov') ? claimed : null
    case 'app-store':
      return host === 'itunes.apple.com' || host === 'apps.apple.com' ? claimed : null
    case 'company-page':
      return ownDomains.some((domain) => onDomain(host, domain.replace(/^www\./, '').toLowerCase())) ? claimed : null
    case 'press-release':
      return claimed
    case 'third-party':
      return edgeKind === 'makes-for' ? claimed : null
    case 'crawl':
      return null
  }
}

const Claim = z.strictObject({
  kind: z.enum(['owns', 'makes-for', 'publishes', 'renamed-to']),
  subject: z.string().min(1),
  subjectKind: z.enum(['brand', 'company']),
  object: z.string().min(1),
  objectKind: z.enum(['brand', 'company', 'app']),
  since: z.string().regex(/^\d{4}(-\d{2})?$/).optional(),
  url: z.string(),
  quote: z.string().min(1),
  sourceKind: z.enum(['company-page', 'press-release', 'sec-filing', 'fda-record', 'app-store', 'third-party']),
})
const Claims = z.strictObject({ claims: z.array(Claim) })

export type SearchContext = { brands: Brand[]; sites: Site[]; refresh?: boolean }

/** The domains that are a name's own: the website of the brand it names and the sites of that brand or company. */
function domainsOf(name: string, { brands, sites }: SearchContext): string[] {
  const wanted = normalizeName(name)
  const slugs = new Set(brands.filter((brand) => normalizeName(brand.name) === wanted).map((brand) => brand.slug))
  const domains = brands.filter((brand) => slugs.has(brand.slug)).map((brand) => hostOf(brand.website))
  for (const site of sites) {
    if (site.brands.some((slug) => slugs.has(slug)) || (site.company !== undefined && normalizeName(site.company) === wanted)) {
      domains.push(site.domain)
    }
  }
  return domains.filter((domain) => domain !== '')
}

/**
 * Relations a web search finds for a brand or company. Every URL is fetched through the fetcher; a claim
 * stays when its page names both sides, its quote is on the page, short and names one of them, and its
 * source kind fits the host. A page that cannot be fetched drops its claims only. sec.gov is never fetched.
 */
export async function searchClaims(subject: { name: string; kind: 'brand' | 'company' }, ctx: SearchContext): Promise<ProposedRelation[]> {
  const prompt = `Search the web about the ${subject.kind} "${subject.name}" in the hearing aid market, as of ${currentMonth()}.
List the relations that a page states in so many words, in which "${subject.name}" is the subject or the object:
- owns: the subject owns the brand or company (an acquisition, a parent company).
- makes-for: the subject makes the object's products (contract or OEM manufacturing, a private label).
- publishes: the subject publishes the app (an app store listing).
- renamed-to: the subject is now called the object.
Every claim has: subject and object as the page writes them, their kinds (brand, company or app), "since" ("YYYY" or "YYYY-MM") only when the page gives it, "url" of the page that states it, "quote": an exact, character-for-character copy of that page's text (one sentence, at most about 300 characters) that states the relation and names the subject or the object, and "sourceKind": company-page (a page of the companies' own website), press-release, sec-filing, fda-record, app-store, or third-party (an independent report; only for makes-for).
At most ${MAX_URLS} pages. Never use pages on Google, Amazon or YouTube. Only use pages the search actually returned; an empty list is a fine answer.`
  const found = await llm({ prompt, schema: Claims, provider: 'claude', tools: ['WebSearch'], model: config.llm.claudeModel })

  const normal = (url: string) => {
    const parsed = URL.parse(url)
    if (parsed) parsed.hash = ''
    return parsed?.href ?? url
  }
  // sec.gov is left out before the fetch: no request goes to it.
  const candidates = (await fetchableUrls(found.claims.map((claim) => claim.url))).filter((url) => !onDomain(hostOf(url), 'sec.gov')).slice(0, MAX_URLS)
  // A page that redirects to sec.gov is refused too.
  const blocklist = [...(await loadBlocklist()), 'sec.gov']
  const pages = new Map<string, Extract<Awaited<ReturnType<typeof fetchPage>>, { status: 'ok' }>>()
  for (const url of candidates) {
    const page = await fetchPage(url, { refresh: ctx.refresh, blocklist })
    if (page.status === 'skipped') {
      console.warn(`${subject.name}: ${url} skipped: ${page.reason}${page.detail ? ` (${page.detail})` : ''}`)
    } else {
      pages.set(url, page)
    }
  }

  const relations: ProposedRelation[] = []
  for (const claim of found.claims) {
    const page = pages.get(normal(claim.url))
    if (!page) continue
    const names = [claim.subject, claim.object]
    if (!names.every((name) => containsName(page.text, name))) continue
    if (claim.quote.length > MAX_QUOTE_CHARS || !names.some((name) => containsName(claim.quote, name))) continue
    // The relation is what the quote states in words: only the quote is looked up.
    const field: Sourced<null> = { value: null, quote: claim.quote, sourceUrl: page.url, fetchedAt: page.fetchedAt, sourceType: 'official' }
    const literal = literalCheck(field, page.text)
    if (!literal.ok) continue

    const ownDomains = names.flatMap((name) => domainsOf(name, ctx))
    const sourceKind = sourceKindFor(page.url, claim.sourceKind, claim.kind, ownDomains)
    if (sourceKind === null) continue
    const from = Entity.safeParse(entityFor(claim.subject, claim.subjectKind, ctx.brands))
    // An app is one node whichever way it was found: by its iOS id when the page's URL gives it.
    const iosId = claim.objectKind === 'app' ? /\/id(\d+)|[?&]id=(\d+)/.exec(page.url)?.slice(1).find(Boolean) : undefined
    const to = Entity.safeParse(
      iosId ? { id: `app:ios-${iosId}`, kind: 'app', name: claim.object.trim(), iosId } : entityFor(claim.object, claim.objectKind, ctx.brands),
    )
    const edge = Edge.safeParse({
      from: from.data?.id,
      to: to.data?.id,
      kind: claim.kind,
      ...(claim.since !== undefined && { since: claim.since }),
      visibility: 'internal',
      status: 'proposed',
      sources: [{ url: page.url, quote: claim.quote, fetchedAt: page.fetchedAt, kind: sourceKind }],
    })
    if (!from.success || !to.success || !edge.success || from.data.id === to.data.id) continue
    if (relations.some((rel) => edgeKey(rel.edge) === edgeKey(edge.data))) continue
    relations.push({ edge: edge.data, entities: [from.data, to.data], checks: { quote: [literal] } })
  }
  return relations
}

/**
 * One `fda-applicant` entity per distinct applicant of the hearing aid clearances since `config.onSaleSince`,
 * and a proposed `files-as` relation from a brand whose name the applicant contains, or from the group
 * company whose name it contains. The source is the openFDA page, the quote the applicant as written.
 */
export async function fdaApplicants(brands: Brand[], rawDir: string = RAW_DIR): Promise<{ entities: Entity[]; relations: ProposedRelation[] }> {
  let clearances
  try {
    clearances = await fetchClearances(config.onSaleSince)
  } catch (error) {
    // fetchClearances throws when openFDA is skipped; a bad reply is a bug and goes on up as it is.
    if (error instanceof Error && /^openFDA .* skipped/.test(error.message)) throw new RelationSourceError(error.message)
    throw error
  }

  const log = await readLog(rawDir)
  const entities = new Map<string, Entity>()
  const relations: ProposedRelation[] = []
  for (const { applicant, ref } of clearances) {
    const name = applicant.trim()
    const entity = Entity.safeParse({ id: `fda-applicant:${slugify(name)}`, kind: 'fda-applicant', name })
    if (!entity.success) continue
    entities.set(entity.data.id, entity.data)

    const owners = brands.flatMap((brand) => {
      if (containsName(name, brand.name)) return [entityFor(brand.name, 'brand', brands)]
      if (brand.group.trim() !== '' && containsName(name, brand.group)) return [entityFor(brand.group, 'company', brands)]
      return []
    })
    for (const owner of owners) {
      const from = Entity.safeParse(owner)
      const edge = Edge.safeParse({
        from: from.data?.id,
        to: entity.data.id,
        kind: 'files-as',
        visibility: 'internal',
        status: 'proposed',
        sources: [{ url: ref.url, quote: name, fetchedAt: ref.fetchedAt, kind: 'fda-record' }],
      })
      if (!from.success || !edge.success || relations.some((rel) => edgeKey(rel.edge) === edgeKey(edge.data))) continue
      relations.push({ edge: edge.data, entities: [from.data, entity.data], checks: await recordChecks(name, ref, log, rawDir) })
    }
  }
  return { entities: [...entities.values()], relations }
}

/** `publishes` relations from the brand to each iOS app of the report's pages whose seller is the brand or its group. */
export async function appPublishers(report: SiteReport, brand: Brand, rawDir: string = RAW_DIR): Promise<ProposedRelation[]> {
  const ids = [...new Set(report.pages.flatMap((page) => page.apps.ios))]
  const log = await readLog(rawDir)
  const relations: ProposedRelation[] = []
  for (const id of ids) {
    const app = await lookupApp(id)
    if (app === null) throw new RelationSourceError(`the App Store lookup of ${id} was skipped`)
    if (app === 'removed') continue
    if (!containsName(app.seller, brand.name) && !(brand.group.trim() !== '' && containsName(app.seller, brand.group))) continue

    const from = Entity.parse({ id: `brand:${brand.slug}`, kind: 'brand', name: brand.name })
    const to = Entity.safeParse({ id: `app:ios-${id}`, kind: 'app', name: app.name, iosId: id })
    const edge = Edge.safeParse({
      from: from.id,
      to: to.data?.id,
      kind: 'publishes',
      visibility: 'internal',
      status: 'proposed',
      sources: [{ url: app.lookupUrl, quote: app.seller, fetchedAt: app.fetchedAt, kind: 'app-store' }],
    })
    if (!to.success || !edge.success) continue
    relations.push({ edge: edge.data, entities: [from, to.data], checks: await recordChecks(app.seller, { url: app.lookupUrl, fetchedAt: app.fetchedAt }, log, rawDir) })
  }
  return relations
}
