# Model Archive, Documents, Brand Fate and Empty Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover every hearing aid model sold since 2018, discontinued ones included, with its on-sale status, links to its official manuals and datasheets (live or Web Archive copies), a sourced note on what happened to brands that left, and the FDA, app and predecessor/successor fields the pipeline left empty so far.

**Architecture:** Builds on the merged site-atlas plan (`docs/superpowers/plans/2026-11-27-site-atlas.md`): brand configs with `status`, `supportUrls`, `documentUrlPattern` and `archive`, the raw fetch log, the CDX client and the company graph. A new `archive` command (separate from `update`) reads support pages of live brands and Web Archive copies for gone brands and vanished pages; every change it makes carries `origin: 'archive'` and gives no feed event. `update` learns the model lifecycle (discontinued and back again, always through `/review`). The site gains a discontinued filter, banners, document lists, lineage links, a "What happened" note, an indexing rule for old models and `offers` in Product JSON-LD.

**Tech Stack:** TypeScript strict, Node 22+, Next.js 16 App Router, React 19, Zod 4, Vitest 5, jsdom, unpdf, `claude -p`.

**Spec:** `docs/superpowers/specs/2026-11-27-model-archive-design.md` (where it differs from `docs/superpowers/specs/2026-11-26-hearing-aid-comparison-site-design.md`, it wins). Its "Решения, принятые при проверке дизайна" list is binding. Brand `supportUrls`, `archive.catalogUrls`, patterns and `status` come from the atlas proposals the owner approved, never from the implementer.

## Global Constraints

- Our code sets no User-Agent header (Node/Playwright defaults), never a browser-like string or bot name; obey the robots.txt `*` group and Crawl-delay; never bypass captchas or bot protection; no stealth/anti-detect browsers; a 429 or block stops the step (resumable via `--resume`).
- Never scrape Google (incl. Shopping, Play) or Amazon. WebSearch through `claude -p` is allowed as the pipeline already does.
- No verbatim customer-review text on the site; no "tested"/first-hand claims, no "our audiologist/expert".
- Third-party values attributed ("According to <host>"); no aggregate rating; no Review/AggregateRating in JSON-LD.
- `/review` stays dev-only and loopback-only.
- Never commit `data/pending/` or `.cache/`; raw pages/PDFs never go into git (public repo).
- No personal details of the owner anywhere in code, data, README or request headers.
- LLM budget $0: `claude -p` on subscription, Ollama `qwen3:8b`, Gemini free tier; cache by content hash.
- Every task: tests pass (`npm test`), `npx tsc --noEmit` clean, `npm run build` green where site code changes.
- Scope: models sold at any time since `config.onSaleSince = '2018-01-01'` (in the live catalog, or in an archive catalog copy dated 2018-01-01 or later, or with an official release date in 2018 or later). The release year alone does not exclude a model.
- PDFs, photos and texts of others are never stored in git or served: documents are links, to the live PDF or else its Web Archive copy.
- A gone brand's live domain is never linked or fetched: links go to Web Archive copies only.
- No invented release date: official date, else a `derived` "on sale by" month from the earliest archive copy of the official model page, else empty. No "exempt from 510(k)" or similar without a source; no FDA match leaves `fda` empty.
- Brand fate notes: 3–5 facts in our own words, each with date, link and a quote that occurs literally in its source; never a retelling of an article; published only after `/review`.
- No `new-model` or `model-discontinued` event for anything the `archive` command imports. Discontinuing a model (and undoing it) always goes through `/review`.
- FDA events keep their window: `config.eventsSince = '2023-11-01'` (renamed from `releasedAfter`); records since 2018 only fill the `fda` field.
- Web Archive and SEC: `config.archiveDelayMs` (≥ 4000), the robots.txt of web.archive.org and sec.gov, for sec.gov only, `NEXT_PUBLIC_CONTACT_EMAIL` (the site contact) as the User-Agent, or the SEC part is skipped; no other host gets a User-Agent from our code, and `NEXT_PUBLIC_SITE_URL` is not required by any pipeline command. Archive copies are immutable and cached forever; CDX is asked again only with `--refresh`.
- Discontinued models: customer reviews, YouTube and hardware twins are looked up once, then only with `--refresh`; third-party prices never; app versions only while the app is on the App Store.
- A discontinued model page is indexed only with at least 3 specification rows with a source or at least 1 document; otherwise `noindex` and not in the sitemap.
- JSON-LD `offers` only for a model on sale with an official numeric price: `{ "@type": "Offer", price: <lowest official variant price>, priceCurrency: "USD", url: <that price's source page> }`, no `availability`.

## Review Focus

1. **A catalog page that was skipped (bot wall, timeout) or redesigned so that it yields no model links** — no model of that brand is proposed as discontinued in that run. Test in Task 4.
2. **The archive finds a stored model under another URL or a slightly different name** ("Audéo Paradise" vs "Paradise") — it is matched, no second model and no new-model card. Test in Task 8.
3. **A discontinued model with no competitors on sale** — its page links to no comparison page that is not built (pages are static, `dynamicParams = false`). Test in Task 13.
4. **Archive URLs in odd shapes** (4–14 digit timestamps, `id_`, `http://` originals, query strings, a non-archive URL) — the "archived copy of <month year>" label parses them or shows the plain source label, never throws. Test in Task 13.
5. **A gone brand's live domain in any URL on the site** (a model source, a document, the brand's website link) — it is shown as an archive link; the data check names any that slipped through. Tests in Tasks 8 and 14.

---

## Interfaces from the site-atlas plan (merged)

