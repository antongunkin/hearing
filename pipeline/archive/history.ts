// What happened to a brand: 3 to 5 facts in our own words, each with a date, a link and a quote that is in its
// source, for /review. Sources are the brand's `historySources` (press releases, news, its own pages). A gone
// brand's own domain is read only as Web Archive copies. SEC EDGAR is never asked (the pipeline sends no contact
// header), and a page that redirects to sec.gov is refused.
import { z } from 'zod'
import type { OnSkip } from '@/pipeline/archive/documents'
import { hostOf, onDomain, verifyClaim } from '@/pipeline/atlas/relations'
import { MAX_QUOTE_CHARS, type ProposedRelation } from '@/pipeline/atlas/relation'
import type { OkPage } from '@/pipeline/atlas/facts'
import { forbiddenCheck } from '@/pipeline/checks/forbidden'
import { literalCheck } from '@/pipeline/checks/literal'
import { config } from '@/pipeline/config'
import { excerpt, PROMPT_TEXT_BUDGET } from '@/pipeline/excerpt'
import { findNumbers } from '@/pipeline/units'
import { fetchPage } from '@/pipeline/fetch/fetcher'
import { llm } from '@/pipeline/llm'
import { lookupApp } from '@/pipeline/sources/itunes'
import { latestCopy, WaybackError } from '@/pipeline/sources/wayback'
import { archiveUrl, citableArchiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import { loadBlocklist, type Dataset } from '@/src/lib/data/load'
import { BrandHistory, type Brand } from '@/src/lib/schema/brand'
import type { Sourced } from '@/src/lib/schema/field'
import { edgeKey } from '@/src/lib/schema/graph'
import type { CandidateChange, CheckResult } from '@/src/lib/schema/pending'

const skipLine = (url: string, reason: string, detail?: string) => console.warn(`${url} skipped: ${reason}${detail ? ` (${detail})` : ''}`)

/** The hosts of a brand's own site: its website, catalog and support pages. */
export function ownHosts(brand: Brand): string[] {
  const urls = [brand.website, ...brand.scraper.catalogUrls, ...(brand.scraper.supportUrls ?? []), ...(brand.archive?.catalogUrls ?? [])]
  return [...new Set(urls.map(hostOf).filter((host) => host !== ''))]
}

/** The page URL as it stands on the web: an archive copy is the page it copies. */
const originalOf = (url: string) => parseArchiveUrl(url)?.original ?? url

export type SourceOpts = { refresh?: boolean; onSkip?: OnSkip }

/**
 * The pages of `brand.historySources`. A gone brand's own domain and its subdomains are read only as Web
 * Archive copies (the latest copy of the page, or the copy the link names); never live. sec.gov is never
 * fetched, and a page that redirects there or to a gone domain is refused. A source that cannot be read is
 * reported to `onSkip`, which decides whether that stops anything.
 */
export async function readHistorySources(brand: Brand, opts: SourceOpts = {}): Promise<OkPage[]> {
  const gone = brand.status === 'gone'
  const goneHosts = gone ? ownHosts(brand) : []
  const isGoneHost = (url: string) => goneHosts.some((host) => onDomain(hostOf(originalOf(url)), host))
  const skip: OnSkip = opts.onSkip ?? skipLine
  // The fetcher's blocklist covers every redirect: a live page cannot lead to sec.gov or a gone brand's site.
  const blocklist = [...(await loadBlocklist()), 'sec.gov', ...goneHosts]
  const pages: OkPage[] = []

  for (const source of brand.historySources ?? []) {
    if (onDomain(hostOf(originalOf(source)), 'sec.gov')) {
      skip(source, 'blocklist', 'sec.gov is never read')
      continue
    }
    let target = source
    const named = parseArchiveUrl(source)
    if (isGoneHost(source)) {
      let copy: { timestamp: string; original: string } | null
      try {
        copy = named ?? (await latestCopy(source, opts.refresh ? { refresh: true } : {}))
      } catch (error) {
        if (error instanceof WaybackError && error.reason === 'archive-excluded') {
          skip(source, 'archive-excluded', `${config.archiveHosts[0]} does not serve this site`)
          continue
        }
        throw error
      }
      if (copy === null) {
        skip(source, 'no-archive-copy', 'no Web Archive copy of this page')
        continue
      }
      target = archiveUrl(copy.timestamp, copy.original, { raw: true })
    } else if (named !== null) {
      target = archiveUrl(named.timestamp, named.original, { raw: true })
    }

    const page = await fetchPage(target, { ...(opts.refresh && { refresh: true }), blocklist })
    if (page.status === 'skipped') {
      skip(target, page.reason, page.detail)
      continue
    }
    // A redirect may have left the page asked for.
    if (onDomain(hostOf(originalOf(page.url)), 'sec.gov') || (gone && parseArchiveUrl(page.url) === null && isGoneHost(page.url))) {
      skip(page.url, 'blocklist', 'redirected to a domain that is never read')
      continue
    }
    pages.push(page)
  }
  return pages
}

/** A lookup of the App Store was skipped: the brand's history is not drafted, the unit can be resumed. */
export class AppLookupSkipped extends Error {
  constructor(iosId: string) {
    super(`the App Store lookup of ${iosId} was skipped`)
    this.name = 'AppLookupSkipped'
  }
}

/** The iOS apps of the brand, with the names the data gives them: the `publishes` edges out of the brand, then its models' apps. */
function appsOf(brand: Brand, dataset: Dataset): { iosId: string; name: string }[] {
  const from = `brand:${brand.slug}`
  const apps = new Map<string, string>()
  for (const edge of dataset.graph.edges) {
    if (edge.kind !== 'publishes' || edge.from !== from) continue
    const entity = dataset.graph.entities.find((e) => e.id === edge.to)
    if (entity?.iosId !== undefined) apps.set(entity.iosId, entity.name)
  }
  for (const model of dataset.models.filter((m) => m.brand === brand.slug)) {
    if (model.app?.iosId !== undefined && !apps.has(model.app.iosId)) apps.set(model.app.iosId, model.app.name)
  }
  return [...apps].map(([iosId, name]) => ({ iosId, name }))
}

/**
 * Whether the brand's app is still on the App Store: the first app found (published by the brand in the graph,
 * or a model's app) is looked up. A record is available; no record at all ("app removed from the App Store") is
 * not. No app is undefined; a skipped lookup is an error, never "no app".
 */
export async function appStatus(brand: Brand, dataset: Dataset): Promise<BrandHistory['app']> {
  const [first] = appsOf(brand, dataset)
  if (first === undefined) return undefined
  const record = await lookupApp(first.iosId)
  if (record === null) throw new AppLookupSkipped(first.iosId)
  if (record === 'removed') {
    return { name: first.name, iosId: first.iosId, available: false, checkedAt: new Date().toISOString(), sourceUrl: `${config.itunesLookupUrl}?id=${encodeURIComponent(first.iosId)}` }
  }
  return { name: record.name, iosId: first.iosId, available: true, checkedAt: record.fetchedAt, sourceUrl: record.url }
}

const Draft = z.strictObject({
  facts: z.array(z.strictObject({ date: z.string(), text: z.string(), sourceIndex: z.number().int(), quote: z.string() })),
  relations: z.array(
    z.strictObject({
      kind: z.enum(['owns', 'renamed-to']),
      subject: z.string().min(1),
      subjectKind: z.enum(['brand', 'company']),
      object: z.string().min(1),
      objectKind: z.enum(['brand', 'company']),
      since: z.string().regex(/^\d{4}(-\d{2})?$/).optional(),
      sourceIndex: z.number().int(),
      quote: z.string(),
    }),
  ),
})

const DATE = /^\d{4}-\d{2}(-\d{2})?$/
const FOCUS = /clos|bankrupt|insolven|liquidat|acquir|acquisition|sold|sale|merg|discontinu|wound|ceas|app\b|service|support|warranty|repair|rename|rebrand/gi
const COPIED_RUN = 12
/** Words that accuse or characterise a company: a fact may use one only when its quote does (by the stem). */
const LOADED = [/bankrupt/, /insolven/, /fraud/, /lawsuit/, /\bsued\b/, /\brecall/, /\bscam/, /investigat/, /shut(?:ting)? down/, /closed down/]
function loadedTermsMissing(text: string, quote: string): string | undefined {
  const [t, q] = [normal(text), normal(quote)]
  return LOADED.find((term) => term.test(t) && !term.test(q))?.source
}
const normal = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** Whether `text` repeats a run of `COPIED_RUN` words of the source: a copied sentence is not our own words. */
function copiesSource(text: string, source: string): boolean {
  const words = normal(text).split(' ')
  const haystack = ` ${normal(source)} `
  for (let i = 0; i + COPIED_RUN <= words.length; i++) {
    if (haystack.includes(` ${words.slice(i, i + COPIED_RUN).join(' ')} `)) return true
  }
  return false
}

/**
 * Claude reads the pages and writes the brand's fate in its own words: closure, sale or merger, whether the app
 * still works, where to get service. A fact stays when its quote is on its page, is short, and its text has a
 * `YYYY-MM[-DD]` date, passes `forbiddenCheck` and is not a copy of the page; fewer than 3 left is no draft, more
 * than 5 are cut to the first 5. The draft is a `brand-history` change (always reviewed). A relation (a sale, a
 * rename) stays under the same quote check and when `sourceKindFor` accepts its source.
 */
export async function draftHistory(
  brand: Brand,
  pages: OkPage[],
  app?: BrandHistory['app'],
  brands: Brand[] = [brand],
): Promise<{ change: CandidateChange | null; relations: ProposedRelation[] }> {
  if (pages.length === 0) return { change: null, relations: [] }
  const each = Math.floor(PROMPT_TEXT_BUDGET / pages.length)
  const sources = pages.map((page, i) => `[Source ${i + 1}] ${page.url}\n${excerpt(page.text, each, FOCUS)}`).join('\n\n')
  const appLine =
    app === undefined
      ? 'The brand has no app on record.'
      : app.available
        ? `The App Store still lists the app "${app.name}".`
        : `The app "${app.name}": app removed from the App Store.`
  const prompt = `Write what happened to the hearing aid brand "${brand.name}"${brand.group ? ` (group: ${brand.group})` : ''} from the sources below. Use only what they state.
Cover: whether and when the brand closed or stopped selling, a sale or merger and who owns it now, whether its app still works, and where owners get service or support.
${appLine}
Return "facts": 3 to 5 items, each with "date" ("YYYY-MM" or "YYYY-MM-DD", the date of the event), "text" (one sentence in your own words; never copy a sentence of a source), "sourceIndex" (the number N of the [Source N] that states it) and "quote" (an exact, character-for-character copy of one sentence of that source, at most ${MAX_QUOTE_CHARS} characters, that supports the fact).
Return "relations": a company or brand that owns another ("owns", subject owns object) or a brand renamed ("renamed-to"), as the source writes the names, with their kinds, "since" ("YYYY" or "YYYY-MM") only when the source gives it, "sourceIndex" and an exact "quote" naming the subject or the object. An empty list is fine.
State only what the quote says; do not characterise the company, give causes or motives, or use a word such as bankruptcy, fraud, lawsuit or recall unless the quote does. The quote must state the date of the fact (month and year).
Never claim anything was tested or tried by us.

${sources}`
  const draft = await llm({ prompt, schema: Draft, provider: 'claude', model: config.llm.claudeModel })

  const check = (quote: string, page: OkPage, value: string | null = null): CheckResult => {
    if (quote.length > MAX_QUOTE_CHARS) return { name: 'literal', ok: false, detail: 'quote is longer than a sentence' }
    const field: Sourced<string | null> = { value, quote, sourceUrl: page.url, fetchedAt: page.fetchedAt, sourceType: 'official' }
    return literalCheck(field, page.text)
  }
  const dropped = (fact: { date: string; text: string }, reason: string) => console.warn(`${brand.slug}: fact dropped (${reason}): ${fact.date} ${fact.text.slice(0, 80)}`)

  const facts: BrandHistory['facts'] = []
  for (const fact of draft.facts) {
    const page = pages[fact.sourceIndex - 1]
    if (page === undefined) {
      dropped(fact, 'no such source')
      continue
    }
    if (!DATE.test(fact.date) || fact.text.trim() === '') {
      dropped(fact, 'bad date or empty text')
      continue
    }
    // The date is looked up in the quote too: it must state that month (or day).
    const literal = check(fact.quote, page, fact.date)
    if (!literal.ok) {
      dropped(fact, `${literal.detail}`)
      continue
    }
    if (!forbiddenCheck(fact.text).ok) {
      dropped(fact, 'forbidden phrase')
      continue
    }
    const quoted = findNumbers(fact.quote).map((n) => n.value)
    if (findNumbers(fact.text).some((n) => !quoted.includes(n.value))) {
      dropped(fact, 'a number of the text is not in the quote')
      continue
    }
    const loaded = loadedTermsMissing(fact.text, fact.quote)
    if (loaded !== undefined) {
      dropped(fact, `loaded term "${loaded}" is not in the quote`)
      continue
    }
    if (copiesSource(fact.text, page.text)) {
      dropped(fact, 'copies its source')
      continue
    }
    facts.push({ date: fact.date, text: fact.text.trim(), sourceUrl: citableArchiveUrl(page.url), quote: fact.quote, fetchedAt: page.fetchedAt })
  }

  const own = [hostOf(brand.website)]
  const relations: ProposedRelation[] = []
  for (const claim of draft.relations) {
    const page = pages[claim.sourceIndex - 1]
    if (page === undefined) continue
    // An archive copy is the page it copies: the host of the original decides the source kind.
    const original = originalOf(page.url)
    const relation = verifyClaim(
      { ...claim, sourceKind: onDomain(hostOf(original), own[0]) ? 'company-page' : 'press-release' },
      page,
      { brands, ownDomains: own, citeUrl: citableArchiveUrl(page.url), kindUrl: original },
    )
    if (relation === null) continue
    if (relations.some((rel) => edgeKey(rel.edge) === edgeKey(relation.edge))) continue
    relations.push(relation)
  }

  if (facts.length < 3) return { change: null, relations }
  const after = BrandHistory.safeParse({ facts: facts.slice(0, 5), ...(app !== undefined && { app }) })
  if (!after.success) return { change: null, relations }
  const path = `brands/${brand.slug}.history`
  const change: CandidateChange = {
    kind: 'brand-history',
    modelSlug: null,
    path,
    ...(brand.history !== undefined && { before: brand.history }),
    after: after.data,
    checks: { [path]: [{ name: 'literal', ok: true }, { name: 'forbidden', ok: true }] },
    refs: [...new Set(after.data.facts.map((fact) => fact.sourceUrl))],
  }
  return { change, relations }
}
