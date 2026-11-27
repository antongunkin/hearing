# Hearing aid comparison site

A comparison site for hearing aids sold in the US (Next.js), plus a local pipeline that reads official
sources, checks what it reads, and queues risky changes for you to approve. The data is plain JSON under
`data/`; the site is built from it.

The pipeline runs on your computer. The deployed site only reads `data/`.

## Install

Needs Node.js 22.22.2+, 24.15+ or 26+.

```bash
npm install
```

No brand needs a browser today. If you set `"render": true` in a brand config, also run:

```bash
npx playwright install chromium
```

### Claude CLI

Extraction runs `claude -p` on your Claude subscription (model alias `haiku`). Install Claude Code, run
`claude` once and log in. The pipeline removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK` and `CLAUDE_CODE_USE_VERTEX` from the CLI's environment, so
these calls stay on the subscription and are not billed to an API or cloud account.

### Ollama

A second, local model re-reads the risky fields (weight, dimensions, IP rating, power, connectivity,
tinnitus). Install it **before the first full `update`**: without it those fields are not cross-checked
at all.

Install [Ollama](https://ollama.com), start it, then:

```bash
ollama pull qwen3:8b
```

Check that it answers (it should print a short reply within a minute):

```bash
ollama run qwen3:8b "Reply with the word OK."
```

Without Ollama the pipeline still runs. On `/review` each of those fields shows "not checked: crosscheck
(Ollama is not available)"; that is not a failure, so the field still starts ticked when its other checks
pass. Any other change to such a field waits for your review.

The device type (`rx`, `otc` or `consumer`) is not re-read. Each brand config has a `defaultType`, which a
model gets when its pages do not say. When a page states another type, the model takes the page's type and
the card shows a failed `brand-type` check: compare it with the maker's page (see [Correct a wrong
type](#correct-a-wrong-type)).

## Settings

```bash
cp .env.example .env.local
```

`.env.local` is gitignored. Never commit it.

| Key | Used by | If empty |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | pipeline and site | The pipeline does not need it: it sends no custom User-Agent. A local site build has no canonical URLs and no sitemap URLs; a production build on Vercel fails. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | site (`/corrections`) | No address is shown, so a company has no way to ask for a correction or removal. |
| `GEMINI_API_KEY` | `youtube` step (free tier) | Video analysis is skipped. |
| `YOUTUBE_API_KEY` | `youtube` step | Video search is skipped. |
| `NEXT_PUBLIC_GA_ID` | site analytics | No analytics. |

Set `NEXT_PUBLIC_SITE_URL` to your real domain as soon as you have one, so canonical and sitemap URLs are right. Set it and
`NEXT_PUBLIC_CONTACT_EMAIL` on Vercel too: they are not read from your computer there.

## Run the pipeline

```bash
npm run update -- --refresh
```

`update` runs every step, then records the comparison pairs.

### First data load: two passes

The `reviews`, `youtube`, `apps` and third-party parts of `scrape` work on stored models only, so the first
`update` finds new models and nothing else. Load the data in two passes:

1. Install and check Ollama (see [Ollama](#ollama)).
2. `npm run update -- --refresh`: new models go to `data/pending/`.
3. Approve or reject them on `/review` (see [Review the queue](#review-the-queue)).
4. `npm run update -- --refresh` again: ratings, complaint themes, pros and cons, videos, third-party Rx
   prices and hardware twins of the approved models. Review what this queues too.
5. `npm run pairs`, then commit and deploy (see [Publish](#publish)).

After that, one `update` a week and a review of its queue is the routine.

Each step can also run alone:

| Command | What it does |
| --- | --- |
| `npm run scrape` | Brand sites: new models and changed specs; third-party prices and hardware twins of stored models. |
| `npm run fda` | openFDA clearances and recalls of stored models. |
| `npm run apps` | iOS app versions, for models whose data file has `app.iosId` (added by hand). |
| `npm run reviews` | Shop ratings, complaint themes, pros and cons from expert reviews. |
| `npm run youtube` | Video reviews (needs both API keys). |
| `npm run pairs` | Adds the current comparison pairs to `data/compare-pairs.json`. Takes no flags. |

All steps but `scrape` work on stored models, so on an empty database they find nothing until you have
approved models.

| Flag | Meaning |
| --- | --- |
| `--brand <slug>` | One brand only (`data/brands/<slug>.json`). |
| `--limit <n>` | At most `n` models per brand. |
| `--refresh` | Fetch pages again. Fetched pages are cached in `.cache/` with no expiry, so use it for every routine update. |
| `--resume` | Continue a stopped run: skip what it had finished. Give the same command, `--brand` and `--limit` as before. |

Pass flags after `--`, for example:

```bash
npm run scrape -- --brand phonak --limit 1
```

### Usage limit

When the Claude subscription limit is reached the run stops with exit code 2 and keeps its progress. The
last line prints the command to resume with, for example:

```text
Claude usage limit reached. Resume later: npm run update -- --resume --refresh
```

Wait for the limit to reset, then run that command. Each command keeps its own progress
(`.cache/progress/<command>.json`), so running one step alone in between does not lose a stopped
`update`. A brand that was stopped half-way is read again from the start: Claude's answers for the pages
read before come from `.cache/`, so they cost no new Claude calls. With `--refresh` those pages are
fetched again.

Gemini's free tier has a daily limit. When it is reached, the rest of the `youtube` step is skipped with a
warning and the run goes on; the next run tries the remaining videos again.

Exit codes: `0` done, `1` bad arguments, `2` stopped by the usage limit.
A source that is skipped or fails does not stop a run; the summary line counts them.

## Review the queue

Risky changes (every new model among them) wait in `data/pending/`. Start the dev server:

```bash
npm run dev
```

Open `http://127.0.0.1:3000/review`. The page exists only in development and only on this computer; in a
production build it returns 404.