- `Brand`: `status: 'active' | 'gone'`, `scraper.{ catalogUrls, supportUrls?, modelUrlPattern, documentUrlPattern?, render }`, `archive?: { catalogUrls; modelUrlPattern? }` (`src/lib/schema/brand.ts`). `cli.ts` `scrape` skips gone brands.
- Raw store (`pipeline/fetch/raw-store.ts`): `FetchLogEntry`, `LogRef`, `readLog()`, `readBody(hash)`, `findInLog(log, ref)`. `fetchPage` ok results carry `bodyHash` and `contentType`; skip reason `'rate-limited'` for 429.
- Web Archive (`pipeline/sources/wayback.ts`): `CdxRow`, `CdxQuery`, `cdx(q, { refresh })`, `WaybackError` (`reason`), `lastCopyPerYear(rows, sinceYear)`, `copiesPerYear`. Client-safe (`src/lib/archive-url.ts`): `archiveUrl(ts, original, { raw })`, `parseArchiveUrl(url)`, `citableArchiveUrl(url)`, `archiveMonth(ts)`, `archiveCalendarUrl(original)`.
- `lookupApp(iosId): Promise<AppRecord | 'removed' | null>` (`pipeline/sources/itunes.ts`); `fetchClearances(sinceISO): Promise<Clearance510k[]>` (`pipeline/sources/openfda.ts`); `appStoreLinks(html, baseUrl)`, `pageTitle(html)` (`pipeline/fetch/html.ts`).
- `config.onSaleSince = '2018-01-01'`, `config.archiveDelayMs`, `config.archiveHosts`, `userAgentFor(host): string | undefined` (the contact address for sec.gov hosts, `undefined` elsewhere; throws for sec.gov without `NEXT_PUBLIC_CONTACT_EMAIL`) (`pipeline/config.ts`). There is no `config.userAgent`.
- Graph: `Graph`, `Edge`, `Entity`, `EdgeSource`, `edgeKey` (`src/lib/schema/graph.ts`); `Dataset.graph`; `upsertEdge`, `upsertEntity`, `writeGraph` (`pipeline/atlas/graph-store.ts`); `ProposedRelation`, `entityFor`, `queueRelation` (`pipeline/atlas/relation.ts`); `sourceKindFor` (`pipeline/atlas/relations.ts`).
- Review: pending kinds `brand-config`, `relation`; `PendingChange.refs?`; `CheckResult.name` includes `'pattern'`, `'log'`; `src/lib/data/consistency.ts` (`groupMismatches`); UI: `app/review/AtlasCard.tsx`.

---

### Task 1: Schemas, events and config for the archive

**Kind:** mechanical.

**Files:**
- Modify: `src/lib/schema/{field,model,brand,event,pending}.ts`, `src/lib/site/format.ts` (`EVENT_LABELS`), `pipeline/apply.ts` (`templateText`), `pipeline/config.ts`, `pipeline/cli.ts:171-181`, `pipeline/sources/brand-site.ts:409-417`, `tests/pipeline/brand-site.test.ts:436`, `README.md` (config names)
- Test: `tests/lib/schema.test.ts`, `tests/pipeline/apply.test.ts`

**Interfaces:**
- `field.ts`: `YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)`; `Derivation.op` gains `'earliest-archive-copy'` (input: the archive timestamp).
- `model.ts`:
  - `ModelDocument = z.strictObject({ kind: z.enum(['user-guide', 'datasheet', 'other']), title: z.string().min(1), url: HttpUrl, fetchedAt: IsoDateTime })`
  - `Lineage = z.strictObject({ slug: Slug, source: sourced(z.string()) })` — `predecessor?` and `successor?` become `Lineage` (both were plain strings and are empty in `data/`).
  - `discontinued?: z.strictObject({ lastListed: YearMonth.optional(), source: sourced(z.string()) })` — absent means on sale; `source.value` is the model name as listed.
  - `documents: z.array(ModelDocument).default([])`
- `brand.ts`: `HistoryFact = z.strictObject({ date: /^\d{4}-\d{2}(-\d{2})?$/, text: z.string().min(1), sourceUrl: HttpUrl, quote: z.string().min(1), fetchedAt: IsoDateTime })`; `BrandHistory = z.strictObject({ facts: z.array(HistoryFact).min(3).max(5), app: z.strictObject({ name: z.string(), iosId: z.string(), available: z.boolean(), checkedAt: IsoDateTime, sourceUrl: HttpUrl }).optional() })`; `Brand` gains `history?: BrandHistory`, `historySources?: HttpUrl[]`, `secCik?: /^\d{10}$/`.
- `event.ts`: type `'model-discontinued'`; `EVENT_LABELS['model-discontinued'] = 'Discontinued'`; template `"<product> is no longer listed by its maker."`.
- `pending.ts`: `CandidateChange.kind` gains `'document'`, `'discontinued'`, `'brand-history'`; `PendingChange.kind` gains `'brand-history'`; both gain `origin?: 'archive'`; `CheckResult.name` gains `'lifecycle'`, `'document'`.
- `config.ts`: `releasedAfter` renamed `eventsSince` (value `'2023-11-01'`), every use updated.

- [ ] **Step 1: Write the failing tests**

```ts
test('a model may be discontinued with or without a month, and lists documents', () => {
  const m = Model.parse({ ...base, discontinued: { source: listed }, documents: [{ kind: 'user-guide', title: 'Paradise user guide', url: 'https://www.phonak.com/x.pdf', fetchedAt: T }] })
  expect(m.discontinued?.lastListed).toBeUndefined()
  expect(Model.parse(base).documents).toEqual([])
  expect(Model.safeParse({ ...base, discontinued: { lastListed: '2023-13', source: listed } }).success).toBe(false)
})
test('predecessor and successor need a source', () => {
  expect(Model.safeParse({ ...base, successor: 'phonak-lumity' }).success).toBe(false)
})
test('a brand history has 3 to 5 sourced facts', () => {})
test('a derived release date may cite the earliest archive copy', () => {})
test('model-discontinued has a label and a template sentence', async () => {})
```

