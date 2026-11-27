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
`claude` once and log in. The pipeline removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the
CLI's environment, so these calls are not billed to an API account.

### Ollama

A second, local model re-reads the risky fields (type, weight, dimensions, IP rating, power,
connectivity, tinnitus). Install [Ollama](https://ollama.com), start it, then:

```bash
ollama pull qwen3:8b
```

Without Ollama the pipeline still runs, but each of those fields is marked `ollama-unavailable` and the
change waits for your review.

## Settings

```bash
cp .env.example .env.local
```

`.env.local` is gitignored. Never commit it.

| Key | Used by | If empty |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | pipeline and site | The pipeline refuses to start: its User-Agent names the site (`<url>/about-bot`). The site has no canonical URLs and no sitemap URLs. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | site (`/corrections`) | No address is shown, so a company has no way to ask for a correction or removal. |
| `GEMINI_API_KEY` | `youtube` step (free tier) | Video analysis is skipped. |
| `YOUTUBE_API_KEY` | `youtube` step | Video search is skipped. |
| `NEXT_PUBLIC_GA_ID` | site analytics | No analytics. |

Set `NEXT_PUBLIC_SITE_URL` to your real domain before the first full run. Set it and
`NEXT_PUBLIC_CONTACT_EMAIL` on Vercel too: they are not read from your computer there.

## Run the pipeline

```bash
npm run update -- --refresh
```

`update` runs every step, then records the comparison pairs. Each step can also run alone:

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
| `--resume` | Continue a stopped run: skip what it had finished. Give the same `--brand` and `--limit` as before. |

Pass flags after `--`, for example:

```bash
npm run scrape -- --brand phonak --limit 1
```

### Usage limit

When the Claude subscription limit is reached the run stops with exit code 2 and keeps its progress. Wait
for the limit to reset, then:

```bash
npm run update -- --refresh --resume
```

Exit codes: `0` done, `1` bad arguments, `2` stopped by the usage limit. A source that is skipped or fails
does not stop a run; the summary line counts them.

## Review the queue

Risky changes (every new model among them) wait in `data/pending/`. Start the dev server:

```bash
npm run dev
```

Open `http://127.0.0.1:3000/review`. The page exists only in development and only on this computer; in a
production build it returns 404.

- Approve writes the change to `data/`. Untick a field of a new model to leave it out.
- Reject records the change in `data/rejections.json`, so that it is not proposed again. Fields you leave
  out of an approved model are recorded the same way.
- Approving can call `claude` to write a news sentence. If it stops at the usage limit, approve again later.

Small changes that pass every check (prices, app versions, FDA events, review figures, complaint themes)
are applied without review. Third-party values are always reviewed.

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

4. Commit `data/`, including `data/compare-pairs.json`. Entries still in `data/pending/` are not shown on
   the site; leave them out of the commit.

   ```bash
   git add data ':!data/pending' && git commit -m "data: update"
   ```

5. Push. Vercel builds the site from the repository.

### First deploy

- Use **Vercel Pro**: the Hobby plan is for non-commercial use only.
- Create the project, set `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL` and (optional)
  `NEXT_PUBLIC_GA_ID`, then connect the domain. The pipeline's API keys do not belong on Vercel.
- After the deploy, check that the site opens, `/sitemap.xml` lists your domain, `/about-bot` loads and
  `/review` returns 404.
- The privacy, corrections and disclaimer pages are plain-language drafts, not legal advice. Have them
  checked before launch.

## Scraping rules

The bot names itself honestly, obeys `robots.txt` and `Crawl-delay`, pauses between requests, and skips a
site that answers with a captcha, a 403/429 or other bot protection. Do not work around a skip. Google
(including Shopping and Play) and Amazon are never fetched. Add a domain to `data/blocklist.json` to stop
all requests to it.

## Brands

One file per brand in `data/brands/<slug>.json`:

- `catalogUrls`: pages that link to model pages.
- `modelUrlPattern`: regular expression for the full URL of a model page.
- `datasheetUrlPattern` (optional): documents to read together with the model page they name.
- `render`: run the page's scripts in a headless browser.
- `imageLicense`: `none` unless the brand's press kit grants editorial use.

When a brand redesigns its site, `npm run scrape -- --brand <slug> --limit 1` finds nothing or the wrong
page; fix the two fields above.

### Status on 2026-11-26

One `scrape --limit 1` per brand. "ok" means one model page was read and queued for review; it does not
mean every model page or every field of that brand works.

| Brand (slug) | Status | Model read, or reason | Limits of the config |
| --- | --- | --- | --- |
| Phonak (`phonak`) | ok | Audéo EON Sphere | Most datasheets and user guides match no model page. |
| Unitron (`unitron`) | ok | Moxi S-RX | The US site links two model pages. |
| Oticon (`oticon`) | ok | Reveal miniRITE R | One page per style. Families older than the catalog's cut-off are left out by the pattern. |
| Bernafon (`bernafon`) | ok | Encanta miniRITE | US site is bernafon.us. Also queues the older Alpha line. |
| Philips (`philips`) | ok | HearLink 60 | One page per style. HearLink 30 is left out by the pattern. |
| Signia (`signia`) | ok | Pure Charge&Go BCT IX | Integrated Xperience only: the Pure Charge&Go MaX page is a campaign page without specs. |
| Rexton (`rexton`) | failed: no type on page | The page does not say whether the device is prescription or OTC, so nothing was saved. | Reach family only. |
| Widex (`widex`) | ok | Allure RIC R D | Allure and SmartRIC only. |
| ReSound (`resound`) | ok | Sensia | |
| Beltone (`beltone`) | ok | Illuminate | Also queues older lines such as Achieve. |
| Starkey (`starkey`) | ok | Omega AI+ | One page per family; the page read gave no variants. |
| Kirkland Signature (`kirkland-signature`) | skipped: no models | Costco's Hearing Aid Center lists no Kirkland Signature hearing aid. | The model pattern has never matched a real page. |
| Jabra Enhance (`jabra-enhance`) | ok | Select M3 | |
| Lexie (`lexie`) | skipped: site gone | The domain serves a parking page. Its US business is reported to have wound down in 2026. | The model pattern has never matched a real page. |
| Eargo (`eargo`) | skipped: robots | `robots.txt` cannot be read: the domain does not resolve. Same wind-down as Lexie. | The model pattern has never matched a real page. |
| Sennheiser (`sennheiser`) | ok | All Day Clear | |
| Audien (`audien`) | ok | Atom X (2nd Gen) | The shop lists many duplicate pages, so the pattern names each model page: add new models to it. |
| MDHearing (`mdhearing`) | ok | VOLT MAX 2 | |
| Apple (`apple`) | ok | AirPods Pro 3 | Reads the AirPods Pro tech specs page only. |

No brand answered with a captcha or other bot protection. A brand that finds no model pages prints no
warning: the summary just shows nothing queued.

None of the pages read stated a release date, so the cut-off date cannot filter by itself: expect to
reject older models on `/review`. Prices are what a page shows on the day it is read, sales included.
