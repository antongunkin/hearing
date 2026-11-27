# Rulings made during the site atlas and model archive build (2026-11-27)

Decisions the orchestrator took on the owner's behalf while executing
docs/superpowers/plans/2026-11-27-site-atlas.md and 2026-11-27-model-archive.md.
Each line is copied from the execution ledger, in order; most say what it costs if wrong.

- ## Rulings carried from the atlas plan (verbatim)
- Pre-flight: table in preflight.md (29 pair rows, 12 task rows). Rulings (all proposed rulings accepted):
- Ruling F1: no SEC User-Agent exception — owner's "no custom UA at all" is newer than spec — drop userAgentFor and any UA header; SEC EDGAR step always skipped (spec's own fallback); searchClaims drops sec.gov URLs before fetching; update existing guard tests stay green — cost if wrong: no sec-filer nodes (rare, Eargo only).
- Ruling F3: Task 2 also updates app/about-bot/page.tsx for the Web Archive pause.
- Ruling F4: Task 9 re-reads the fetch log after each extra-URL round before citation checks.
- Ruling F5: Task 9 labels archive pages with the logged (archive) URL; README shows citableArchiveUrl.
- Ruling F6: edge kind `operates` may target entity kind `domain` (add domain kind usage for operates only).
- Ruling F7: Task 7 archive mode fetches one catalog/home copy per year from 2018 (latest 200 of each year), crawls from the latest.
- Ruling F8: WaybackError 429/block → SiteRefusedError (stops the step, resumable).
- Ruling F9: "429 stops the step" applies to atlas:crawl and atlas:describe; in atlas:relations a refused URL drops only its claim; openFDA/iTunes refusal stops that unit.
- Ruling F10: queueRelation skips edges already verified.
- Ruling F11: FDA applicant entities are written even without a relation.
- Ruling F12: re-approving a new-brand proposal passes when the file already equals the proposal.
- Ruling F13: define OkPage locally in facts.ts. F14: drop readGraphFiles. F15: literalCheck takes a sourced field (note for implementers).
- Ruling F17: OTC parents' corporate sites deferred; add from candidate list after first real crawl. F18: Task 3 sets Eargo/Lexie gone. F19: crawl costco.com limited to hearing-aid URLs.
- Ruling: Task 12 (review cards + UI) runs before the real crawl (owner approves configs through it).
- Task 4: Ruling: domain edge kinds restricted to crawl sources and never verified (stricter than brief) — accepted: blocks neither Task 9 nor 10 — cost if wrong: one-line loosen in graph.ts:65
- Task 7: Ruling: escalate review Minors 3 (sitemap parsed from visible text), 4 (zero-page run overwrites report, marked done), 6 (--site run clears full-run progress) into fix round 1 — they make real runs silently wrong — cost if wrong: a slightly longer fix round
- Task 9: Ruling: README summary must cite and verify like any statement, else omitted — spec says every README statement has a log-backed source — cost if wrong: README without a summary line
- Task 9: Ruling: escalate Minors 1 (made-up archive timestamp passes) and 2 (empty pattern passes) into fix round 1 — hallucination guard
- Task 10: Ruling: relations search uses claudeModel (haiku) — claims are code-verified against fetched text — cost if wrong: weaker search recall
- Task 10: Ruling: openFDA/iTunes refusal stopping the whole run (resumable) accepted as reading of F9
- Task 10: Ruling: escalate Minors 1 (sec.gov redirect followed, breaks F1) and 2 (duplicate app node ids) into fix round 1
- Task 12: Ruling: company block semantics owner=owns→brand, makers=makes-for→brand, apps=publishes from brand, siblings=owner's other owns — matches spec section 4
- Task 12: Ruling: escalate Minors 2 (AtlasCard unvalidated cast + no until), 5 (crawl sources shown) and Task 4 minor (groupMismatches ended owners) into fix round 1
- Ruling: final-review Critical — a refusal (403/503/429/bot-wall) on one site stops only that site: write its partial report with a `refused` failure, record it as refused (plain --resume skips it, `--site X` retries it), continue, exit 2 at the end; whole-run stop only when web.archive.org refuses (shared by all archive sites). No retry loops, no bypass — cost if wrong: a transient 503 leaves one site with a partial report until re-run with --site
- Ruling: final-review fix wave also includes deferred minors CDATA locs, `[?&]id=` host restriction, gone-host subdomain match, AtlasCard raw id_ URL, describe prompt external-link counts — cheap and they affect the first real run
- Final: parked — "matches every URL" check now runs on a list including off-host PDFs, so a catch-all modelUrlPattern can pass — Ruling: real but non-blocking; owner sees the pattern on the /review card; fix in archive plan's first touch of describe.ts
- Final: parked — refusal before any page writes an empty report; describe spends an LLM call on it — Ruling: deferred, cost is one LLM call per such site
- Ruling A-F1: drop userAgentFor, secFilings, secCik and the SEC test; Task 10 tests that no sec.gov URL is fetched; SEC always skipped.
- Ruling A-F2 (Task 4): with --limit or a failed model page the catalog is incomplete — no discontinued proposals that run; a stored model also counts as listed when a catalog URL is among its stored sourceUrls.
- Ruling A-F3 (Task 12): owner said "no questions" — Task 12 commits the research file, changes no data; the owner approves later through /review.
- Ruling A-F4 (Task 4 vs 7): `update` proposes new models only from catalog pages; support-only models are left to `archive`.
- Ruling A-F5 (Task 7): a refusal stops only that brand (recorded refused, retried with --brand, exit 2 at end); only a web.archive.org refusal stops the whole command.
- Ruling A-F6 (Task 7): support-linked model whose live product page still answers gets the orphan-product-page check.
- Ruling A-F7 (Task 8): lifecycleOf null → fall back to the archived model page; every archive-imported model is discontinued, never on sale.
- Ruling A-F8..F10 (Task 8): normalise archive.catalogUrls to original URLs before CDX; timestamp from the copy actually served; fuzzier same-brand match by name or original URL ("Audéo Paradise" vs "Paradise").
- Ruling A-F11 (Task 10): sourceKindFor(url, claimed, edgeKind, ownDomains) with press-release/company-page only; quotes ≤300 chars.
- Ruling A-F12: Task 7 wires and tests the archive-documents unit; archived PDFs read raw (id_); a replacement copy must pass checkDocument; a gone brand's live document is never fetched.
- Ruling A-F13: gone-host check covers subdomains and history fact sources; a gone brand's history sources are read only as archive copies.
- Ruling A-F14..F21: lineage/app links only for stored models; add `origin` to Change and pass it through applyDecision; import OkPage from pipeline/atlas/facts.ts; route brand-history cards to AtlasCard; replace the brand page's existing gone-brand block (no second one); latest copy per year accepted; a skipped iTunes lookup stops the unit (not "no app"); SourceNote labels archive-derived dates with archiveLabel.
- Ruling A-NM: namesModel must match a model stored as "Paradise" in text "Phonak Audéo Paradise" (brand + sub-line words allowed between brand and model) — Tasks 2/6/8 add a test with that exact case — cost if wrong: false matches on short names; owner reviews cards.
- Ruling A-UI-last: data tasks 1-12 before site tasks 13-14 (owner: DB first).
- Task 2: Ruling: escalate Minor 1 (fallback quote = first page line) into fix round 1; include brand display-name match
- Task 3: Ruling: escalate Minors 1 (lineage overwrite / self-link) and 2 (brand-history staleness test) into fix round 1
- Task 4: Ruling: spec wins over brief — a model missing from the live catalog gets a discontinued proposal, dateless if no copy names it — cost if wrong: more cards to review
- Task 4: Ruling: only HTTP 404/410 count as gone; escalate Minors 1 (redirect to listed URL = listed) and 2 (any empty catalog page = incomplete) into fix round 1
- Task 5: Ruling: lineage names stay exact-match (brief says plain match); shorter claims ("Paradise" vs stored "Audéo Paradise") are dropped with a log line — cost if wrong: fewer lineage cards; revisit with a unique-suffix fallback if the first run shows many drops
- Task 7: Ruling: A-F4 wins over brief — archive skips inCatalog groups and never overwrites another origin's pending card
- Task 7: Ruling: escalate Minors (per-model documents guard, real "no events" assertion, applyDecision replacement test) into fix round 1
- Task 8: Ruling: name match = equal or shorter name is a whole-word suffix with only brand/sub-line words before it; null lifecycle → drop new candidate / skip discontinued for stored — cost if wrong: some archive models need a manual merge
- Task 8: Ruling: escalate Minors (scope before PDF fetch, per-URL yearlyCopies, import OkPage) into fix round 1
- Task 9: Ruling: fix the plan-mandated matching — brand-in-text for weak names, drop other brands when text names one, no prefix-of-longer matches — cost if wrong: fewer FDA numbers filled
- Task 9: Ruling: round-3 re-review done by controller reading the 4-line diff (allowlist replaces /^[a-z]{1,2}$/; tests reported 941 pass) — trivial and unambiguous — cost if wrong: one more Haiku pass
- Task 10: Ruling: escalate loaded-terms guard (bankrupt/fraud/sued/... must appear in the quote) — legal risk of characterising a real company — cost if wrong: a few true facts dropped
- Task 10: round 1 committed 4ea360b; Ruling: fact dates verified against the source page text (dateline), year-only allowed (HistoryFact date YYYY|YYYY-MM) — quotes rarely contain the date — cost if wrong: a fact dated by a different date on the same page; fix round 2 sent
- Task 13: Ruling: indexing threshold counts any sourced row (third-party/derived included) — literal brief reading — cost if wrong: a few thin pages indexed
- Task 13: Ruling: escalate Minors 2 (last-listed price month capped) and 3 (sitemap pair test) into fix round 1
- Task 13: fix round 1/5 committed 99f1c4a; Ruling: re-review done by controller reading the jsonld/format diff (archive prices skipped; month capped at lastListed; tests reported 998 pass) — small and unambiguous — cost if wrong: one more pass
- Ruling: final fix wave = Critical + Important 2-5 + pre-run deferred (year-only date near the quote; once-lookup tally snapshot) + Minors (history checkedAt churn, wayback no-links log, support-only model price auto-apply in update, robots-disallowed support URL not "refused"). Mass-discontinue guard deferred to before the second update (DB empty now) — cost if wrong: one extra fix later
- Final: parked — ownHosts doesn't unwrap web.archive.org catalogUrls (would block the archive) — Ruling: latent, no such config today; fix when a gone brand's config is first approved
- Final: parked — archive-support live-name lookup misses the LLM cache for models with PDFs — Ruling: cost only
- Final: parked — findStored ambiguity falls through to a proposal; item-7 permanent skips re-run once-lookups; atlas CLI lacks blockDomains — Ruling: reviewed cards / cost only; atlas only reads gone brands via archive mode
Archive run 1: stopped on web.archive.org 503 'Temporarily Offline' (outage, correctly a stop); Eargo shop copies are JS shells (no text) → now skipped (5d46e32). Ruling: keep 503 from the archive as a run stop — the archive is down, waiting is the polite answer — cost if wrong: manual --resume
