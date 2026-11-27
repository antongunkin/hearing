# Site Atlas and Company Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every fetched page and PDF locally with an append-only fetch log, describe each brand and group site in a git-tracked atlas for the next agent, propose brand scraper configs from it, and keep a company/brand/domain graph whose owner-approved relations appear on the site.

**Architecture:** The fetcher gains a write-once body store and a JSONL log under `.cache/raw/`. A new `pipeline/atlas/` package crawls each site in `data/atlas/sites.json` (code only, budgeted BFS, robots, sitemaps, Web Archive CDX) into `report.json`, then `claude -p` without tools turns the report and a few key pages into `README.md`, `config-proposal.json` and relation proposals, every claim checked by code against the fetch log. Brand configs and public relations change only through two new `/review` kinds; the site reads `data/graph/` for a brand "Company" block and `/companies`.

**Tech Stack:** TypeScript strict, Node 22+, Next.js 16 App Router, React 19, Zod 4, Vitest 5 (jsdom by default, `// @vitest-environment node` for pipeline tests), jsdom, robots-parser, unpdf, `claude -p`.

**Spec:** `docs/superpowers/specs/2026-11-27-site-atlas-design.md` (extends `docs/superpowers/specs/2026-11-26-hearing-aid-comparison-site-design.md`). The "Решения, принятые при проверке дизайна" list at the end of the spec is binding.

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
- Every network request goes through `fetchPage` (blocklist, robots, pacing, bot-wall check, fetch log). Atlas agents get no network tools: `atlas:describe` calls `claude -p` with no tools; only `atlas:relations` uses WebSearch, and every URL it returns is fetched by our fetcher.
- Raw store: `.cache/raw/<sha256 of body bytes>` is written once and never overwritten or deleted by the pipeline; `.cache/raw/log.jsonl` is only appended to. 3xx bodies are not stored; a rendered page is stored as its rendered HTML with `rendered: true`; PDFs are stored as bytes. Old `.cache/pages` entries are not imported.
- Page budget per site: `config.atlas.pageBudget = 60`. URLs listed in sitemaps are counted, never fetched for the atlas. Shops and review sites are not crawled; links to them are only counted as outbound.
- Web Archive: pause between requests to `web.archive.org` is `config.archiveDelayMs` (5000, never below 4000); its own robots.txt applies; an archived robots.txt is recorded for information only.
- The one exception to "no User-Agent": requests to sec.gov and its subdomains send `NEXT_PUBLIC_CONTACT_EMAIL` (the site's contact address, never a personal one) as the User-Agent, because SEC EDGAR asks for a declared contact; without it the SEC part is skipped. `NEXT_PUBLIC_SITE_URL` is not required by any pipeline command.
- `describe` uses `config.llm.describeModel = 'sonnet'`; other atlas LLM calls use `config.llm.claudeModel`.
- Every statement in a site README and every relation source must point at a fetch-log entry (`url` + `fetchedAt`); a relation quote must occur literally in the source text.
- Brand configs (`data/brands/*.json`) change only through `/review` kind `brand-config`. A relation reaches the site only as `visibility: 'public'`, `status: 'verified'`, which only `/review` kind `relation` sets. `internal` and `proposed` relations never reach the site.
- Domains found in reports are never crawled automatically: they are listed as candidates in `data/atlas/README.md`; the owner adds them to `sites.json`.
- `data/atlas/` and `data/graph/` are committed; they hold facts about structure, never page content beyond short quotes.

## Review Focus

1. **The same body fetched twice, or a run killed mid-write** — one body file under its hash, two log lines, never a truncated file under a final name. Tests in Task 1.
2. **A site answers 429 or a bot wall in the middle of a crawl** — the crawl of that site stops, the previous `report.json` stays untouched, the unit stays undone, and `--resume` crawls it again from cached pages. Tests in Task 7.
3. **A cited URL reached through a redirect or the Web Archive** — the log check accepts the requested URL or the final URL of an entry; a URL that was never fetched is rejected. Tests in Task 9.
4. **A config proposal whose brand file changed since, or for a gone brand with no file** — approval refuses the stale one and creates the missing one. Tests in Task 8.
5. **An agent pattern that is not a valid regex, or matches no report URL** — a failed `pattern` check on the card, never a crash of `describe`. Tests in Task 9.

---

## File Structure

```
pipeline/fetch/raw-store.ts        # body store + fetch log (new)
pipeline/fetch/fetcher.ts          # logs every request, rate-limited reason, archive pacing, per-host UA
pipeline/fetch/html.ts             # + pageTitle, appStoreLinks
pipeline/config.ts                 # + atlas, archiveDelayMs, archiveHosts, onSaleSince, describeModel, userAgentFor
pipeline/llm/{index,claude-cli}.ts # + model override
pipeline/sources/wayback.ts        # CDX client, archive URLs (new)
pipeline/sources/itunes.ts         # + lookupApp
pipeline/sources/openfda.ts        # + fetchClearances
pipeline/atlas/schema.ts           # Site, SiteReport, Description, ConfigProposal (new)
pipeline/atlas/facts.ts            # pageFacts, needsRender, urlTemplates, parseSitemap, sections (new)
pipeline/atlas/crawl.ts            # crawlSite (new)
pipeline/atlas/graph-store.ts      # upsertEntity, upsertEdge, readGraphFiles, writeGraph (new)
pipeline/atlas/relation.ts         # ProposedRelation, queueRelation (new)
pipeline/atlas/describe.ts         # pickKeyPages, describeSite, checkProposal, renderSiteReadme (new)
pipeline/atlas/relations.ts        # WebSearch claims, SEC filer, FDA applicants, app publishers (new)
pipeline/atlas/index-file.ts       # renderAtlasIndex, writeAtlasIndex (new)
pipeline/atlas/cli.ts              # crawl | describe | relations (new)
src/lib/schema/{brand,graph,pending}.ts
src/lib/data/{load,consistency}.ts
src/lib/archive-url.ts            # archive copy URLs, client-safe (new)
src/lib/review/{apply-decision,config-diff}.ts
src/lib/site/{companies,sitemap-entries}.ts
src/components/CompanyBlock.tsx
app/review/{page.tsx,AtlasCard.tsx}, app/brands/[brand]/page.tsx, app/companies/page.tsx   # UI, Task 12
data/atlas/{sites.json,README.md,sites/<domain>/{report.json,describe.json,README.md,config-proposal.json,notes.md}}
data/graph/{entities.json,edges.json}
CLAUDE.md
```

---

### Task 1: Raw body store and fetch log

**Kind:** integration (fetcher internals).

**Files:**
- Create: `pipeline/fetch/raw-store.ts`
- Modify: `pipeline/fetch/fetcher.ts`, `pipeline/fetch/render.ts` (mark a page that ran)
- Test: `tests/pipeline/raw-store.test.ts`, `tests/pipeline/fetcher.test.ts`

**Interfaces:**
- Produces (`pipeline/fetch/raw-store.ts`):
  - `RAW_DIR = '.cache/raw'`
  - `FetchLogEntry` (Zod strictObject) = `{ url: string /* as requested */, finalUrl?: string, redirects: { url: string; status: number }[] /* each 3xx hop, in order */, fetchedAt: IsoDateTime, status?: number /* absent when no request was sent */, contentType?: string, bodyHash?: string /* 64 hex */, via: 'live' | 'archive', rendered: boolean, skipped?: 'robots' | 'blocklist' | 'bot-protection' | 'rate-limited' | 'http-error', detail?: string }`
  - `type LogRef = { url: string; fetchedAt: string }`
  - `storeBody(body: Uint8Array, dir?: string): Promise<string>` → sha256 hex; writes `<dir>/<hash>` through a temp file and `link()` so an existing file is never replaced.
  - `readBody(hash: string, dir?: string): Promise<Uint8Array>`
  - `appendLog(entry: FetchLogEntry, dir?: string): Promise<void>` — one JSON line, appends serialized in-process.
  - `readLog(dir?: string): Promise<FetchLogEntry[]>` — missing file → `[]`.
  - `findInLog(log: FetchLogEntry[], ref: { url: string; fetchedAt?: string }): FetchLogEntry | undefined` — newest entry without `skipped` whose `url` or `finalUrl` equals `ref.url` (and `fetchedAt` equals, when given).
- Produces (`fetcher.ts`): `FetchResult` ok branch gains `bodyHash?: string` and `contentType?: string` (optional only so that existing test fixtures stay valid; `fetchPage` always sets both); `Reply` gains `rendered?: true` (set by `renderPage` only when the page's scripts ran).

- [ ] **Step 1: Write the failing raw-store tests** (`tests/pipeline/raw-store.test.ts`, `// @vitest-environment node`, temp dir per test)

```ts
test('a body is stored once under its hash and never overwritten', async () => {
  const hash = await storeBody(new TextEncoder().encode('A'), dir)
  expect(hash).toBe(createHash('sha256').update('A').digest('hex'))
  await writeFile(join(dir, hash), 'tampered') // stands for a file that is already there
  expect(await storeBody(new TextEncoder().encode('A'), dir)).toBe(hash)
  expect(await readFile(join(dir, hash), 'utf8')).toBe('tampered')
  expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
})
test('the log is only appended to', async () => {
  await appendLog(entry({ url: 'https://a.test/1' }), dir)
  await appendLog(entry({ url: 'https://a.test/2' }), dir)
  expect((await readLog(dir)).map((e) => e.url)).toEqual(['https://a.test/1', 'https://a.test/2'])
})
test('findInLog matches the requested or the final URL, never a skipped entry', () => {
  const log = [entry({ url: 'https://a.test/x', finalUrl: 'https://a.test/y', fetchedAt: T1 }), entry({ url: 'https://a.test/z', skipped: 'robots', fetchedAt: T2 })]
  expect(findInLog(log, { url: 'https://a.test/y', fetchedAt: T1 })).toBe(log[0])
  expect(findInLog(log, { url: 'https://a.test/z' })).toBeUndefined()
})
```

- [ ] **Step 2: Write the failing fetcher tests** (append to `tests/pipeline/fetcher.test.ts`; its temp cwd makes `.cache/raw` local)

```ts
test('two refreshed fetches of an unchanged page: two log lines, one body', async () => {
  // fetchPage(url, { refresh: true }) twice
  expect(log.filter((e) => e.url === url)).toHaveLength(2)
  expect(new Set(log.map((e) => e.bodyHash)).size).toBe(1)
})
test('a changed page keeps the earlier body', async () => {}) // two different bodyHash files both exist
test('a redirect chain is one line; the 3xx body is not stored', async () => {
  expect(line.redirects).toEqual([{ url: `${base}/old`, status: 301 }])
  expect(line.finalUrl).toBe(`${base}/new`)
  expect(await readdir('.cache/raw')).not.toContain(sha256(redirectBody))
})
test('robots.txt requests and refusals are logged with their reason', async () => {
  expect(log.find((e) => e.url.endsWith('/robots.txt'))?.status).toBe(200)
  expect(log.find((e) => e.url === disallowed)).toMatchObject({ skipped: 'robots' })
  expect(log.find((e) => e.url === blocked)).toMatchObject({ skipped: 'blocklist' })
  expect(log.find((e) => e.url === wall)).toMatchObject({ skipped: 'bot-protection', status: 200 })
})
test('a PDF is stored as its bytes', async () => {
  expect(await readBody(result.bodyHash)).toEqual(new Uint8Array(await fixture('datasheet.pdf')))
})
test('the result carries the fetchedAt and bodyHash of its log line', async () => {})
test('a cached copy from before the log is not used', async () => {
  // write .cache/pages/<sha256(url)>.json as { rendered: false, result } without `logged`
  expect(hits).toHaveLength(1) // fetched again
})
test('a rendered page is stored as rendered HTML with rendered: true', async () => {})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- raw-store fetcher`
Expected: FAIL (`storeBody` not exported; new fetcher tests fail).

- [ ] **Step 4: Implement `raw-store.ts`** per Interfaces. `appendLog` chains on a module-level promise and uses `appendFile(…, 'utf8')` with `mkdir -p`.

- [ ] **Step 5: Wire logging into `fetcher.ts`**

`follow` also returns the 3xx `hops` it passed. A new internal `request(start, check, send, render)` wraps `follow` and writes exactly one `FetchLogEntry` per call, whatever the outcome (a refusal before the first request has no `status`); both `fetchPage` and the robots callback (`readRobots(origin, (file) => request(...))`) go through it. Bodies of non-3xx final replies go to `storeBody`. `via` is `'archive'` when the start host is in `config.archiveHosts` (Task 2; until then `web.archive.org`). The same `fetchedAt` string is written to the log line and the ok result. The page cache entry becomes `{ rendered, logged: true, result }`; an entry without `logged: true` is a miss. Bot-wall and HTTP-error outcomes are logged with `status` and `skipped`.

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- raw-store fetcher` → PASS. Then `npm test` and `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add pipeline/fetch tests/pipeline/raw-store.test.ts tests/pipeline/fetcher.test.ts
git commit -m "feat(fetch): write-once raw body store and append-only fetch log"
```

---

### Task 2: Fetcher host rules: rate limits, Web Archive pace, SEC contact header

**Kind:** mechanical (spec complete, 3 files).

**Files:**
- Modify: `pipeline/config.ts`, `pipeline/fetch/fetcher.ts`, `pipeline/fetch/render.ts`
- Test: `tests/pipeline/fetcher.test.ts`

**Interfaces:**
- Produces (`config.ts`): `archiveDelayMs: 5000` (comment: at least 4000 by the atlas spec; cite the archive.org rate rule read, with date), `archiveHosts: ['web.archive.org']`, `onSaleSince: '2018-01-01'`, `atlas: { pageBudget: 60, sitemapBudget: 20, cdxSections: 6, maxReportUrls: 3000, keyPages: 8, moreUrls: 10, moreRounds: 2 }`, `llm.describeModel: 'sonnet'`, and `userAgentFor(host: string): string | undefined` (exported function, not a config field): `undefined` for every host except `sec.gov` and its subdomains, where it returns the `NEXT_PUBLIC_CONTACT_EMAIL` value alone; for those hosts without the variable it throws `Error('NEXT_PUBLIC_CONTACT_EMAIL is not set: SEC EDGAR asks for a contact address in the User-Agent')`.
- Produces (`fetcher.ts`): skip reason `'rate-limited'` added to `FetchResult`/`Refusal` (HTTP 429, `detail: 'HTTP 429'`); every other caller keeps treating it as a skipped source.

- [ ] **Step 1: Write the failing tests**

```ts
test('a 429 is skipped as rate-limited and logged so', async () => {
  expect(await fetchPage(`${base}/busy`)).toMatchObject({ status: 'skipped', reason: 'rate-limited', detail: 'HTTP 429' })
})
test('requests to an archive host are at least archiveDelayMs apart', async () => {
  Object.assign(config, { archiveHosts: ['127.0.0.1'], archiveDelayMs: 4000 })
  // fake timers as in "two requests to same host are ≥2000ms apart"; second request not before 4000 ms
})
test('userAgentFor gives the contact address for SEC hosts and nothing elsewhere', () => {
  vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', 'contact@hearing.test')
  expect(userAgentFor('data.sec.gov')).toBe('contact@hearing.test')
  expect(userAgentFor('www.sec.gov')).toBe('contact@hearing.test')
  expect(userAgentFor('www.phonak.com')).toBeUndefined()
  expect(userAgentFor('notsec.gov')).toBeUndefined()
})
test('a plain request to any other host sets no user-agent header', async () => {
  vi.stubGlobal('fetch', fetchSpy)
  await fetchPage(`${base}/page`)
  expect(new Headers(fetchSpy.mock.calls.at(-1)![1]?.headers).has('user-agent')).toBe(false)
})
test('without the contact address nothing is sent to sec.gov', async () => {
  vi.stubGlobal('fetch', fetchSpy)
  await expect(fetchPage('https://www.sec.gov/x')).rejects.toThrow('NEXT_PUBLIC_CONTACT_EMAIL')
  expect(fetchSpy).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run** `npm test -- fetcher` → FAIL.
- [ ] **Step 3: Implement.** `paced` takes the larger of the random pause, the Crawl-delay and (for `archiveHosts`) `archiveDelayMs`. `plainRequest` sets the `user-agent` header, and `renderPage` passes `userAgent` to `newContext`, only when `userAgentFor(url.hostname)` is defined; otherwise Node's and Playwright's defaults stand. `fetchPage` calls `userAgentFor(start.hostname)` before any check so a missing contact throws. A 429 reply (plain or render) becomes `rate-limited` before the bot-wall check.
- [ ] **Step 4: Run** `npm test` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `git commit -m "feat(fetch): rate-limited skips, Web Archive pace, SEC contact header"`

---

### Task 3: Brand schema change and migration

**Kind:** mechanical (many small edits, fully specified).

**Files:**
- Modify: `src/lib/schema/brand.ts`, `pipeline/sources/brand-site.ts:73-106`, `pipeline/cli.ts:134-168`, all 19 `data/brands/*.json`, `README.md` ("Brands" section)
- Modify (fixtures: add `status: 'active'`): `tests/pipeline/sources.test.ts:56`, `tests/pipeline/apply.test.ts:68`, `tests/pipeline/cli.test.ts:76`, `tests/pipeline/brand-site.test.ts:38` (also `datasheetUrlPattern` → `documentUrlPattern` at :41 and :521), `tests/app/brand-page.test.ts:17`, `tests/lib/data.test.ts:29`, `tests/lib/site.test.ts:41`, `tests/lib/schema.test.ts:95`, `tests/components/compare.test.tsx:51`, `tests/lib/apply-decision.test.ts:58`, `tests/lib/sitemap.test.ts:39`
- Test: `tests/lib/schema.test.ts`, `tests/pipeline/brand-site.test.ts`, `tests/pipeline/cli.test.ts`, `tests/lib/brands-data.test.ts` (create)

**Interfaces:**
- Produces (`brand.ts`): `BrandStatus = z.enum(['active', 'gone'])`; `Brand` gains `status: BrandStatus` (required), `scraper.supportUrls?: HttpUrl[]`, `scraper.documentUrlPattern?: string` (replaces `datasheetUrlPattern`, which is no longer accepted), `archive?: { catalogUrls: HttpUrl[]; modelUrlPattern?: string }`.
- Produces (`brand-site.ts`): `discoverModelUrls` reads `[...catalogUrls, ...(supportUrls ?? [])]` and matches documents with `documentUrlPattern`; signature unchanged.
- Produces (`cli.ts`): `scrape` skips a brand with `status: 'gone'`, logging `<slug>: gone, not scraped live`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/schema.test.ts
test('a brand needs a status and no longer takes datasheetUrlPattern', () => {
  expect(Brand.safeParse({ ...brand, status: undefined }).success).toBe(false)
  expect(Brand.safeParse({ ...brand, scraper: { ...brand.scraper, datasheetUrlPattern: 'x' } }).success).toBe(false)
  expect(Brand.parse({ ...brand, archive: { catalogUrls: ['https://www.eargo.com/products-hearing-aids'] } }).archive?.catalogUrls).toHaveLength(1)
})
// tests/lib/brands-data.test.ts (reads the real data/)
test('every brand file is migrated', async () => {
  const { brands } = await loadDataset('data')
  const bySlug = Object.fromEntries(brands.map((b) => [b.slug, b]))
  expect(bySlug.phonak.scraper.supportUrls).toEqual([
    'https://www.phonak.com/en-us/support/datasheets',
    'https://www.phonak.com/en-us/support/user-guides/infinio',
    'https://www.phonak.com/en-us/support/user-guides/eon',
  ])
  expect(bySlug.phonak.scraper.catalogUrls).toEqual(['https://www.phonak.com/en-us/hearing-devices/hearing-aids'])
  expect(bySlug.phonak.scraper.documentUrlPattern).toBeDefined()
  expect([bySlug.eargo.status, bySlug.lexie.status]).toEqual(['gone', 'gone'])
  expect(brands.filter((b) => b.status === 'gone').map((b) => b.slug)).toEqual(['eargo', 'lexie'])
})
// tests/pipeline/brand-site.test.ts
test('support pages give model links and documents like catalog pages', async () => {})
// tests/pipeline/cli.test.ts
test('a gone brand is not scraped live', async () => {
  // brand fixture with status 'gone'
  expect(discoverModelUrls).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run** `npm test -- schema brands-data brand-site cli` → FAIL.
- [ ] **Step 3: Change the schema, `discoverModelUrls` and `scrape`** per Interfaces.
- [ ] **Step 4: Migrate `data/brands/*.json`** by hand or with a throwaway script that is not committed: add `"status": "active"` (Eargo and Lexie `"gone"`: the archive spec names both as gone and their live sites are dead), rename `datasheetUrlPattern`, move Phonak's three support pages to `supportUrls`. Keys stay sorted (`writeJson` order).
- [ ] **Step 5: Update the fixtures listed above and the README "Brands" field list** (`status`, `supportUrls`, `documentUrlPattern`, `archive`; brand configs change only through `/review` once the atlas exists).
- [ ] **Step 6: Run** `npm test`, `npx tsc --noEmit`, `npm run build` → green.
- [ ] **Step 7: Commit** `git commit -m "feat(schema): brand status, support pages, document pattern and archive config"`

---

### Task 4: Company graph schema, loader and store

**Kind:** mechanical.

**Files:**
- Create: `src/lib/schema/graph.ts`, `src/lib/data/consistency.ts`, `pipeline/atlas/graph-store.ts`, `data/graph/entities.json` (`[]`), `data/graph/edges.json` (`[]`)
- Modify: `src/lib/data/load.ts` (`Dataset.graph`), Dataset fixtures in `tests/pipeline/apply.test.ts:71`, `tests/lib/apply-decision.test.ts:49`, `tests/lib/sitemap.test.ts:30`, `tests/app/brand-page.test.ts:21`, `tests/lib/data.test.ts`
- Test: `tests/lib/graph.test.ts`, `tests/lib/data-consistency.test.ts`

**Interfaces:**
- Produces (`src/lib/schema/graph.ts`):
  - `EntityKind = z.enum(['company', 'brand', 'domain', 'app', 'fda-applicant', 'sec-filer'])`
  - `Entity = { id: string /* '<kind>:<key>', key matches /^[a-z0-9][a-z0-9.-]*$/ */, kind, name, iosId?: /^\d+$/, androidId?: string, cik?: /^\d{10}$/ }`, refined: the id prefix equals `kind`. Ids: `brand:<slug>`, `company:<slugify(name)>`, `domain:<host without www.>`, `app:<slugify(name)>`, `fda-applicant:<slugify(name)>`, `sec-filer:<cik>`.
  - `EdgeKind = z.enum(['owns', 'makes-for', 'operates', 'publishes', 'files-as', 'renamed-to', 'redirects-to', 'links-to', 'hosts-documents-for'])`; `DOMAIN_EDGE_KINDS = ['redirects-to', 'links-to', 'hosts-documents-for'] as const`. `files-as` points at an `fda-applicant` or a `sec-filer`.
  - `SourceKind = z.enum(['crawl', 'company-page', 'press-release', 'sec-filing', 'fda-record', 'app-store', 'third-party'])`
  - `EdgeSource = { url: HttpUrl, quote?: string, fetchedAt: IsoDateTime, kind: SourceKind }`
  - `Edge = { from: string, to: string, kind: EdgeKind, since?: /^\d{4}(-\d{2})?$/, until?: same, visibility: 'public' | 'internal', status: 'observed' | 'proposed' | 'verified', sources: EdgeSource[] (min 1) }`, refined: public ⇒ verified; domain kinds ⇒ internal; observed ⇒ domain kind and only `crawl` sources; verified ⇒ at least one source with a quote whose kind is neither `crawl` nor (unless `makes-for`) `third-party`; a `third-party` source only on `makes-for`.
  - `Graph = { entities: Entity[]; edges: Edge[] }`, refined: unique entity ids, every edge end is an entity, unique `edgeKey`.
  - `edgeKey(e: Pick<Edge, 'from' | 'kind' | 'to'>): string` → `` `${from} ${kind} ${to}` ``
- Produces (`load.ts`): `Dataset.graph: Graph`, read from `<dir>/graph/entities.json` and `edges.json`, a missing file being `[]`.
- Produces (`consistency.ts`): `groupMismatches(brands: Brand[], graph: Graph): string[]` — one message per brand whose verified `owns` edge comes from a company whose `normalizeName(name)` differs from `normalizeName(brand.group)`: `` `${slug}: group "${group}" but the verified owner is "${name}"` ``.
- Produces (`pipeline/atlas/graph-store.ts`): `upsertEntity(graph: Graph, entity: Entity): Graph` (keeps the stored name; fills missing `iosId`/`androidId`/`cik`), `upsertEdge(graph: Graph, edge: Edge): Graph` (same key: sources merged by `url`+`fetchedAt`, status never lowered in `observed < proposed < verified`, visibility becomes public only with the new edge public and verified, `since`/`until` kept when set), `writeGraph(graph: Graph, dir?: string): Promise<void>` (`Graph.parse`, entities sorted by id, edges by key, both files written).

- [ ] **Step 1: Write the failing tests**

```ts
test('a public edge must be verified, and verified needs a quoted primary source', () => {
  expect(Edge.safeParse({ ...owns, visibility: 'public', status: 'proposed' }).success).toBe(false)
  expect(Edge.safeParse({ ...owns, status: 'verified', sources: [{ ...src, quote: undefined }] }).success).toBe(false)
  expect(Edge.safeParse({ ...owns, status: 'verified', sources: [{ ...src, kind: 'third-party' }] }).success).toBe(false)
  expect(Edge.safeParse({ ...makesFor, status: 'verified', sources: [{ ...src, kind: 'third-party' }] }).success).toBe(true)
})
test('domain edges are observed or proposed, internal, from the crawl', () => {})
test('an edge to an unknown entity is refused', () => {})
test('upsertEdge merges sources and never lowers the status', () => {
  const merged = upsertEdge(upsertEdge(empty, verifiedOwns), { ...verifiedOwns, status: 'proposed', visibility: 'internal', sources: [other] })
  expect(merged.edges[0]).toMatchObject({ status: 'verified', visibility: 'public' })
  expect(merged.edges[0].sources).toHaveLength(2)
})
test('groupMismatches names a brand whose group differs from its verified owner', () => {
  expect(groupMismatches([{ ...phonak, group: 'Sonova' }], graphOwnedBy('GN Store Nord'))).toEqual(['phonak: group "Sonova" but the verified owner is "GN Store Nord"'])
})
// tests/lib/data-consistency.test.ts
test('brand groups agree with the approved owns relations in data/', async () => {
  const { brands, graph } = await loadDataset('data')
  expect(groupMismatches(brands, graph)).toEqual([])
})
```

- [ ] **Step 2: Run** `npm test -- graph data-consistency` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; add `graph: { entities: [], edges: [] }` to the Dataset fixtures listed.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run build` → green.
- [ ] **Step 5: Commit** `git commit -m "feat(graph): company and site graph schema, loader and store"`

---

### Task 5: Source clients: Web Archive CDX, app lookup, FDA applicants, page links

**Kind:** mechanical.

**Files:**
- Create: `src/lib/archive-url.ts` (pure, client-safe: the site labels archived sources with it), `pipeline/sources/wayback.ts`
- Modify: `pipeline/sources/itunes.ts`, `pipeline/sources/openfda.ts`, `pipeline/fetch/html.ts`
- Test: `tests/pipeline/wayback.test.ts`, `tests/pipeline/sources.test.ts`, `tests/pipeline/html.test.ts` (create)

**Interfaces:**
- Produces (`wayback.ts`):
  - `CDX_URL = 'https://web.archive.org/cdx/search/cdx'`
  - `type CdxRow = { timestamp: string; original: string; statusCode: string; mimeType: string; digest: string }`
  - `type CdxQuery = { url: string; matchType?: 'exact' | 'prefix' | 'host' | 'domain'; from?: string; to?: string; filters?: string[]; collapse?: string; limit?: number }`
  - `cdxUrl(q: CdxQuery): string` — `output=json`, `fl=timestamp,original,statuscode,mimetype,digest`, one `filter=` per filter, in that order: `url, matchType, from, to, filter…, collapse, limit, output, fl`.
  - `parseCdx(text: string): CdxRow[]` — JSON array whose first row is the header; empty text → `[]`.
  - `class WaybackError extends Error { readonly reason: string }` — thrown by `cdx` for a skipped request.
  - `cdx(q: CdxQuery, opts?: { refresh?: boolean }): Promise<CdxRow[]>` — through `fetchPage`.
  - `lastCopyPerYear(rows: CdxRow[], sinceYear: number): CdxRow[]` — the latest 200 row of each year ≥ `sinceYear`, by year.
  - `copiesPerYear(rows: CdxRow[], sinceYear: number): Record<string, number>`
- Produces (`src/lib/archive-url.ts`, no imports from `pipeline/`):
  - `archiveUrl(timestamp: string, original: string, opts?: { raw?: boolean }): string` → `https://web.archive.org/web/<ts>[id_]/<original>`
  - `parseArchiveUrl(url: string): { timestamp: string; original: string; raw: boolean } | null` — timestamp 4–14 digits, flags `id_`/`if_`/`im_`, original with or without scheme (`http://` added when missing).
  - `citableArchiveUrl(url: string): string` — the same copy without `id_` (what the site links to).
  - `archiveMonth(timestamp: string): string` → `YYYY-MM` (a year-only timestamp gives month `01`).
  - `archiveCalendarUrl(original: string): string` → `https://web.archive.org/web/*/<original>`.
- Produces (`itunes.ts`): `type AppRecord = { iosId: string; name: string; seller: string; url: string; lookupUrl: string; fetchedAt: string }`; `lookupApp(iosId: string): Promise<AppRecord | 'removed' | null>` (`resultCount: 0` → `'removed'`, skipped → `null`).
- Produces (`openfda.ts`): `type Clearance510k = { kNumber: string; applicant: string; deviceName: string; decisionDate: string; cdrhUrl: string; ref: LogRef }`; `fetchClearances(sinceISO: string): Promise<Clearance510k[]>` (our product codes; `ref` is the openFDA page that held the record). `fetchFdaEvents` keeps its behaviour.
- Produces (`html.ts`): `pageTitle(html: string): string | undefined`; `appStoreLinks(html: string, baseUrl: string): { ios: string[]; android: string[] }` (ios: the digits of `apps.apple.com/…/id<N>` or `itunes.apple.com/…/id<N>`; android: `id` of `play.google.com/store/apps/details?id=…`; each once, in document order).

- [ ] **Step 1: Write the failing tests**

```ts
test('cdxUrl builds the query in a fixed order', () => {
  expect(cdxUrl({ url: 'eargo.com/', from: '2018', filters: ['statuscode:200'], collapse: 'timestamp:8' })).toBe(
    'https://web.archive.org/cdx/search/cdx?url=eargo.com%2F&from=2018&filter=statuscode%3A200&collapse=timestamp%3A8&output=json&fl=timestamp%2Coriginal%2Cstatuscode%2Cmimetype%2Cdigest',
  )
})
test.each([
  ['https://web.archive.org/web/20210315123456id_/https://www.eargo.com/', { timestamp: '20210315123456', original: 'https://www.eargo.com/', raw: true }],
  ['https://web.archive.org/web/2021/eargo.com/x?a=1', { timestamp: '2021', original: 'http://eargo.com/x?a=1', raw: false }],
  ['https://web.archive.org/web/abc/https://x.test/', null],
  ['https://www.eargo.com/', null],
])('parseArchiveUrl(%s)', (url, expected) => expect(parseArchiveUrl(url)).toEqual(expected))
test('lastCopyPerYear keeps the latest 200 copy of each year since 2018', () => {})
test('parseCdx reads the header row; an empty answer has no rows', () => {})
test('lookupApp: resultCount 0 is removed; a found app gives name and seller', async () => {})
test('fetchClearances gives the CDRH page and the openFDA page it was read from', async () => {})
test('appStoreLinks reads App Store ids and Play package ids once each', () => {
  expect(appStoreLinks(html, 'https://brand.test/')).toEqual({ ios: ['1000000000'], android: ['com.brand.app'] })
})
```

- [ ] **Step 2: Run** `npm test -- wayback sources html` → FAIL.
- [ ] **Step 3: Implement** per Interfaces (`fetchClearances` shares the paging of `search` in `openfda.ts`, which now also returns each page's URL and `fetchedAt`).
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(sources): Web Archive CDX client, app lookup, FDA clearances, app links"`

---

### Task 6: Atlas schemas and page facts

**Kind:** mechanical (algorithms pinned below).

**Files:**
- Create: `pipeline/atlas/schema.ts`, `pipeline/atlas/facts.ts`
- Test: `tests/pipeline/atlas-facts.test.ts`

**Interfaces:**
- Produces (`schema.ts`):
  - `Site = { domain: string /* lowercase host without www. */, start: HttpUrl, kind: 'brand' | 'group' | 'other', mode: 'live' | 'archive', brands: Slug[], company?: string, include?: string /* regex on the full URL; only matching internal URLs are crawled */, newBrand?: { slug: Slug; name: string; group: string; defaultType: ModelType } }`; `Sites = z.array(Site)` with unique domains.
  - `LogRefSchema = { url: string; fetchedAt: IsoDateTime }`
  - `PageFacts = { url: string, ref: LogRef, archiveTimestamp?: string, title?: string, internalLinks: number, external: string[], pdfs: string[], apps: { ios: string[]; android: string[] }, jsonLdTypes: string[], needsRender: boolean }`
  - `UrlTemplate = { pattern: string; count: number; examples: string[] }`
  - `SiteReport = { domain, generatedAt, mode, start, budget, robots: { ref: LogRef | null, status: number | null, crawlDelaySec?: number, sitemaps: string[], groups: { userAgents: string[]; allow: string[]; disallow: string[] }[], archived?: { ref: LogRef; groups: … } }, sitemap: { refs: LogRef[], urlCount: number, sections: { path: string; count: number }[] }, pages: PageFacts[], templates: UrlTemplate[], outbound: { domain: string; count: number; examples: string[] }[], redirects: { from: string; to: string; ref: LogRef }[], pdfHosts: { host: string; count: number; examples: string[] }[], archive: { sections: { url: string; byYear: Record<string, number>; latest?: string }[] }, failures: { url: string; reason: string; detail?: string }[], urls: string[] /* sorted, at most config.atlas.maxReportUrls: crawled, linked, sitemap and PDF URLs */ }`
- Produces (`facts.ts`):
  - `isInternal(url: URL, site: Site): boolean` — host is `site.domain` or a subdomain of it.
  - `pageFacts(page: OkPage, site: Site): PageFacts` — for an archive copy, links resolve against the original URL from `parseArchiveUrl`.
  - `needsRender(html: string, text: string): boolean` — `text.length < 1500` and (inline `<script>` bytes ≥ half of the HTML, or ≥ 5 external scripts).
  - `urlTemplates(urls: string[], minCount = 3): UrlTemplate[]` — group by host and every path segment but the last; a group of ≥ `minCount` becomes `/<parent>/{slug}` (a parent segment of digits only becomes `{n}`); count desc, then pattern; first 3 examples sorted.
  - `parseSitemap(xml: string): { urls: string[]; sitemaps: string[] }` — `<urlset><loc>` vs `<sitemapindex><loc>`.
  - `sections(urls: string[]): { path: string; count: number }[]` — by first path segment (`/` for none), count desc.

- [ ] **Step 1: Write the failing tests**

```ts
test('urlTemplates groups sibling paths of three or more', () => {
  expect(urlTemplates(['/hearing-aids/a', '/hearing-aids/b', '/hearing-aids/c', '/about'].map((p) => `https://x.test${p}`))).toEqual([
    { pattern: 'https://x.test/hearing-aids/{slug}', count: 3, examples: ['https://x.test/hearing-aids/a', 'https://x.test/hearing-aids/b', 'https://x.test/hearing-aids/c'] },
  ])
})
test('needsRender: little text and mostly script', () => {
  expect(needsRender(`<div id=app></div><script>${'x'.repeat(5000)}</script>`, '')).toBe(true)
  expect(needsRender('<p>…long article…</p>', 'a'.repeat(3000))).toBe(false)
})
test('pageFacts splits internal and external links, PDFs, app links and JSON-LD types', () => {})
test('pageFacts of an archive copy resolves links against the original URL', () => {})
test('parseSitemap tells an index from a URL set', () => {})
test('Sites rejects a duplicate domain', () => {})
```

- [ ] **Step 2: Run** `npm test -- atlas-facts` → FAIL.
- [ ] **Step 3: Implement** per Interfaces (reuse `linksIn`, `jsonLd`, `pageTitle`, `appStoreLinks` from `pipeline/fetch/html.ts`).
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(atlas): report schema and page facts"`

---

### Task 7: `atlas:crawl`

**Kind:** integration.

**Files:**
- Create: `pipeline/atlas/crawl.ts`, `pipeline/atlas/cli.ts`, `data/atlas/sites.json`
- Modify: `package.json` (scripts)
- Test: `tests/pipeline/atlas-crawl.test.ts`, `tests/pipeline/atlas-cli.test.ts`

**Interfaces:**
- Consumes: `fetchPage`, `readLog`, `findInLog` (Task 1); `config.atlas`, `config.onSaleSince` (Task 2); `upsertEdge`, `upsertEntity`, `writeGraph`, `Graph` (Task 4); `cdx`, `lastCopyPerYear`, `copiesPerYear` (`pipeline/sources/wayback.ts`) and `archiveUrl`, `parseArchiveUrl` (`src/lib/archive-url.ts`) (Task 5); `Site`, `SiteReport`, `pageFacts`, `urlTemplates`, `parseSitemap`, `sections` (Task 6).
- Produces (`crawl.ts`):
  - `class SiteRefusedError extends Error { readonly domain: string; readonly url: string; readonly reason: 'rate-limited' | 'bot-protection' }`
  - `crawlSite(site: Site, known: Site[], opts?: { refresh?: boolean; budget?: number }): Promise<{ report: SiteReport; graph: (g: Graph) => Graph }>` — `graph` applies the observed domain edges and their domain entities.
- Produces (`cli.ts`): `atlasMain(argv: string[], opts?: { dataDir?: string; progressDir?: string }): Promise<number>` — commands `crawl | describe | relations`, flags `--site <domain>`, `--resume`, `--refresh`; exit 0 done, 1 bad arguments, 2 stopped (LLM usage limit or `SiteRefusedError`, printing `Resume later: npm run atlas:<command> -- --resume [--site …]`). Units per site through `Progress` at `<progressDir>/atlas-<command>.json`. Loads `.env.local` when run directly, like `pipeline/cli.ts`.
- Produces (`package.json`): `"atlas:crawl": "tsx pipeline/atlas/cli.ts crawl"`, `"atlas:describe": "tsx pipeline/atlas/cli.ts describe"`, `"atlas:relations": "tsx pipeline/atlas/cli.ts relations"`.
- Writes: `data/atlas/sites/<domain>/report.json` only after the crawl of that site completes.

Crawl, in order:
1. **robots.txt** through `fetchPage(<origin>/robots.txt)`; groups, Crawl-delay and `Sitemap:` lines. Archive mode: the robots.txt of web.archive.org applies through the fetcher; the archived robots.txt at the chosen timestamp goes into `robots.archived`.
2. **Sitemaps**: declared ones, else `/sitemap.xml`; an index is followed for at most `config.atlas.sitemapBudget` files; listed URLs are counted into `sitemap.sections` and `urls`, never fetched. A `.gz` sitemap is a failure entry.
3. **BFS** from `start` plus the first URL of each sitemap section, within `include` and `isInternal`. Within one BFS level, URLs whose path matches `/hearing|product|aid|support|guide|manual|download|document|app|catalog/i` come first. PDFs are recorded, not fetched. The budget counts requests made (ok or HTTP error), not robots or blocklist refusals, which go to `failures`. A `rate-limited` or `bot-protection` skip throws `SiteRefusedError`.
4. **Archive mode**: CDX for `start` with `filter: ['statuscode:200']`, `from: <onSaleSince year>`, `collapse: 'timestamp:8'`; `lastCopyPerYear` picks the copies; BFS reads the latest one through `archiveUrl(ts, url, { raw: true })` and every link keeps that timestamp.
5. **Archive coverage** (both modes) for up to `config.atlas.cdxSections` key URLs (start, then the biggest sitemap sections, then the site's brands' `catalogUrls`/`supportUrls`): same CDX query; `byYear` from `copiesPerYear`, `latest` from the last row.
6. **Summaries**: `templates` from all `urls`; `outbound` by domain (without `www.`), count desc; `pdfHosts`; `redirects` from the log entries of crawled pages whose `finalUrl` host differs.
7. **Observed edges** (`internal`, `observed`, sources `{ url, fetchedAt, kind: 'crawl' }`): `redirects-to` for a redirect to another domain; `hosts-documents-for` from a PDF host to the site's domain; `links-to` only towards domains listed in `sites.json`.

`data/atlas/sites.json` (manual list, decision 3): one live entry per `data/brands/*.json` website except Eargo and Lexie (domain from `website`; Apple with `include: '^https://www\\.apple\\.com/airpods-pro/'`, Kirkland on costco.com with `include` limited to `hearing-aid` URLs); group sites `sonova.com`, `demant.com`, `wsa.com`, `gn.com` (`kind: 'group'`, `company` set; Starkey's group site is its brand site); archive entries `eargo.com`, `lexiehearing.com` (brands `eargo`, `lexie`) and `livelyhearing.com` (`newBrand: { slug: 'lively', name: 'Lively', group: 'GN', defaultType: 'otc' }`, the brand that became Jabra Enhance). Group sites of the OTC brands' parents are added when the owner names their domains.

- [ ] **Step 1: Write the failing crawl tests** (mock `fetchPage` and `cdx` with a fixture site map, as `tests/pipeline/cli.test.ts` mocks the fetcher)

```ts
test('crawls breadth-first within the budget, catalog-like paths first', async () => {
  const { report } = await crawlSite(site, [site], { budget: 3 })
  expect(report.pages.map((p) => p.url)).toEqual([home, `${origin}/hearing-aids`, `${origin}/support`])
  expect(report.pages.every((p) => p.ref.fetchedAt === FETCHED_AT)).toBe(true)
})
test('sitemap URLs are counted, never fetched', async () => {})
test('stays inside include and the site domain; outside links are only counted', async () => {})
test('a 429 in the middle throws SiteRefusedError', async () => {
  await expect(crawlSite(site, [site])).rejects.toMatchObject({ reason: 'rate-limited' })
})
test('archive mode reads the latest 200 copy and keeps its timestamp on every link', async () => {})
test('observed edges: a redirect to another domain, a PDF host, a link to a listed site', async () => {})
test('report urls are sorted and capped', async () => {})
```

- [ ] **Step 2: Write the failing CLI tests** (`tests/pipeline/atlas-cli.test.ts`, temp `dataDir`)

```ts
test('crawl writes report.json and the observed edges', async () => {})
test('a refused site keeps its old report and its unit; --resume crawls it again', async () => {
  expect(await atlasMain(['crawl'], opts)).toBe(2)
  expect(await readFile(reportPath, 'utf8')).toBe(oldReport)
  expect(await atlasMain(['crawl', '--resume'], opts)).toBe(0)
})
test('--site limits the run to one domain; an unknown domain exits 1', async () => {})
test('runs without NEXT_PUBLIC_SITE_URL', async () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
  expect(await atlasMain(['crawl'], opts)).toBe(0)
})
```

- [ ] **Step 3: Run** `npm test -- atlas-crawl atlas-cli` → FAIL.
- [ ] **Step 4: Implement `crawl.ts`, `cli.ts` (crawl only; `describe` and `relations` print "not implemented" with exit 1 until Tasks 9–10), the scripts, and `data/atlas/sites.json`.** A test reads the real `sites.json` through `Sites.parse`.
- [ ] **Step 5: Run** `npm test`, `npx tsc --noEmit` → clean. Do not run the crawl against real sites.
- [ ] **Step 6: Commit** `git commit -m "feat(atlas): budgeted site crawl into report.json"`

---

### Task 8: Review kinds `brand-config` and `relation` (decision logic)

**Kind:** integration (review logic; the cards that show these kinds come in Task 12).

**Files:**
- Modify: `src/lib/schema/pending.ts`, `pipeline/apply.ts` (`pendingKind`, `planChange`), `src/lib/review/apply-decision.ts` (`changeKind`, `assertCurrent`)
- Create: `src/lib/review/config-diff.ts`
- Test: `tests/lib/apply-decision.test.ts`, `tests/pipeline/apply.test.ts`, `tests/lib/config-diff.test.ts`

**Interfaces:**
- Consumes: `Brand` (Task 3); `Graph`, `Edge`, `Entity`, `upsertEdge`, `upsertEntity` (Task 4).
- Produces (`pending.ts`): `CandidateChange.kind` and `PendingChange.kind` gain `'brand-config'` and `'relation'`; both gain `refs?: string[]` (URLs or repository paths shown on the card); `CheckResult.name` gains `'pattern'` and `'log'`.
- Conventions: brand-config → `modelSlug: null`, `path: 'brands/<slug>'`, `before?: Brand` (absent when there is no file), `after: Brand`. relation → `modelSlug: null`, `path: 'graph/<edgeKey>'`, `after: { edge: Edge; entities: Entity[] }`.
- Produces (`apply.ts`): `pendingKind` keeps `brand-config` and `relation` whatever their checks (failed checks show on the card). `planChange` for `brand-config` writes `brands/<slug>.json` with `Brand.parse(after)`; for `relation` writes `graph/entities.json` and `graph/edges.json`, the edge set to `visibility: 'public'`, `status: 'verified'` and `Graph.parse`d (an edge without a quoted primary source fails here). No events.
- Produces (`apply-decision.ts`): `changeKind` returns these kinds as stored; `assertCurrent` refuses a brand-config when the stored brand equals neither `before` nor `after` (`brand <slug> has changed since this was proposed: reject it, or run atlas:describe again`), and one with no `before` when a file exists.
- Produces (`config-diff.ts`): `configDiff(before: unknown, after: unknown): { path: string; before?: unknown; after?: unknown }[]` — changed leaves by dot path; arrays compared whole.

- [ ] **Step 1: Write the failing tests**

```ts
test('approving a brand-config writes the brand file', () => {
  const result = applyDecision(dataset([brandConfig({ before: phonak, after: proposed })]), id, { action: 'approve' })
  expect(result.writes).toEqual([{ path: 'brands/phonak.json', value: proposed }])
})
test('a brand-config for a gone brand without a file creates it', () => {})
test('a brand-config whose brand changed since is refused', () => {
  expect(() => applyDecision(dataset([brandConfig({ before: phonak, after: proposed })], { brands: [edited] }), id, { action: 'approve' })).toThrow('has changed since')
})
test('approving a relation makes the edge public and verified and adds its entities', () => {})
test('a relation without a quoted primary source cannot be approved', () => {})
test('rejecting either kind records its fingerprint; the same proposal later drops', () => {})
test('enqueue keeps the kind of a brand-config with a failed check', async () => {})
test('configDiff lists changed leaves only', () => {
  expect(configDiff({ scraper: { render: false, catalogUrls: ['a'] } }, { scraper: { render: false, catalogUrls: ['a', 'b'] } })).toEqual([
    { path: 'scraper.catalogUrls', before: ['a'], after: ['a', 'b'] },
  ])
})
```

- [ ] **Step 2: Run** `npm test -- apply-decision apply config-diff` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run build` → green.
- [ ] **Step 5: Commit** `git commit -m "feat(review): decide brand config proposals and company relations"`

---

### Task 9: `atlas:describe`

**Kind:** integration / judgment (prompt).

**Files:**
- Create: `pipeline/atlas/describe.ts`, `pipeline/atlas/relation.ts`
- Modify: `pipeline/llm/index.ts`, `pipeline/llm/claude-cli.ts`, `pipeline/atlas/schema.ts`, `pipeline/atlas/cli.ts`
- Test: `tests/pipeline/atlas-describe.test.ts`, `tests/pipeline/llm.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 6, 7, 8; `enqueue`, `route` (`pipeline/apply.ts`); `literalCheck` (`pipeline/checks/literal.ts`); `excerpt`, `PROMPT_TEXT_BUDGET`.
- Produces (`llm`): `LlmOptions.model?: string` (Claude only) — replaces `config.llm.claudeModel` in the `--model` argument and in the cache key.
- Produces (`schema.ts`): `SECTION_KEYS = ['what', 'structure', 'where', 'render', 'links', 'archive', 'next'] as const` with headings "What this site is and whose", "Structure", "Catalog, support, documents and apps", "Rendering and quirks", "Links to other sites", "Web Archive", "What the next agent should check"; `Statement = { text: string; sources: LogRef[] (min 1) }`; `Description = { domain, generatedAt, model, summary: string, sections: Record<SectionKey, Statement[]>, openQuestions: string[] }`; `ConfigProposal = { catalogUrls: HttpUrl[], supportUrls: HttpUrl[], modelUrlPattern: string, documentUrlPattern?: string, render: boolean, archive?: { catalogUrls: HttpUrl[]; modelUrlPattern?: string }, status: BrandStatus }`.
- Produces (`relation.ts`): `type ProposedRelation = { edge: Edge; entities: Entity[]; checks: Record<string, CheckResult[]> }`; `entityFor(name: string, kind: 'brand' | 'company' | 'app', brands: Brand[]): Entity` (a brand name in `normalizeName` form → `brand:<slug>`); `queueRelation(rel: ProposedRelation, dataset: Dataset, dataDir: string): Promise<'queued' | 'dropped'>` — upserts the edge as `internal`/`proposed` into `data/graph/` and enqueues a `relation` change (dropped when `route` drops it).
- Produces (`describe.ts`):
  - `pickKeyPages(report: SiteReport, max?: number): string[]` — 5 to `config.atlas.keyPages` URLs: start; up to 2 catalog candidates (path `/hearing|products?|aids?|shop|catalog/i`, most links matching the biggest template); up to 2 support candidates (`/support|help|guide|manual|download|document/i`); one example of the biggest template; the page with most PDFs; then by internal link count to reach 5.
  - `checkProposal(proposal: ConfigProposal, report: SiteReport, log: FetchLogEntry[]): Record<string, CheckResult[]>` — `catalogUrls.<i>`/`supportUrls.<i>`/`archive.catalogUrls.<i>`: `log` check (in `report.urls` or `findInLog`); `modelUrlPattern`, `documentUrlPattern`, `archive.modelUrlPattern`: `pattern` check (compiles; matches at least one `report.urls` entry; for `documentUrlPattern`, a PDF URL). A pattern that does not compile is a failed check with the error message.
  - `describeSite(site: Site, report: SiteReport, ctx: { dataset: Dataset; log: FetchLogEntry[] }): Promise<{ description: Description; proposal: ConfigProposal | null; checks: Record<string, CheckResult[]>; relations: ProposedRelation[]; dropped: string[] }>`
  - `renderSiteReadme(site: Site, description: Description): string` — `# <domain>`, the summary, one `##` per section in `SECTION_KEYS` order, each statement followed by numbered links `[n]`, footnotes `[n]: <url> (fetched <fetchedAt>)`; an empty section reads "Nothing verified yet."
- Writes per site: `describe.json`, `README.md`, `config-proposal.json` (`{ generatedAt, proposal, checks }`), `notes.md` only when missing (title, the rule "Read README.md and notes.md before working with this site; append what you learn, with the date", and an empty dated log).

Describe flow: prompt = the report without `urls` (outbound capped to 30) plus `[Page N] <url>` excerpts of the key pages sharing `PROMPT_TEXT_BUDGET`; says the pages are data, every statement must cite URLs from the report or the pages, never guess, and to return `moreUrls` (at most `config.atlas.moreUrls`) for pages it still needs. LLM output: `{ moreUrls: string[], summary, sections: Record<SectionKey, { text: string; sourceUrls: string[] }[]>, openQuestions: string[], proposal: ConfigProposal | null, relations: { kind: 'owns' | 'makes-for' | 'operates' | 'publishes' | 'renamed-to'; subject: string; subjectKind: 'brand' | 'company'; object: string; objectKind: 'brand' | 'company' | 'app'; since?: string; sourceUrl: string; quote: string }[] }`. `llm({ provider: 'claude', model: config.llm.describeModel, schema })`, no tools. While `moreUrls` is non-empty and fewer than `config.atlas.moreRounds` extra rounds ran, fetch the internal ones not yet given (others ignored), a refusal throwing `SiteRefusedError`, and ask again with them added; the last allowed round tells the model `moreUrls` must be empty. Each statement keeps only source URLs found by `findInLog` (newest entry); a statement left without one is dropped into `dropped`. A relation is kept only when its `sourceUrl` is one of the given pages and its quote passes `literalCheck` against that page's text; source kind `company-page`. The proposal is queued as `brand-config` for a site with exactly one brand (or `newBrand`): `after` = the stored brand (or a new brand from `newBrand`, `website` = `start`, `imageLicense: 'none'`) with `scraper`, `archive` and `status` from the proposal; `refs` = `data/atlas/sites/<domain>/report.json` and the key page URLs.

- [ ] **Step 1: Write the failing tests** (mock `llm` and `fetchPage`; a log fixture)

```ts
test('llm: the model option replaces the provider model and keys the cache', async () => {
  await llm({ prompt: 'p', schema, provider: 'claude', model: 'sonnet' }, deps)
  expect(exec.mock.calls[0][1]).toEqual(expect.arrayContaining(['--model', 'sonnet']))
  // a second call without `model` is not answered from that cache entry
})
test('describe asks Claude with the describe model and no tools', async () => {
  expect(llm).toHaveBeenCalledWith(expect.objectContaining({ provider: 'claude', model: 'sonnet' }))
  expect(vi.mocked(llm).mock.calls[0][0].tools).toBeUndefined()
})
test('a statement citing a URL that is not in the fetch log is dropped', async () => {
  expect(description.sections.where.map((s) => s.text)).toEqual(['Catalog at /hearing-aids'])
  expect(dropped).toEqual(['where: "Manuals at /secret"'])
})
test('a source reached through a redirect or the Web Archive counts by its final URL', async () => {})
test('patterns in the proposal are checked against the report URLs', () => {
  expect(checkProposal({ ...proposal, modelUrlPattern: '^https://x\\.test/nothing/' }, report, log).modelUrlPattern).toEqual([
    { name: 'pattern', ok: false, detail: 'matches no URL of the report' },
  ])
  expect(checkProposal({ ...proposal, modelUrlPattern: '(' }, report, log).modelUrlPattern[0]).toMatchObject({ name: 'pattern', ok: false })
})
test('asks for at most 10 more internal URLs, at most twice', async () => {})
test('a relation whose quote is not on its page is dropped; a quoted one becomes a proposed edge and a relation card', async () => {})
test('pickKeyPages picks home, catalog and support candidates, a model page and the PDF page', () => {})
test('renderSiteReadme keeps the section order and numbers the sources', () => {})
test('a gone brand without a file gets a full brand proposal from newBrand', async () => {})
test('notes.md is created once and never overwritten', async () => {})
```

- [ ] **Step 2: Run** `npm test -- atlas-describe llm` → FAIL.
- [ ] **Step 3: Implement** the `llm` option, `relation.ts`, `describe.ts` and the `describe` command (units per site; a site without `report.json` is skipped with a message).
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(atlas): describe sites, propose brand configs and relations"`

---

### Task 10: `atlas:relations`

**Kind:** integration / judgment (prompt).

**Files:**
- Create: `pipeline/atlas/relations.ts`
- Modify: `pipeline/atlas/cli.ts`
- Test: `tests/pipeline/atlas-relations.test.ts`

**Interfaces:**
- Consumes: `ProposedRelation`, `entityFor`, `queueRelation` (Task 9); `lookupApp`, `fetchClearances` (Task 5); `fetchableUrls`, `currentMonth` (`pipeline/sources/reviews.ts`); `literalCheck`; `containsName`, `slugify`.
- Produces (`relations.ts`):
  - `sourceKindFor(url: string, claimed: SourceKind, edgeKind: EdgeKind, ownDomains: string[]): SourceKind | null` — `sec-filing` only on `sec.gov` hosts, `fda-record` only on `fda.gov` hosts, `app-store` only on `itunes.apple.com`/`apps.apple.com`, `company-page` only on `ownDomains` (sites.json domains of the subject or object and the brand's website host), `press-release` on any host, `third-party` only for `makes-for`; anything else `null`.
  - `searchClaims(subject: { name: string; kind: 'brand' | 'company' }, ctx): Promise<ProposedRelation[]>` — `llm({ provider: 'claude', tools: ['WebSearch'], … })` with `currentMonth()` in the prompt; claims `{ kind: 'owns' | 'makes-for' | 'publishes' | 'renamed-to', subject, subjectKind, object, objectKind, since?, url, quote, sourceKind }`, plus `secCik?: string`. Each URL goes through `fetchableUrls` and `fetchPage`; a claim stays when both names appear on the page, the quote passes `literalCheck`, is at most 300 characters and names at least one of them, and `sourceKindFor` accepts it.
  - `secFiler(cik: string, company: Entity): Promise<ProposedRelation | null>` — `https://data.sec.gov/submissions/CIK<cik padded to 10>.json`; kept when its `name` and the company name contain each other (`containsName` either way); edge `company files-as sec-filer:<cik>`, source kind `sec-filing`, quote = the SEC `name`.
  - `fdaApplicants(brands: Brand[]): Promise<{ entities: Entity[]; relations: ProposedRelation[] }>` — `fetchClearances(config.onSaleSince)`; one `fda-applicant` entity per distinct applicant; a `files-as` relation from `brand:<slug>` when the applicant contains the brand name, or from the group company when it contains `brand.group`; source = the clearance's `ref` with kind `fda-record`, quote = the applicant as written.
  - `appPublishers(report: SiteReport, brand: Brand): Promise<ProposedRelation[]>` — each iOS id in the report's pages through `lookupApp`; a `publishes` relation from the brand when `seller` contains the brand name or group; source = `lookupUrl`, kind `app-store`, quote = `seller`.
- `relations` command: per brand and per group company in `sites.json`, one unit each; SEC only when `NEXT_PUBLIC_CONTACT_EMAIL` is set (else one line: `SEC skipped: NEXT_PUBLIC_CONTACT_EMAIL is not set`); FDA applicants once per run as unit `fda-applicants`; every kept relation through `queueRelation`.

- [ ] **Step 1: Write the failing tests**

```ts
test('a claim whose quote is not on the page is dropped', async () => {})
test('an SEC filing on another host, or a third-party source for owns, is refused', () => {
  expect(sourceKindFor('https://news.test/x', 'sec-filing', 'owns', [])).toBeNull()
  expect(sourceKindFor('https://news.test/x', 'third-party', 'owns', [])).toBeNull()
  expect(sourceKindFor('https://news.test/x', 'third-party', 'makes-for', [])).toBe('third-party')
})
test('search results go through fetchableUrls: Google and Amazon are never fetched', async () => {})
test('the SEC step is skipped without a contact address', async () => {})
test('a CIK whose SEC name does not match the company is dropped', async () => {})
test('FDA applicants become entities; one naming a brand gets a proposed files-as relation', async () => {})
test('an app whose seller is the brand gives a publishes relation', async () => {})
test('every kept relation is a proposed internal edge and a relation card', async () => {})
```

- [ ] **Step 2: Run** `npm test -- atlas-relations` → FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(atlas): find sourced company relations, SEC filers and FDA applicants"`

---

### Task 11: Atlas index, the notes rule and documentation

**Kind:** mechanical.

**Files:**
- Create: `pipeline/atlas/index-file.ts`, `CLAUDE.md`
- Modify: `pipeline/atlas/cli.ts` (rewrite the index after every command), `README.md`
- Test: `tests/pipeline/atlas-index.test.ts`

**Interfaces:**
- Consumes: `Sites`, `SiteReport`, `Description` (Tasks 6, 9); `loadDataset`.
- Produces: `type IndexEntry = { domain: string; reportAt?: string; describedAt?: string; status?: BrandStatus; summary?: string; openQuestions: string[] }`; `renderAtlasIndex(entries: IndexEntry[], candidates: { domain: string; count: number }[]): string`; `writeAtlasIndex(dataDir?: string): Promise<void>` — reads `sites.json`, every `report.json`/`describe.json` and the brand files; candidates = outbound domains with ≥ 3 links over all reports that are not in `sites.json` or the blocklist, top 30.
- `data/atlas/README.md` layout: title; "How to use the atlas" (read the site's `README.md` and `notes.md` before working with it, append what you learn to `notes.md` with the date); one table row per site (domain linked to its folder, report date, description date, brand status, summary, open questions); "Candidate domains" (not crawled; add to `sites.json` only on the owner's word); "How to update the atlas" (`npm run atlas:crawl -- --site <domain>`, then `atlas:describe`, then `atlas:relations`, then decide the cards on `/review`).
- `CLAUDE.md`: the same notes rule, the rule that brand configs change only through `/review`, and that raw pages live only in `.cache/raw/`.
- `README.md`: new section "Site atlas" (commands, what is committed, raw store location and size note, backup is the owner's), "Company graph" (visibility and status, what reaches the site), and the `rate-limited` skip in "Scraping rules".

- [ ] **Step 1: Write the failing tests**

```ts
test('the index has one row per site, the rule, candidates and the update section', () => {
  const text = renderAtlasIndex([entry], [{ domain: 'cdn.example', count: 4 }])
  expect(text).toContain('Read README.md and notes.md')
  expect(text).toContain('| [phonak.com](sites/phonak.com/) |')
  expect(text).toContain('cdn.example (4 links)')
  expect(text).toContain('## How to update the atlas')
})
test('a site without a report or description shows dashes', () => {})
```

- [ ] **Step 2: Run** `npm test -- atlas-index` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; write `CLAUDE.md` and the README sections (no personal details, no User-Agent beyond the SEC contact).
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "docs(atlas): atlas index, notes rule and README"`

---

### Task 12: UI: atlas cards on `/review`, company block, `/companies`

**Kind:** integration (UI). No data task depends on it.

**Files:**
- Create: `app/review/AtlasCard.tsx`, `src/lib/site/companies.ts`, `src/components/CompanyBlock.tsx`, `app/companies/page.tsx`
- Modify: `app/review/page.tsx`, `app/brands/[brand]/page.tsx`, `src/lib/site/sitemap-entries.ts`, `app/layout.tsx` (footer link "Who owns which brand")
- Test: `tests/app/review-guard.test.ts`, `tests/lib/companies.test.ts`, `tests/components/company-block.test.tsx`, `tests/lib/sitemap.test.ts`

**Interfaces:**
- Consumes: `Graph`, `Edge`, `EdgeSource` (Task 4); `configDiff` and the pending conventions (Task 8); `approveChange`/`rejectChange`; `SourceNote`.
- Produces (`AtlasCard.tsx`): a brand-config card as a `configDiff` table with its checks and `refs` (http(s) as links, paths as `<code>`); a relation card as "<from name> <kind> <to name> since <since>" with each source's link, kind and quote; both through `approveChange`/`rejectChange`. `/review` lists atlas cards before the change table.
- Produces (`companies.ts`):
  - `publicEdges(graph: Graph): Edge[]` — `visibility === 'public' && status === 'verified'` only.
  - `type CompanyBlockData = { owner?: { name: string; since?: string; sources: EdgeSource[] }; siblings: string[] /* brand slugs */; makers: { name: string; sources: EdgeSource[] }[]; apps: { name: string; iosId?: string; androidId?: string; sources: EdgeSource[] }[] }`
  - `companyBlock(brandSlug: string, graph: Graph): CompanyBlockData | null` — null when the brand has no public edge.
  - `type OwnershipRow = { company: string; brands: { slug: string; name: string; since?: string; sources: EdgeSource[] }[] }`
  - `ownershipTable(graph: Graph, brands: Brand[]): OwnershipRow[]` — companies by name, brands by name.
  - `edgeSourceNote(source: EdgeSource)` → `{ sourceUrl, sourceType: source.kind === 'third-party' ? 'third-party' : 'official' }` for `SourceNote`.
- Site: the brand page shows "Company" when `companyBlock` is not null (owner and year, sibling brands linked to their pages, makers with sources, apps linked to `https://apps.apple.com/app/id<iosId>` and `https://play.google.com/store/apps/details?id=<androidId>`). `/companies`, title "Who owns which hearing aid brand", lists `ownershipTable`; with no rows it says "No verified ownership records yet." and is `noindex`. The sitemap lists `/companies` only when it has rows, dated by the newest source `fetchedAt`.

- [ ] **Step 1: Write the failing tests**

```ts
test('internal or proposed edges never reach the block or /companies', () => {
  const graph = graphWith([{ ...owns, visibility: 'internal', status: 'proposed' }])
  expect(companyBlock('phonak', graph)).toBeNull()
  expect(ownershipTable(graph, brands)).toEqual([])
})
test('the block gives owner, since, siblings, makers and apps of public edges', () => {})
test('a third-party maker source reads "According to <host>"', () => {
  render(<CompanyBlock data={blockWithThirdPartyMaker} brands={brands} />)
  expect(screen.getByText('According to hearingtracker.com')).toBeTruthy()
})
test('/companies is in the sitemap only with a verified ownership record', () => {})
test('the atlas cards approve and reject through the guarded actions', async () => {}) // review-guard: outside development and from a non-loopback host both refuse
```

- [ ] **Step 2: Run** `npm test -- companies company-block sitemap review-guard` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; no JSON-LD added.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run build` → green.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): atlas review cards, company block and /companies"`

---

## After the plan (owner's run, not a task)

1. `npm run atlas:crawl` (about 4–5 minutes per site), 2. `npm run atlas:describe`, 3. `npm run atlas:relations`, 4. decide the `brand-config` and `relation` cards on `/review`, 5. commit `data/atlas`, `data/graph`, `data/brands`. Only then do the scrape and the archive (`docs/superpowers/plans/2026-11-27-model-archive.md`) run on the approved configs.