- [ ] **Step 2: Run** `npm test -- schema apply` → FAIL.
- [ ] **Step 3: Implement**; fix any typed `Model` literal in tests that `tsc` flags for `documents`.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run build` → green.
- [ ] **Step 5: Commit** `git commit -m "feat(schema): discontinued models, documents, sourced lineage, brand history"`

---

### Task 2: Lifecycle rules, archive queries and the archive-date check

**Kind:** mechanical (pure functions, rules from the spec).

**Files:**
- Create: `pipeline/archive/lifecycle.ts`, `pipeline/checks/archive-date.ts`
- Modify: `pipeline/sources/wayback.ts`, `pipeline/sources/brand-site.ts` (remove `isInScope` and the `no-release-date` check), `pipeline/cli.ts` (import `isInScope` from lifecycle)
- Test: `tests/pipeline/lifecycle.test.ts`, `tests/pipeline/wayback.test.ts`, `tests/pipeline/brand-site.test.ts`

**Interfaces:**
- `wayback.ts`:
  - `yearlyCopies(url: string, opts?: { refresh?: boolean }): Promise<CdxRow[]>` — `cdx({ url, from: '2018', filters: ['statuscode:200'], collapse: 'timestamp:6' })` then `lastCopyPerYear(rows, 2018)`: the latest 200 copy of each year. (The spec's `collapse=timestamp:4` gives the first copy of a year; the latest one dates `lastListed` correctly.)
  - `pdfCopies(domain: string, opts?): Promise<CdxRow[]>` — `{ url: domain, matchType: 'domain', filters: ['mimetype:application/pdf', 'statuscode:200'], collapse: 'urlkey' }`.
  - `earliestCopy(url: string, opts?): Promise<CdxRow | null>` (`limit: 1`), `latestCopy(url: string, opts?): Promise<CdxRow | null>` (`limit: -1`), both with `filters: ['statuscode:200']`.
- `lifecycle.ts` (`type OkPage = Extract<FetchResult, { status: 'ok' }>`):
  - `type Listing = { month: string; sourceUrl: string; fetchedAt: string; quote: string }`
  - `listingIn(model: Pick<Model, 'brand' | 'name' | 'aliases'>, page: OkPage): Listing | null` — the first line of `page.text` for which `namesModel` holds; `month` from the archive timestamp of `page.url` when it is an archive copy, else `fetchedAt.slice(0, 7)`; `sourceUrl` = `citableArchiveUrl(page.url)`.
  - `type ScopeEvidence = { inLiveCatalog?: boolean; archiveListings?: Listing[] }`
  - `isInScope(model: Model, evidence?: ScopeEvidence): boolean` — true when `inLiveCatalog`, or a listing has `month >= '2018-01'`, or an official (`sourceType: 'official'`) `releaseDate` is not before 2018 at its own precision. Otherwise false.
  - `type Lifecycle = { kind: 'on-sale' } | { kind: 'discontinued'; lastListed?: string; source: Sourced<string> } | { kind: 'orphan'; source: Sourced<string> }`
  - `lifecycleOf(model: Pick<Model, 'brand' | 'name' | 'aliases'>, e: { inLiveCatalog: boolean; listings: Listing[]; liveProductPage?: OkPage; namingPage?: OkPage }): Lifecycle | null` — in the live catalog → on sale; a live product page outside it → orphan; else the latest listing → discontinued with `lastListed`; else a page naming it (a support page) → discontinued without a month; else null. Sources are `{ value: model.name, quote, sourceUrl, fetchedAt, sourceType: 'official' }`.
- `archive-date.ts`: `archiveDateCheck(field: Sourced<string>, pageText: string): CheckResult` (name `'literal'`) — ok when `derivation.op === 'earliest-archive-copy'`, `parseArchiveUrl(field.sourceUrl)?.timestamp === derivation.input`, `field.value === archiveMonth(derivation.input)` and the quote occurs in `pageText`.

- [ ] **Step 1: Write the failing tests**

```ts
test.each([
  [{ inLiveCatalog: true }, undatedModel, true],
  [{ archiveListings: [listing('2019-06')] }, undatedModel, true],   // a 2016 model still sold in 2019 is in
  [{ archiveListings: [listing('2017-11')] }, undatedModel, false],
  [{}, modelReleased('2018-03'), true],
  [{}, undatedModel, false],                                          // support page only, no date
])('isInScope %#', (evidence, model, expected) => expect(isInScope(model, evidence)).toBe(expected))
test('lifecycleOf follows the spec order', () => {
  expect(lifecycleOf(m, { inLiveCatalog: true, listings: [] })).toEqual({ kind: 'on-sale' })
  expect(lifecycleOf(m, { inLiveCatalog: false, listings: [], liveProductPage: page })?.kind).toBe('orphan')
  expect(lifecycleOf(m, { inLiveCatalog: false, listings: [listing('2021-04'), listing('2022-09')] })).toMatchObject({ kind: 'discontinued', lastListed: '2022-09' })
  expect(lifecycleOf(m, { inLiveCatalog: false, listings: [], namingPage: support })).toMatchObject({ kind: 'discontinued' })
  expect(lifecycleOf(m, { inLiveCatalog: false, listings: [] })).toBeNull()
})
test('yearlyCopies asks one 200 copy per month and keeps the latest of each year', async () => {
  expect(vi.mocked(fetchPage).mock.calls[0][0]).toContain('collapse=timestamp%3A6')
})
test('archiveDateCheck ties the month to the timestamp in the URL', () => {})
test('a model without a release date is no longer flagged no-release-date', async () => {})
```

- [ ] **Step 2: Run** `npm test -- lifecycle wayback brand-site` → FAIL.
- [ ] **Step 3: Implement**; `scrape` in `cli.ts` calls `isInScope(candidate.model, { inLiveCatalog: true })` until Task 4 passes the real evidence.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(archive): lifecycle and scope rules, yearly archive copies"`

---

### Task 3: Applying lifecycle, documents, lineage and brand history

**Kind:** integration (`apply.ts`, `apply-decision.ts`; the review cards for these kinds come in Task 14).

**Files:**
- Modify: `pipeline/apply.ts` (`ENTRY_KEYS`, `entryChange`, `diffModel`, `AUTO_KINDS`, `pendingKind`, `changedModel`, `planChange`), `src/lib/review/apply-decision.ts` (`changeKind`)
- Test: `tests/pipeline/apply.test.ts`, `tests/lib/apply-decision.test.ts`

**Interfaces:**
- Conventions: discontinuation → kind `discontinued`, path `discontinued`, `after` the `discontinued` object or `null` (back on sale). Document → kind `document`, path `documents.<index>` (an entry list keyed by `url`; a replacement has `before` = the old entry). Lineage → kind `spec-change`, path `predecessor` or `successor`, `after: Lineage`. Brand history → kind `brand-history`, `modelSlug: null`, path `brands/<slug>.history`, `after: BrandHistory`.
- `ENTRY_KEYS` gains `documents: 'url'`; `entryChange` names the entry by `(before ?? after)[key]`, so a replaced document is found by its old URL.
- `diffModel` proposes each candidate document whose URL (or, for an archive copy, its original) the stored model does not have, as `document` at the next index with the candidate's checks from `fieldChecks['documents.<i>']`. It never removes documents.
- `AUTO_KINDS` gains `document`. `pendingKind`: `brand-history` stays; `discontinued` is `spec-change`, or `failed-check` when a check failed (an orphan carries a failed `lifecycle` check `orphan-product-page`).
- `changedModel`: `after === null` on a plain path deletes the key.
- `planChange`:
  - `discontinued` with `after` and no `before`, and `origin` not `'archive'` → event `model-discontinued` (key = slug, sources = `[after.source.sourceUrl]`); `after === null` → no event.
  - `new-model` with `origin: 'archive'` → the model, no event.
  - `predecessor`/`successor` → writes both models: the counterpart (by `after.slug`) gets the reverse field with the same source; an unknown counterpart throws.
  - `brand-history` → `brands/<slug>.json` with `history` set (`Brand.parse`).