- Approve writes the change to `data/`.
- A new model is one card. A field starts ticked when every check that ran passed; failed checks are
  highlighted.
  - Untick a field that started ticked to reject that value: it is recorded in `data/rejections.json` and
    not proposed again.
  - A field that started unticked (a check failed, or none ran) is only left out this time. The next
    `update` proposes it again as a separate change, which you can approve once it is right.
- Reject records the change in `data/rejections.json`, so that it is not proposed again. **Reject model is
  permanent for that model's slug.**
- Approving can call `claude` to write a news sentence. If it stops at the usage limit, approve again later.

Approving while an `update` runs is safe: the pipeline reads a model's file again before it applies a
change to it.

Small changes that pass every check are applied without review: official prices whose quote states one
regular price (no second amount, no sale word) and that move by at most 25%; app versions; FDA events;
shop ratings; and complaint themes counted from at least 20 reviews. Third-party values are always
reviewed. The limits are `maxAutoPriceChange` and `minThemeReviews` in `pipeline/config.ts`.

### Correct a wrong type

The type (`rx`, `otc`, `consumer`) cannot be unticked, and rejecting the model rejects its slug for good.
If a card shows the wrong type, open `data/pending/<slug>-model.json`, change `"type"` inside `"after"` to
the right value, save, reload `/review` and approve. Changing the
brand's `defaultType` fixes it for the next run of that brand.

## Publish

1. Work through the queue on `/review`.
2. Record the comparison pairs, so that published comparison URLs stay alive:

   ```bash
   npm run pairs
   ```

3. Check:

   ```bash
   npm test
   ```

   ```bash
   npm run build
   ```

4. Commit `data/`, including `data/compare-pairs.json`. `data/pending/` is gitignored: what is still
   queued stays on your computer and is not shown on the site.

   ```bash
   git add data && git commit -m "data: update"
   ```

5. Push. Vercel builds the site from the repository.

### First deploy

- Use **Vercel Pro**: the Hobby plan is for non-commercial use only.
- Create the project, set `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL` and (optional)
  `NEXT_PUBLIC_GA_ID`, then connect the domain. The pipeline's API keys do not belong on Vercel.
- A production build fails while `NEXT_PUBLIC_SITE_URL` is not set on Vercel.
- After the deploy, check that the site opens, `/sitemap.xml` lists your domain, `/about-bot` loads and
  `/review` returns 404.
- The privacy, corrections and disclaimer pages are plain-language drafts, not legal advice. Have them
  checked before launch.

## Scraping rules

The collector sends no custom User-Agent (no bot name, nothing browser-like), obeys the `*` rules in `robots.txt` and `Crawl-delay`, pauses between requests, and skips a
site that answers with a captcha, a 403/429 or other bot protection. Do not work around a skip. A 429 answer is skipped as `rate-limited`: a scrape goes on without that page, and an atlas step stops (exit code `2`, resumed with `--resume`). Google
(including Shopping and Play) and Amazon are never fetched. Add a domain to `data/blocklist.json` to stop
all requests to it.

## Brands

One file per brand in `data/brands/<slug>.json`:

- `slug` (the file name), `name`, `group` (the maker or group, such as Sonova) and `website`.
- `defaultType`: `rx`, `otc` or `consumer`, the type of a model whose pages do not state one.
- `catalogUrls`: pages that link to model pages.
- `modelUrlPattern`: regular expression for the full URL of a model page.
- `supportUrls` (optional): support pages that link to documents and model pages, read like `catalogUrls`.
- `documentUrlPattern` (optional): documents to read together with the model page they name.
- `render`: run the page's scripts in a headless browser.
- `status`: `active`, or `gone` when the brand's own site no longer answers; a `gone` brand is not scraped live.
- `archive` (optional): `catalogUrls` and `modelUrlPattern` for the Web Archive copies of a gone brand's pages.
- `imageLicense`: `none` unless the brand's press kit grants editorial use.

When a brand redesigns its site, `npm run scrape -- --brand <slug> --limit 1 --refresh` finds nothing or
the wrong page; fix `catalogUrls` and `modelUrlPattern`. Without `--refresh` it reads the cached pages of
the old site.

### Status on 2026-11-26

One `scrape --limit 1` per brand. "ok" means one model page was read and queued for review; it does not
mean every model page or every field of that brand works. Jabra Enhance, MDHearing, Oticon, Widex and
Rexton were read again after the fixes for model families, brand types and sale prices; their rows show
that result.