- `changeKind` returns `discontinued` for path `discontinued`, `document` for `documents.<n>`, `brand-history` as stored. `fingerprint` and `route` unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
test('archive-imported changes give no event', () => {
  expect(planChange({ ...newModel, origin: 'archive' }, data).events).toEqual([])
  expect(planChange({ ...discontinue, origin: 'archive' }, data).events).toEqual([])
})
test('approving a discontinuation from update writes it and gives model-discontinued', () => {
  expect(applyDecision(data, discontinueId, { action: 'approve' }).newEvents).toMatchObject([{ type: 'model-discontinued', modelSlug: 'phonak-paradise' }])
})
test('a discontinuation is never applied automatically', () => {
  expect(route({ ...discontinue, checks: {} }, [])).toBe('pending')
})
test('back on sale removes discontinued, with no event', () => {})
test('a new document passing its checks is applied automatically; a failed one is reviewed', () => {})
test('a replaced document takes the place of the old one', () => {})
test('approving a successor writes both models', () => {
  const { writes } = applyDecision(data, successorId, { action: 'approve' })
  expect(writes.map((w) => w.path).sort()).toEqual(['models/phonak-lumity.json', 'models/phonak-paradise.json'])
})
test('approving a brand history writes the brand', () => {})
test('approving a new model without its discontinued field or one document leaves them out whole', () => {}) // skipPaths ['discontinued', 'documents.0']
```

- [ ] **Step 2: Run** `npm test -- apply apply-decision` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run build` → green.
- [ ] **Step 5: Commit** `git commit -m "feat(apply): discontinuation, documents, lineage and brand history changes"`

---

### Task 4: Model lifecycle in `update`

**Kind:** integration.

**Files:**
- Create: `pipeline/archive/catalog-history.ts`
- Modify: `pipeline/sources/brand-site.ts` (`ModelSources.inCatalog`), `pipeline/cli.ts` (`scrape`)
- Test: `tests/pipeline/cli.test.ts`, `tests/pipeline/brand-site.test.ts`, `tests/pipeline/catalog-history.test.ts`

**Interfaces:**
- Consumes: `isInScope`, `lifecycleOf`, `listingIn` (Task 2); `readLog`, `readBody` (atlas plan); conventions of Task 3.
- `ModelSources` gains `inCatalog: boolean` — true when a `catalogUrls` page links the model page (a page linked from both kinds of pages is in the catalog).
- `priorCatalogCopies(urls: string[], before: string): Promise<OkPage[]>` (`catalog-history.ts`) — ok log entries for those URLs fetched before `before` (the run's start), newest first, as pages (`visibleText` of the stored body; `url` = `finalUrl ?? url`).
- `scrape`, per active brand:
  - The catalog is complete when no `catalogUrls` page was skipped and at least one discovered model is `inCatalog`.
  - A new candidate is kept when `isInScope(model, { inLiveCatalog })`; left out otherwise, logged `<slug>: not sold since 2018 by its sources, left out`.
  - With a complete catalog: a stored model without `discontinued` that no `inCatalog` candidate matched gets `lifecycleOf` with `listings` from `priorCatalogCopies(brand.scraper.catalogUrls, runStart)` and, as `liveProductPage`, its own official page (the most frequent `sourceUrl` matching `modelUrlPattern`, fetched with `refresh`) when that still answers 200 without redirecting; `discontinued` → change (kind `discontinued`); `orphan` → the same change with a failed check `{ name: 'lifecycle', ok: false, detail: 'orphan-product-page' }`; null → logged, no change.
  - A stored model with `discontinued` that an `inCatalog` candidate matches → `discontinued` change with `after: null`.
  - With an incomplete catalog: no lifecycle change for the brand, logged `<slug>: catalog incomplete, lifecycle not checked`.

- [ ] **Step 1: Write the failing tests**

```ts
test('a model missing from a complete catalog is proposed as discontinued, for review', async () => {
  expect(pending('phonak-paradise-discontinued')).toMatchObject({ kind: 'spec-change', path: 'discontinued' })
})
test('lastListed is the month of the latest earlier catalog copy that named it', async () => {})
test('a skipped catalog page, or no model links at all, proposes no discontinuation', async () => {
  expect(pendingPaths()).not.toContain('discontinued')
})
test('a live product page outside the catalog is flagged orphan-product-page', async () => {})
test('a discontinued model back in the catalog gets its discontinuation removed through review', async () => {})
test('a support-only model without an official date since 2018 is left out', async () => {})
test('inCatalog is true only for links from catalog pages', async () => {}) // brand-site.test
```

- [ ] **Step 2: Run** `npm test -- cli brand-site catalog-history` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(update): discontinued and back-on-sale proposals from the live catalog"`

---

### Task 5: Predecessor, successor and app links from official pages

**Kind:** integration (extraction prompt plus CLI wiring).

**Files:**
- Modify: `pipeline/sources/brand-site.ts` (`Extraction`, `PROMPT`, `ModelCandidate`, `extractModel`), `pipeline/cli.ts` (`scrape`)
- Test: `tests/pipeline/brand-site.test.ts`, `tests/pipeline/cli.test.ts`

**Interfaces:**
- Consumes: `appStoreLinks`, `lookupApp` (atlas plan); `literalCheck`, `containsName`, `matchExistingModel`.
- `Extraction` gains `predecessor?` and `successor?`: `{ name: string; quote: string; sourceIndex: number }`; prompt line: "predecessor / successor: only if a source says this model replaces or is replaced by another model (such as "successor to Paradise", "replaces"); name that model as written."
- `ModelCandidate` gains `lineage?: { predecessor?: { name: string; source: Sourced<string> }; successor?: { name: string; source: Sourced<string> } }` and `appIds?: { ios: string[]; android: string[] }` (from the pages' HTML). A lineage entry is kept when its quote passes `literalCheck`, contains the other name (`containsName`) and matches `LINEAGE_CUE = /\b(?:successor|succeeds|replaces|replacing|predecessor|next generation of|follow-up to)\b/i`.
- `scrape`: a lineage name resolved to a stored model of the same brand (`matchExistingModel` on a stub with that name) gives a `spec-change` at `predecessor`/`successor` (`after: { slug, source }`); unresolved names are logged and dropped. Exactly one iOS id (and at most one Android id) on the model's pages, different from the stored `app.iosId`, gives a `spec-change` at `app` with `after: { name: <lookupApp name>, iosId, androidUrl? }` (`androidUrl` = `https://play.google.com/store/apps/details?id=<id>`); `'removed'` or null from `lookupApp`, or two ids, give none.

- [ ] **Step 1: Write the failing tests**

```ts
test('a successor named in an official quote with a cue word is proposed', async () => {
  expect(pending('phonak-paradise-successor')?.after).toMatchObject({ slug: 'phonak-lumity' })
})
test('a lineage quote without a cue word, or naming an unknown model, is dropped', async () => {})
test('one App Store link gives an app proposal named by iTunes Lookup', async () => {})
test('two different App Store ids give no app proposal', async () => {})
test('one app update still gives one event per iosId', async () => {}) // existing rule, kept
```

- [ ] **Step 2: Run** `npm test -- brand-site cli` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(scrape): sourced predecessor, successor and app links"`

---

### Task 6: Documents

**Kind:** mechanical (rules fixed below).

**Files:**
- Create: `pipeline/archive/documents.ts`
- Modify: `pipeline/sources/brand-site.ts` (export `linkDocuments`), `pipeline/cli.ts` (`scrape`: documents of each candidate)
- Test: `tests/pipeline/documents.test.ts`, `tests/pipeline/cli.test.ts`

**Interfaces:**
- Consumes: `ModelDocument` (Task 1); `latestCopy` (Task 2); `parseArchiveUrl`, `citableArchiveUrl`, `archiveUrl` (atlas plan); `namesModel`.
- `documentKind(url: string, text: string): ModelDocument['kind']` — `/user.?guide|manual|instructions/i` in the file name or first 500 characters → `user-guide`; `/data.?sheet|spec(?:ification)?s?\b/i` → `datasheet`; else `other`.
- `documentTitle(url: string, text: string): string` — the first non-empty line of the text, at most 120 characters, else the file name without extension and with `-`/`_` as spaces.
- `checkDocument(brand: Brand, model: Pick<Model, 'brand' | 'name' | 'aliases'>, url: string, opts?: { refresh?: boolean }): Promise<{ document: ModelDocument; checks: CheckResult[] } | null>` — the three checks (all named `'document'`): the original URL (`parseArchiveUrl(url)?.original ?? url`) matches `brand.scraper.documentUrlPattern`; `fetchPage` returned ok with a PDF `contentType`; `namesModel(text, model)`. Null when the PDF could not be fetched; `document.url` is the live URL or `citableArchiveUrl` of the copy.
- `replaceDeadDocuments(model: Model, opts?): Promise<CandidateChange[]>` — each live document fetched with `refresh`; a skip with `detail` `HTTP 404` or `HTTP 410` and a `latestCopy` of it → `document` change with `before` = the old entry, `after` = the archive copy; no copy → no change.
- `scrape`: documents of the candidate's `documentUrls` that pass `checkDocument` go into a new model's `documents` (with checks under `documents.<i>`), or become `document` changes of a stored model through `diffModel` (Task 3).

- [ ] **Step 1: Write the failing tests**

```ts
test('a PDF is a document only if it matches the pattern, downloads and names the model', async () => {
  expect((await checkDocument(phonak, paradise, otherModelPdf))?.checks.find((c) => !c.ok)?.detail).toBe('the document does not name the model')
})
test.each([
  ['https://x.test/Phonak_Audeo_P_User_Guide.pdf', '', 'user-guide'],
  ['https://x.test/audeo-p-datasheet.pdf', '', 'datasheet'],
  ['https://x.test/brochure.pdf', 'Hearing better', 'other'],
])('documentKind(%s)', (url, text, kind) => expect(documentKind(url, text)).toBe(kind))
test('a dead live PDF is replaced by its archived copy; without a copy it stays', async () => {})
test('a new model carries its documents; a stored model gets automatic document changes', async () => {})
```

- [ ] **Step 2: Run** `npm test -- documents cli` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(archive): official manuals and datasheets as model documents"`

---

### Task 7: The `archive` command and support pages

**Kind:** integration.

**Files:**
- Modify: `pipeline/cli.ts` (command `archive`, `main` stops on a refused archive host), `package.json` (`"archive": "tsx pipeline/cli.ts archive"`), `README.md` ("Run the pipeline": the archive command)
- Test: `tests/pipeline/cli.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 6; `discoverModelUrls`, `extractModel`, `mergeCandidates`, `matchExistingModel`.
- `archive` is not part of `update`; it takes `--brand`, `--limit` (model pages per brand), `--resume`, `--refresh`, progress in `.cache/progress/archive.json`. Units per brand, in order: `archive-support:<slug>` (Task 7), `archive-wayback:<slug>` (Task 8), `archive-history:<slug>` (Task 10), `archive-documents:<slug>` (`replaceDeadDocuments` of its stored models).
- Every change the command makes has `origin: 'archive'`.
- `main`: a `WaybackError` with reason `rate-limited` or `bot-protection`, or a `rate-limited`/`bot-protection` skip of a support page, stops the command like a usage limit: summary, then `<host> refused requests. Resume later: npm run archive -- --resume […]`, exit 2.
- `archive-support:<slug>` (active brands with `supportUrls`): `discoverModelUrls` on a copy of the brand whose `catalogUrls` are empty; each model page plus its documents through `extractModel`; a candidate matching no stored model and in scope (`isInScope(model, {})`: an official 2018+ date) becomes a `new-model` change with `discontinued` from `lifecycleOf(..., { inLiveCatalog: false, listings: [], namingPage: <the support page> })` and its checked documents; a candidate matching a stored model only adds documents.

- [ ] **Step 1: Write the failing tests**

```ts
test('archive is its own command and not part of update', async () => {
  await main(['update'], opts)
  expect(yearlyCopies).not.toHaveBeenCalled()
})
test('a support-only model with an official 2018+ date becomes a dateless discontinued card', async () => {
  expect(pending('phonak-marvel-model')?.after).toMatchObject({ discontinued: { source: { sourceUrl: SUPPORT } } })
  expect(pending('phonak-marvel-model')?.origin).toBe('archive')
})
test('a 429 from an archive host stops the command with a resume hint; --resume skips finished brands', async () => {
  expect(await main(['archive'], opts)).toBe(2)
  expect(errors.join('\n')).toContain('npm run archive -- --resume')
})
test('--brand and --limit narrow the run', async () => {})
```

- [ ] **Step 2: Run** `npm test -- cli` → FAIL.
- [ ] **Step 3: Implement** the command, the support unit and the `main` change.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(archive): archive command and support pages of live brands"`

---

### Task 8: Web Archive step

**Kind:** integration.

**Files:**
- Create: `pipeline/archive/wayback-models.ts`
- Modify: `pipeline/cli.ts` (unit `archive-wayback:<slug>`), `src/lib/data/consistency.ts`
- Test: `tests/pipeline/wayback-models.test.ts`, `tests/lib/data-consistency.test.ts`

**Interfaces:**
- Consumes: `yearlyCopies`, `latestCopy`, `earliestCopy`, `pdfCopies`, `listingIn`, `lifecycleOf`, `isInScope`, `archiveDateCheck` (Task 2); `checkDocument` (Task 6); `linkDocuments`, `extractModel`, `mergeCandidates`, `matchExistingModel`.
- `archiveCandidates(brand: Brand, models: Model[], opts: { limit: number; refresh: boolean; liveModelUrls: Set<string> }): Promise<CandidateChange[]>` — for gone brands, and for active brands with `archive.catalogUrls`:
  1. catalog copies: `yearlyCopies` of each `archive.catalogUrls` (gone brand without `archive`: its `scraper.catalogUrls`), read as `archiveUrl(ts, url, { raw: true })`;
  2. model links: links of the copies whose original matches `archive.modelUrlPattern ?? scraper.modelUrlPattern`, minus `liveModelUrls` (for an active brand, the `inCatalog` URLs of a cached `discoverModelUrls`: update handles those);
  3. each model page: its `latestCopy`, read raw, passed to `extractModel` with `url` = `citableArchiveUrl`; candidates merged with `mergeCandidates`;
  4. a candidate matching a stored model (`matchExistingModel`) gives no `new-model`: only its new documents, a derived release date when the stored one is missing (pending `spec-change`), and, for a gone brand, a `discontinued` change when the stored model has none;
  5. a new candidate needs `isInScope(model, { archiveListings })`, where listings come from `listingIn` over the catalog copies; it gets `discontinued` from `lifecycleOf(..., { inLiveCatalog: false, listings })`;
  6. release date when no official one: `earliestCopy(<model page original>)`, read raw, `listingIn` for the quote → `{ value: archiveMonth(ts), sourceUrl: citableArchiveUrl, quote, fetchedAt, sourceType: 'derived', derivation: { op: 'earliest-archive-copy', input: ts } }` with `fieldChecks.releaseDate = [archiveDateCheck(...)]`; no naming line → no date;
  7. documents: `pdfCopies(<website host without www.>)`, originals matching `documentUrlPattern`, given to models with `linkDocuments`, each copy through `checkDocument`.
  Archive copies (`/web/<ts>id_/…`) are always read with `refresh: false` (they never change); CDX queries take the run's `--refresh`.
  Every request of a gone brand goes to `web.archive.org`; a URL on the brand's own host is turned into an archive URL or dropped, never fetched.
- `liveLinksOfGoneBrands(dataset: Dataset): string[]` (`consistency.ts`) — every sourced `sourceUrl` and document `url` of a gone brand's models whose host is the brand website's host (with or without `www.`).

- [ ] **Step 1: Write the failing tests**

```ts
test('reads the latest copy of each year since 2018 and the latest copy of each model page', async () => {})
test('a stored model found under another URL or name gives no new-model card', async () => {
  expect(changes.filter((c) => c.kind === 'new-model')).toEqual([])
})
test('new models are discontinued with lastListed from the latest listing, origin archive', async () => {})
test('a model listed only before 2018 is left out', async () => {})
test('without an official date the earliest copy gives an "on sale by" month', async () => {
  expect(model.releaseDate).toMatchObject({ value: '2019-02', sourceType: 'derived', derivation: { op: 'earliest-archive-copy', input: '20190214000000' } })
})
test('a gone brand never requests its own domain', async () => {
  expect(vi.mocked(fetchPage).mock.calls.every(([url]) => new URL(url).hostname === 'web.archive.org')).toBe(true)
})
test('archived PDFs that match the pattern and name the model become documents', async () => {})
test('liveLinksOfGoneBrands names a live link of a gone brand', () => {})
test('data/ has no live link of a gone brand', async () => {
  expect(liveLinksOfGoneBrands(await loadDataset('data'))).toEqual([])
})
```

- [ ] **Step 2: Run** `npm test -- wayback-models data-consistency` → FAIL.
- [ ] **Step 3: Implement** per Interfaces and wire the unit in `cli.ts`.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(archive): discontinued models and documents from Web Archive copies"`

---

### Task 9: FDA status and 510(k) number

**Kind:** mechanical.

**Files:**
- Modify: `pipeline/sources/openfda.ts` (export `matchModel`), `pipeline/cli.ts` (`fda`)
- Test: `tests/pipeline/cli.test.ts`, `tests/pipeline/sources.test.ts`

**Interfaces:**
- Consumes: `fetchClearances` (atlas plan); `literalCheck`.
- `matchModel(company: string, device: string, brands: Brand[], models: Model[]): Model | undefined` (exported, unchanged logic).
- `fda` step: events as before since `config.eventsSince`; then `fetchClearances(config.onSaleSince)`; per stored model of the selected brands, its latest matching clearance gives a `spec-change` at `fda` when it differs from the stored one: `{ value: { status: kNumber.startsWith('DEN') ? 'De Novo granted' : '510(k) cleared', k510: kNumber }, sourceUrl: cdrhUrl, quote: deviceName, fetchedAt: ref.fetchedAt, sourceType: 'official' }`, checks `{ fda: [literal check of the quote against the record's JSON text] }`. Always pending (`spec-change`). No match → nothing.

- [ ] **Step 1: Write the failing tests**

```ts
test('a clearance naming a stored model proposes its fda field for review', async () => {
  expect(pending('phonak-lumity-fda')?.after).toMatchObject({ value: { status: '510(k) cleared', k510: 'K231234' } })
})
test('without a matching record fda stays empty', async () => {})
test('feed events still start at eventsSince', async () => {
  expect(fetchFdaEvents).toHaveBeenCalledWith('2023-11-01', expect.anything(), expect.anything())
})
```

- [ ] **Step 2: Run** `npm test -- cli sources` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(fda): fill the FDA status from 510(k) records since 2018"`

---

### Task 10: What happened to the brand

**Kind:** integration / judgment (prompt).

**Files:**
- Create: `pipeline/archive/history.ts`
- Modify: `pipeline/cli.ts` (unit `archive-history:<slug>`)
- Test: `tests/pipeline/history.test.ts`

**Interfaces:**
- Consumes: `BrandHistory` (Task 1); `lookupApp`, `userAgentFor`, `sourceKindFor`, `queueRelation`, `entityFor` (atlas plan); `literalCheck`, `forbiddenCheck`, `excerpt`.
- `secFilings(cik: string): Promise<OkPage[]>` — `https://data.sec.gov/submissions/CIK<cik>.json`; from `filings.recent`, the latest three `8-K`, the latest `10-K` and any `15-12G`/`25-NSE`, each primary document at `https://www.sec.gov/Archives/edgar/data/<cik as number>/<accession without dashes>/<primaryDocument>`. Through `fetchPage` (sec.gov gets the contact address as its User-Agent via `userAgentFor`). Without `NEXT_PUBLIC_CONTACT_EMAIL`: `[]` and one line `SEC skipped: NEXT_PUBLIC_CONTACT_EMAIL is not set`.
- `appStatus(brand: Brand, dataset: Dataset): Promise<BrandHistory['app']>` — iOS ids from `publishes` edges out of `brand:<slug>` and from the brand's models' `app.iosId`; the first through `lookupApp`: a record → `available: true` with its `url`, `'removed'` → `available: false` with the lookup URL; none → undefined.
- `draftHistory(brand: Brand, pages: OkPage[], app?: BrandHistory['app']): Promise<{ change: CandidateChange | null; relations: ProposedRelation[] }>` — Claude (`config.llm.claudeModel`, no tools) gets `[Source N]` excerpts and writes `{ facts: { date, text, sourceIndex, quote }[], relations: { kind: 'owns' | 'renamed-to'; subject; subjectKind; object; objectKind; since?; sourceIndex; quote }[] }` in its own words: closure, sale or merger, whether the app still works, where to get service. A fact stays when its quote passes `literalCheck` against its page, `forbiddenCheck(text)` passes and `date` is `YYYY-MM` or `YYYY-MM-DD`; fewer than 3 left → `change: null`; more than 5 → the first 5. The change is `brand-history` (always pending) with `refs` = the page URLs. Relations pass the same quote check and `sourceKindFor` (`press-release` or `sec-filing`).
- Unit `archive-history:<slug>`: brands with `historySources` (any status): fetch them, add `secFilings(secCik)` when set, `appStatus`, `draftHistory`, then queue the change and the relations.

- [ ] **Step 1: Write the failing tests**

```ts
test('facts whose quote is not in their source are dropped; fewer than 3 give no draft', async () => {})
test('a fact with a forbidden phrase is dropped', async () => {})
test('an app removed from the App Store is recorded as unavailable', async () => {
  expect(await appStatus(eargo, data)).toMatchObject({ available: false })
})
test('SEC filings are read only with a contact address', async () => {})
test('a sale found in the sources becomes a proposed relation', async () => {})
test('the draft always goes to review', async () => {
  expect(route(change!, [])).toBe('pending')
})
```

- [ ] **Step 2: Run** `npm test -- history` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(archive): sourced brand fate notes for review"`

---

### Task 11: Regular steps for discontinued models

**Kind:** mechanical.

**Files:**
- Create: `pipeline/once.ts`
- Modify: `pipeline/cli.ts` (`Run.once`, `CliOptions.onceFile`, `scrape` third-party loop, `reviews`, `youtube`, `apps`), `pipeline/sources/third-party-facts.ts` (`prices` option)
- Test: `tests/pipeline/once.test.ts`, `tests/pipeline/cli.test.ts`

**Interfaces:**
- `class OnceLedger { static open(file: string): Promise<OnceLedger>; has(key: string): boolean; mark(key: string): Promise<void> }` — keys `<step>:<slug>`, file `.cache/once.json` (`CliOptions.onceFile`), written at once on `mark`.
- `discoverThirdPartyFacts(model, opts: { asOf?; refresh?; prices?: boolean })` — `prices: false` asks for hardware twins only.
- For a model with `discontinued`: `reviews`, `youtube` and third-party twins run when `--refresh` is set or the ledger lacks the key, and mark it after the unit succeeds; third-party prices never; `apps` skips it when its brand's `history.app.available` is false.

- [ ] **Step 1: Write the failing tests**

```ts
test('a discontinued model gets reviews and videos once, again only with --refresh', async () => {
  await main(['reviews'], opts); await main(['reviews'], opts)
  expect(discoverReviewSources).toHaveBeenCalledTimes(1)
  await main(['reviews', '--refresh'], opts)
  expect(discoverReviewSources).toHaveBeenCalledTimes(2)
})
test('third-party prices are never looked up for a discontinued model', async () => {
  expect(discoverThirdPartyFacts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ prices: false }))
})
test('no app version lookup when the brand note says the app was removed', async () => {})
```

- [ ] **Step 2: Run** `npm test -- once cli` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(update): look up discontinued models once"`

---

### Task 12: Research of brands that left the US market (owner gate, no code)

**Kind:** judgment (research; ends with the owner's decision).

**Files:**
- Create: `docs/superpowers/research/2026-11-27-gone-brands.md`

- [ ] **Step 1: List** brands that sold hearing aids in the US at any time since 2018 and have since closed, been sold or left the market (Eargo, Lexie and Lively at least), through WebSearch; never scrape Google or Amazon.
- [ ] **Step 2: For each brand**, give the primary sources for `historySources` (press releases, SEC filings, the company's own pages, as URLs), the SEC CIK for a public company, the brand's domain, and whether a Web Archive copy of its catalog exists (from search results only; no crawling here).
- [ ] **Step 3: Stop and hand the file to the owner.** Only the brands and sources the owner approves go into `data/atlas/sites.json` (then `atlas:crawl`/`atlas:describe` give their `brand-config` cards) and, after approval of those cards, into `historySources`/`secCik` of `data/brands/*.json`.
- [ ] **Step 4: Commit** `git commit -m "docs(research): brands that left the US hearing aid market"`

---

### Task 13: Site data: catalog status, pairs, indexing, JSON-LD

**Kind:** integration (site library).

**Files:**
- Create: `src/lib/site/indexing.ts`
- Modify: `src/lib/site/{catalog-index,pairs,spec-rows,jsonld,sitemap-entries,format}.ts`
- Test: `tests/lib/site.test.ts`, `tests/lib/pairs.test.ts`, `tests/lib/sitemap.test.ts`, `tests/lib/indexing.test.ts`

**Interfaces:**
- Consumes: `parseArchiveUrl`, `archiveMonth` (`src/lib/archive-url.ts`).
- `format.ts`: `archiveLabel(sourceUrl: string): string | undefined` → `official page, archived copy of <formatDate(month)>, via Internet Archive`; undefined for a URL that is not an archive copy. `priceMonth(price: Sourced<unknown>): string` — the archive month of its source, else `fetchedAt.slice(0, 7)`.
- `indexing.ts`: `isIndexable(model: Model): boolean` — true when not discontinued, or `specRows([model]).length >= 3`, or `model.documents.length >= 1`.
- `CatalogItem` gains `discontinued?: { lastListed?: string }`, `lastListedPrice?: { min: number; month: string }` (instead of `priceMin` for a discontinued model, so price filter and sort never see it), `successor?: string`, `indexable: boolean`. `CatalogFilter` gains `includeDiscontinued?: boolean` (default false: discontinued models are left out).
- `pairs.ts`: `competitorsOf` gives `[]` for a discontinued model and never names one; `selectCuratedPairs` = competitor pairs among models on sale, plus each `slug`–`successor` pair; `publishedPairs` keeps only pairs whose models are both `indexable`.
- `spec-rows.ts`: Released of a `derived` `earliest-archive-copy` date reads `On sale by <formatDate>`; Price of a discontinued model reads `<price> (last listed price, <formatDate(priceMonth)>)`.
- `jsonld.ts`: `offers` per Global Constraints.
- `sitemap-entries.ts`: models that are not `isIndexable` are left out.

- [ ] **Step 1: Write the failing tests**

```ts
test('the catalog hides discontinued models unless asked, and keeps them out of price filters', () => {
  expect(filterCatalog(items, {}).map((i) => i.slug)).toEqual(['on-sale'])
  expect(filterCatalog(items, { includeDiscontinued: true, priceMax: 5000 }).map((i) => i.slug)).toEqual(['on-sale'])
})
test('a discontinued model has no competitors and is no one\'s competitor', () => {
  expect(competitorsOf('old', items)).toEqual([])
  expect(competitorsOf('on-sale', items)).not.toContain('old')
})
test('curated pairs add every predecessor-successor pair', () => {})
test('a discontinued page is indexed with 3 sourced rows or 1 document, else not', () => {})
test.each([
  ['https://web.archive.org/web/20210315123456/https://www.eargo.com/neo', 'official page, archived copy of Mar 2021, via Internet Archive'],
  ['https://web.archive.org/web/2019/eargo.com/', 'official page, archived copy of Jan 2019, via Internet Archive'],
  ['https://www.phonak.com/x', undefined],
  ['https://web.archive.org/web/nonsense/x', undefined],
])('archiveLabel(%s)', (url, label) => expect(archiveLabel(url)).toBe(label))
test('offers: lowest official price of a model on sale, none for discontinued or a third-party range', () => {
  expect(productJsonLd(onSale, brand)).toMatchObject({ offers: { '@type': 'Offer', price: 799, priceCurrency: 'USD', url: PRICE_PAGE } })
  expect(productJsonLd(onSale, brand)).not.toHaveProperty('offers.availability')
  expect(productJsonLd(discontinued, brand)).not.toHaveProperty('offers')
  expect(productJsonLd(rxThirdParty, brand)).not.toHaveProperty('offers')
})
test('the sitemap leaves out models that are not indexed', () => {})
```

(`archiveMonth('2019')` gives `2019-01`: a year-only timestamp is read as its first month.)

- [ ] **Step 2: Run** `npm test -- site pairs sitemap indexing` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run build` → green.
- [ ] **Step 5: Commit** `git commit -m "feat(site): discontinued status, lineage pairs, indexing rule and offers"`

---

### Task 14: UI: review cards, catalog toggle, model page, brand page

**Kind:** integration (UI). No data task depends on it.

**Files:**
- Create: `src/components/DocumentList.tsx`, `src/components/DiscontinuedBanner.tsx`, `src/components/BrandHistory.tsx`
- Modify: `app/review/ModelCard.tsx` (`fieldsOf`), `app/review/AtlasCard.tsx` (brand-history card), `app/review/page.tsx`, `src/components/CatalogFilters.tsx`, `src/components/SourceNote.tsx`, `app/hearing-aids/[slug]/page.tsx`, `app/brands/[brand]/page.tsx`, `app/page.tsx`
- Test: `tests/app/review-cards.test.tsx` (create), `tests/components/model-blocks.test.tsx`, `tests/components/compare.test.tsx`, `tests/app/brand-page.test.ts`, `tests/app/model-page.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 3 and 13; `archiveCalendarUrl` (atlas plan).
- Review: `ModelCard.fieldsOf` keeps `discontinued`, `predecessor`, `successor` and `documents.<n>` whole (one checkbox each), like `sameHardwareAs.<n>`; the brand-history card lists each fact (date, text, quote, source link) and the app status, through `approveChange`/`rejectChange`.
- `CatalogFilters`: checkbox "Include discontinued" (`includeDiscontinued`); a discontinued row shows "Discontinued" and its last listed price with its month.
- `SourceNote`: for an archive copy, the label is `archiveLabel(sourceUrl)`.
- Model page: `DiscontinuedBanner` — "Discontinued — last listed by <Brand> in <Mon YYYY>", or "Discontinued" without a month; "Manuals & datasheets" (`DocumentList`: title, kind, and for an archive copy "archived copy, <Mon YYYY>, via Internet Archive"); "Predecessor"/"Successor" links; for a gone brand, "<Brand> no longer sells hearing aids under its own name." linking `/brands/<slug>#what-happened`; `robots: { index: false, follow: true }` when not `isIndexable`.
- Brand page: for a gone brand "No longer sold under this name" and the website link to `archiveCalendarUrl(website)` labelled "Archived website (Internet Archive)"; `BrandHistory` under `id="what-happened"`, heading "What happened to <Brand>", each fact with its date and source link, the app status line ("<app> is no longer on the App Store (checked <date>)" or "is on the App Store"), shown when `history` is set (any status).
- Home "Latest models" leaves out discontinued models.

- [ ] **Step 1: Write the failing tests**

```ts
test('a new model card keeps discontinued and each document as one field', () => {})
test('the brand-history card shows every fact with its quote and source', () => {})
test('the banner names the month the maker last listed the model', () => {
  render(<DiscontinuedBanner brand="Phonak" lastListed="2022-09" />)
  expect(screen.getByText('Discontinued — last listed by Phonak in Sep 2022')).toBeTruthy()
})
test('an archived document says so with its month', () => {})
test('a discontinued page without 3 rows or a document is noindex', async () => {})
test('a gone brand links its archived website, never the live one', async () => {})
test('the brand page shows What happened with dated, sourced facts', async () => {})
test('the catalog toggle shows discontinued models', async () => {})
```

- [ ] **Step 2: Run** `npm test -- review-cards model-blocks compare brand-page model-page` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run build` → green.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): review cards, discontinued models, manuals and brand fate"`

---

## After the plan (owner's run, not a task)

Per brand: `npm run archive -- --brand <slug>`, then decide its cards on `/review` (about 30 seconds a card; split over evenings by brand), then commit `data/`. Re-run every few months; archive copies are cached for good.