| Brand (slug) | Status | Model read, or reason | Limits of the config |
| --- | --- | --- | --- |
| Phonak (`phonak`) | ok | Audéo EON Sphere | Most datasheets and user guides match no model page. |
| Unitron (`unitron`) | ok | Moxi S-RX | The US site links two model pages. |
| Oticon (`oticon`) | ok | Reveal (from the miniRITE R page, a variant) | One page per style; the pages of a family are merged into one model. Families older than the catalog's cut-off are left out by the pattern. |
| Bernafon (`bernafon`) | ok | Encanta miniRITE | US site is bernafon.us. Also queues the older Alpha line. |
| Philips (`philips`) | ok | HearLink 60 | One page per style. HearLink 30 is left out by the pattern. |
| Signia (`signia`) | ok | Pure Charge&Go BCT IX | Integrated Xperience only: the Pure Charge&Go MaX page is a campaign page without specs. |
| Rexton (`rexton`) | ok | Reach R Plus | The page does not state a type: the brand's `rx` is used. Check on `/review` whether "R Plus" is a style of Reach. Reach family only. |
| Widex (`widex`) | ok | Allure (from the RIC R D page, a variant) | Allure and SmartRIC only. |
| ReSound (`resound`) | ok | Sensia | |
| Beltone (`beltone`) | ok | Illuminate | Also queues older lines such as Achieve. |
| Starkey (`starkey`) | ok | Omega AI+ | One page per family; the page read gave no variants. |
| Kirkland Signature (`kirkland-signature`) | skipped: no models | Costco's Hearing Aid Center lists no Kirkland Signature hearing aid. | The model pattern has never matched a real page. |
| Jabra Enhance (`jabra-enhance`) | ok | Select M3 | The page shows a sale price next to the list price: the price waits for review. |
| Lexie (`lexie`) | skipped: site gone | The domain serves a parking page. Its US business is reported to have wound down in 2026. | The model pattern has never matched a real page. |
| Eargo (`eargo`) | skipped: robots | `robots.txt` cannot be read: the domain does not resolve. Same wind-down as Lexie. | The model pattern has never matched a real page. |
| Sennheiser (`sennheiser`) | ok | All Day Clear | |
| Audien (`audien`) | ok | Atom X (2nd Gen) | The shop lists many duplicate pages, so the pattern names each model page: add new models to it. |
| MDHearing (`mdhearing`) | ok | VOLT MAX 2 | The page shows a sale price next to the list price: the price waits for review. |
| Apple (`apple`) | ok | AirPods Pro 3 | Reads the AirPods Pro tech specs page only. |

No brand answered with a captcha or other bot protection. A brand that finds no model pages prints no
warning: the summary just shows nothing queued.

None of the pages read stated a release date, so the cut-off date cannot filter by itself: expect to
reject older models on `/review`. A page that shows a sale price next to the list price, or a sale word,
gives a price change that waits for your review.

## Site atlas

The atlas keeps one folder per site in `data/atlas/sites/<domain>/`; `data/atlas/sites.json` lists the sites. Run the
commands in this order, one site at a time with `--site <domain>` or all sites without it:

1. `npm run atlas:crawl -- --site <domain>` reads the site within its page budget and writes `report.json`.
2. `npm run atlas:describe` writes `describe.json`, `README.md` (the summary, with a numbered source for each
   statement), `config-proposal.json`, and `notes.md` once. It queues the proposed brand config for `/review`.
3. `npm run atlas:relations` looks for sourced company relations and queues them for `/review`.
4. Decide the queued cards on `/review` (see "Review the queue").
5. Then scrape the approved brands with `npm run scrape`.

Each command rewrites `data/atlas/README.md`, the index: one row per site, and the candidate domains. A candidate is a
domain linked from several reports that is not crawled. It is added to `sites.json` only by hand.

Exit codes: `0` done, `1` bad arguments or no page of a site could be read, `2` stopped by a refusal (a 429, a captcha or
other bot protection) or by the usage limit. Exit code `2` prints the command to resume with, which adds `--resume`.
`--refresh` fetches the pages again.

SEC EDGAR is always skipped: the pipeline sends no User-Agent, and EDGAR asks for one.

What is committed: `data/atlas/` and `data/graph/`. They hold facts about a site's structure and short quotes, never
whole pages. Raw pages and PDFs are kept in `.cache/raw/`, with the fetch log `.cache/raw/log.jsonl`. They are not in git
(the repository is public), and they grow with each crawl; check the size with `du -sh .cache/raw`. The project does not
back them up. A backup is the owner's job.

## Company graph

`data/graph/entities.json` and `data/graph/edges.json` hold companies, brands, domains, apps and FDA applicants, and the
relations between them. An edge has a `visibility` (`public` or `internal`) and a `status` (`observed`, `proposed` or
`verified`). Only a public, verified edge reaches the site, and only `/review` (kind `relation`) makes an edge verified.
Internal and proposed edges stay in the data. An edge that points at a domain is always internal and never verified.
