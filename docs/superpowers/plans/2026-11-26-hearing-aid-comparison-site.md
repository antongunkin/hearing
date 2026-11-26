# Сайт-база сравнения слуховых аппаратов: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Статический англоязычный сайт-справочник слуховых аппаратов (OTC, Rx, AirPods Pro) с характеристиками, у каждой из которых есть источник, со сравнениями, сводками отзывов и лентой событий. Данные наполняет локальный конвейер: скраперы, LLM, автопроверки, очередь на одобрение.

**Architecture:** Данные хранятся как JSON в `data/` и проверяются Zod-схемами. Конвейер `pipeline/` запускается локально по команде. Он скачивает публичные источники, извлекает поля через LLM (Claude Code CLI, Ollama, Gemini free tier), прогоняет автопроверки, мелкие изменения применяет сам, а важные кладёт в `data/pending/`. Dev-страница `/review` одобряет изменения. Next.js собирает статический сайт на Vercel после `git push`.

**Tech Stack:**
- TypeScript (strict), Node 22+.
- Next.js (App Router, последняя стабильная), React.
- Zod 4 (`z.toJSONSchema`), Vitest + @testing-library/react (jsdom).
- Playwright, `robots-parser`, `unpdf`, `@google/genai`, `@next/third-parties`.

**Spec:** `docs/superpowers/specs/2026-11-26-hearing-aid-comparison-site-design.md`

## Global Constraints

- У каждого поля характеристик есть `{ value, unit?, sourceUrl, quote, fetchedAt, sourceType }`. Поле без источника отсутствует, значения не выдумываются.
- `sourceType`:
  - `official`: производитель или FDA;
  - `third-party`: допустим только для `sameHardwareAs` и цен Rx;
  - `derived`: обязательно с `derivation`.
- Скрапинг:
  - только публичные страницы без логина;
  - соблюдать `robots.txt`;
  - пауза 2000–5000 мс между запросами к одному домену;
  - User-Agent `HearingDBBot/0.1 (+<NEXT_PUBLIC_SITE_URL>/about-bot)`, без личных контактов;
  - при капче, 403/429 или защите от ботов источник пропускается, ничего не обходим;
  - Google (включая Shopping и Play) и Amazon не скрапить;
  - домены из `data/blocklist.json` не трогать.
- На сайт не попадают дословные тексты отзывов покупателей и абзацы чужих обзоров. Сырые тексты живут только в `.cache/` (gitignored).
- В текстах LLM, которые попадают на сайт, нет фраз «tested», «hands-on», «we wore», «in our testing», нет авторов-персон.
- В schema.org нет `Review` и `AggregateRating`, только `Product` с фактическими свойствами.
- Плюсы и минусы подписываются «Based on published reviews and customer feedback» и ссылаются на источники.
- MAUDE на сайте не показывать. Google Play не скрапить, хранить только ссылку.
- Сайт: только английский, рынок США. Каталог: модели, выпущенные после `config.releasedAfter = '2023-11-01'`.
- `/review` и его server actions работают только при `NODE_ENV === 'development'`.
- Индексируются только курируемые пары сравнения, примерно 10 ближайших конкурентов на модель. Инструмент сравнения произвольных пар помечен `noindex`.
- Места под рекламу имеют фиксированную высоту (без CLS). Блок «где купить» — пустое зарезервированное место только для OTC.
- Бюджет LLM — $0. Основная модель — `claude -p` на подписке (алиас по умолчанию `haiku`). Перепроверка — Ollama `qwen3:8b`. YouTube — Gemini free tier, `mediaResolution` LOW.
- Секреты лежат в `.env.local` (gitignored): `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_SITE_URL`. В git коммитится `.env.example`.

## Review Focus

1. **Источник вернул страницу-заглушку** (капча, «Access Denied», Cloudflare challenge) со статусом 200. Такой источник должен пропускаться, а не уходить в LLM. Тест в Task 4.
2. **Поле пустое почти у всех моделей** (цена Rx, вес ITE). Страница модели, таблица сравнения и фильтр показывают «—» и не падают, а модели без значения не исчезают из фильтров по другим полям. Тесты в Task 9.
3. **Лимит подписки Claude или невалидный JSON посреди прогона.** Конвейер должен остановиться без частично записанных файлов, а `--resume` продолжает с того же места. Тесты в Task 3 и Task 7.
4. **Бренд переименовал модель или сменил URL** (`Phonak Audéo Sphere™ Infinio` vs `Audeo Sphere Infinio`). Должна найтись существующая модель, а не появиться дубль. Тест в Task 5.
5. **Отклонённое изменение предлагается снова при каждом прогоне.** После «reject» то же значение по тому же пути больше не попадает в очередь. Тест в Task 8.

---

## File Structure

```
package.json, tsconfig.json, next.config.ts, vitest.config.ts, .gitignore, .env.example
data/
  brands/<brand>.json        # бренд + конфиг скрапера
  models/<slug>.json
  reviews/<slug>.json
  events/<id>.json
  pending/<id>.json
  rejections.json            # отпечатки отклонённых изменений
  blocklist.json             # домены, которые нельзя трогать
src/lib/schema/              # Zod-схемы: field, brand, model, reviews, event, pending
src/lib/data/                # load.ts (чтение + валидация), write.ts (атомарная запись), slug.ts
src/lib/site/                # catalog-index.ts, spec-rows.ts, pairs.ts, jsonld.ts, sitemap-entries.ts
src/lib/review/              # apply-decision.ts (чистая логика одобрения)
src/components/              # SpecTable, SourceNote, AdSlot, BuyBoxSlot, ReviewSummary, ProsCons, YouTubeEmbed, CatalogFilters
app/                         # страницы сайта + review/ (dev-only)
pipeline/
  config.ts
  cli.ts                     # команды: update, scrape, extract, check, fda, apps, reviews, youtube
  progress.ts                # возобновление прогона
  fetch/fetcher.ts, fetch/bot-detect.ts, fetch/robots.ts, fetch/pdf.ts
  llm/index.ts, llm/claude-cli.ts, llm/ollama.ts, llm/gemini.ts, llm/cache.ts
  units.ts
  checks/literal.ts, checks/ranges.ts, checks/crosscheck.ts, checks/dedupe.ts, checks/forbidden.ts
  sources/brand-site.ts      # обход каталога + извлечение характеристик
  sources/openfda.ts, sources/itunes.ts, sources/youtube.ts, sources/reviews.ts, sources/pros-cons.ts
  apply.ts                   # маршрутизация auto/pending + события
tests/                       # зеркалит src/ и pipeline/; fixtures/ с HTML/PDF/JSON
```

---

### Task 1: Каркас проекта, схемы данных, чтение и запись

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore` (`.cache/`, `.env.local`, `.next/`, `node_modules/`), `.env.example`
- Create: `src/lib/schema/{field,brand,model,reviews,event,pending}.ts`, `src/lib/data/{load,write,slug}.ts`
- Create: `data/blocklist.json` (`[]`), `data/rejections.json` (`[]`)
- Test: `tests/lib/schema.test.ts`, `tests/lib/data.test.ts`

**Interfaces:**
- Produces:
  - `sourced<T>(value: ZodType<T>)`: схема `{ value: T; unit?: string; sourceUrl: string(url); quote: string(min 1); fetchedAt: string(datetime); sourceType: 'official'|'third-party'|'derived'; derivation?: { op: 'oz-to-g'|'in-to-mm'|'pair-to-unit'|'from-list'; input: string } }`. Через refine: `derived` ⇒ `derivation` обязателен. Тип `Sourced<T>`.
  - `FormFactor = 'RIC'|'BTE'|'ITE'|'ITC'|'CIC'|'IIC'|'earbud'`, `ModelType = 'otc'|'rx'|'consumer'`, `PowerType = 'rechargeable'|'10'|'312'|'13'|'675'`.
  - `Brand`: `{ slug, name, group, website, imageLicense: 'press-kit-editorial'|'none', scraper: { catalogUrls: string[]; modelUrlPattern: string; datasheetUrlPattern?: string; render: boolean } }`.
  - `Variant`: `{ id; techLevel?: string; formFactor: FormFactor; weightG?: Sourced<number>; dimensionsMm?: Sourced<{ l: number; w: number; h: number }>; power?: Sourced<{ type: PowerType; batteryHours?: number; chargingCase?: boolean }>; ipRating?: Sourced<string>; priceUsd?: Sourced<number> | Sourced<{ min: number; max: number; perPair: true }> }`.
  - `Model`: `{ slug; brand; name; aliases: string[]; type: ModelType; releaseDate?: Sourced<string>; platform?: Sourced<string>; predecessor?: string; successor?: string; sameHardwareAs: { slug: string; source: Sourced<string> }[]; materials?: Sourced<string[]>; colors?: Sourced<string[]>; connectivity?: Sourced<{ mfi?: boolean; asha?: boolean; leAudio?: boolean; auracast?: boolean }>; tinnitus?: Sourced<boolean>; app?: { name: string; iosId?: string; androidUrl?: string; iosVersion?: Sourced<string> }; fda?: Sourced<{ status: string; k510?: string }>; variants: Variant[] }`.
  - `Reviews`: `{ slug; customer: { sourceUrl; rating: number; count: number; fetchedAt }[]; complaintThemes: { theme: string; share: number; n: number }[]; prosCons: { pros: { text; sources: string[] }[]; cons: { text; sources: string[] }[] } | null; videos: { id; channel; title }[] }`.
  - `Event`: `{ id; type: 'new-model'|'price-change'|'fda-clearance'|'fda-recall'|'app-update'; modelSlug: string | null; date; key: string; text: string; sources: string[] }`.
  - `CheckResult = { name: 'literal'|'range'|'crosscheck'|'dedupe'|'forbidden'; ok: boolean; detail?: string }`.
  - `PendingChange`: `{ id; kind: 'new-model'|'spec-change'|'pros-cons'|'failed-check'; modelSlug: string | null; path: string; before?: unknown; after: unknown; checks: Record<string, CheckResult[]>; createdAt }`. Здесь `path` — путь вида `variants.0.weightG`, `checks` — по путям полей.
  - `CandidateChange` (там же, в `pending.ts`): `{ kind: 'price'|'app-version'|'fda-event'|'review-stats'|'complaint-themes'|'new-model'|'spec-change'|'pros-cons'; modelSlug: string | null; path: string; before?: unknown; after: unknown; checks: Record<string, CheckResult[]> }`.
  - `loadDataset(dir = 'data'): Promise<Dataset>`, где `Dataset = { brands, models, reviews, events, pending, rejections: string[], blocklist: string[] }`. Бросает `DataValidationError` с именем файла и issues Zod.
  - `writeJson(path: string, value: unknown): Promise<void>`: запись во временный файл + `rename`, ключи отсортированы, 2 пробела, `\n` в конце.
  - `deleteJson(path: string): Promise<void>`.
  - `modelSlug(brand: string, name: string): string` и `normalizeName(name: string): string`. Убирают ™®©, диакритику, слова «hearing aid(s)», регистр и лишние пробелы.

- [ ] **Step 1: Инициализировать Next.js-проект** (`create-next-app` с TS, App Router, без src-алиасов кроме `@/` → корень), добавить Vitest и jsdom, скрипт `"test": "vitest run"`.
- [ ] **Step 2: Написать падающие тесты**

```ts
test('derived field without derivation is rejected', () => {
  expect(sourced(z.number()).safeParse({ value: 2.1, sourceUrl: 'https://x.com', quote: '0.07 oz', fetchedAt: '2026-11-26T00:00:00Z', sourceType: 'derived' }).success).toBe(false)
})
test('loadDataset reports file name on invalid model', async () => {
  // fixture data dir with models/bad.json missing `variants`
  await expect(loadDataset(fixtureDir)).rejects.toThrow(/models\/bad\.json/)
})
test('writeJson is atomic and stable', async () => {
  await writeJson(p, { b: 1, a: 2 })
  expect(await readFile(p, 'utf8')).toBe('{\n  "a": 2,\n  "b": 1\n}\n')
  // no *.tmp left in dir
})
test('normalizeName unifies trademark and diacritics', () => {
  expect(normalizeName('Audéo Sphere™ Infinio Hearing Aids')).toBe(normalizeName('audeo sphere infinio'))
})
```

- [ ] **Step 3: Запустить** `npm test`. Ожидается FAIL (модули не существуют).
- [ ] **Step 4: Реализовать схемы и `src/lib/data/*`** по Interfaces.
- [ ] **Step 5: Запустить** `npm test`. Ожидается PASS. Затем `npx tsc --noEmit` без ошибок.
- [ ] **Step 6: Commit** `feat: project scaffold, data schemas, atomic json io`

---

### Task 2: Единицы измерения и автопроверки (кроме перепроверки моделью)

**Files:**
- Create: `pipeline/units.ts`, `pipeline/checks/{literal,ranges,dedupe,forbidden}.ts`
- Test: `tests/pipeline/units.test.ts`, `tests/pipeline/checks.test.ts`

**Interfaces:**
- Consumes: `Sourced`, `Event`, `CheckResult` (Task 1).
- Produces:
  - `parseMeasurement(text: string): { value: number; unit: string } | null`, `toGrams(v, unit)`, `toMm(v, unit)`.
  - `literalCheck(field: Sourced<unknown>, sourceText: string): CheckResult`:
    - `quote` должна встречаться в `sourceText` после нормализации пробелов и регистра;
    - для `official` и `third-party` строковое представление числа или значения должно встречаться в `quote`;
    - для `derived` в `quote` должен встречаться `derivation.input`.
  - `rangeCheck(path: string, value: unknown): CheckResult`. Диапазоны:
    - `weightG` 0.5–10;
    - каждое измерение `dimensionsMm` 3–60;
    - `batteryHours` 1–200;
    - OTC `priceUsd` 50–5000;
    - Rx `{min,max}` 500–10000 при `min ≤ max`.

    Пути без правила → `ok: true`.
  - `isDuplicateEvent(e: Event, existing: Event[]): boolean`: тот же `type` + `modelSlug` + `key` в пределах 30 дней.
  - `forbiddenCheck(text: string): CheckResult`. Регэкспы без учёта регистра: `\btested\b`, `hands-on`, `we wore`, `in our testing`, `our (audiologist|expert)`.

- [ ] **Step 1: Написать падающие тесты**

```ts
expect(toGrams(0.07, 'oz')).toBeCloseTo(1.98, 2)
expect(parseMeasurement('Weight: 2.1 g')).toEqual({ value: 2.1, unit: 'g' })
expect(literalCheck(field({ value: 2.1, quote: 'weighs 2.1 g' }), 'The device weighs 2.1 g per ear').ok).toBe(true)
expect(literalCheck(field({ value: 2.4, quote: 'weighs 2.1 g' }), 'The device weighs 2.1 g').ok).toBe(false)
expect(literalCheck(field({ value: 2.1, quote: 'weighs 2.1 g' }), 'unrelated page').ok).toBe(false)
expect(literalCheck(derived({ value: 1.98, quote: 'only 0.07 oz', derivation: { op: 'oz-to-g', input: '0.07 oz' } }), 'only 0.07 oz').ok).toBe(true)
expect(rangeCheck('variants.0.weightG', 40).ok).toBe(false)
expect(rangeCheck('variants.0.priceUsd', { min: 4000, max: 2000, perPair: true }).ok).toBe(false)
expect(forbiddenCheck('We tested it for two weeks').ok).toBe(false)
expect(isDuplicateEvent(ev('2026-11-01'), [ev('2026-11-20')])).toBe(true)
```

- [ ] **Step 2: Запустить** `npm test -- checks units`. Ожидается FAIL.
- [ ] **Step 3: Реализовать** по Interfaces.
- [ ] **Step 4: Запустить** тот же тест. Ожидается PASS.
- [ ] **Step 5: Commit** `feat(pipeline): units and automatic checks`

---

### Task 3: Слой LLM: Claude CLI, Ollama, Gemini, кэш

**Files:**
- Create: `pipeline/config.ts`, `pipeline/llm/{index,claude-cli,ollama,gemini,cache}.ts`
- Test: `tests/pipeline/llm.test.ts`

**Interfaces:**
- Produces:
  - `config`: `{ userAgent, minDelayMs: 2000, maxDelayMs: 5000, releasedAfter: '2023-11-01', llm: { claudeModel: 'haiku', ollamaModel: 'qwen3:8b', ollamaUrl: 'http://localhost:11434', geminiModel: string } }`.
  - `llm<T>(opts: { prompt: string; schema: ZodType<T>; provider: 'claude'|'ollama'|'gemini'; tools?: ['WebSearch']; youtubeUrl?: string }): Promise<T>`. Сначала смотрит кэш `.cache/llm/<sha256(provider+model+prompt+jsonSchema+youtubeUrl)>.json`, ответ валидирует через `schema.parse`.
  - Ошибки:
    - `LlmUnavailableError`: нет бинаря `claude`, Ollama не отвечает (ECONNREFUSED), нет `GEMINI_API_KEY`;
    - `LlmLimitError`: в stderr или результате Claude есть `limit`/`rate`, у Gemini HTTP 429;
    - `LlmOutputError`: невалидный JSON или не прошла схема, после 1 повтора.
  - `claude-cli.ts`: `execFile('claude', ['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(z.toJSONSchema(schema)), '--model', config.llm.claudeModel, ...(tools ? ['--allowedTools', tools.join(',')] : [])])`. Exec-функция внедряется для тестов.
  - `ollama.ts`: `POST {ollamaUrl}/api/chat`, тело `{ model, messages: [{role:'user', content: prompt}], format: jsonSchema, stream: false }`.
  - `gemini.ts`: `@google/genai`, `contents` с `fileData: { fileUri: youtubeUrl }` при наличии ссылки, `config: { responseMimeType: 'application/json', responseJsonSchema, mediaResolution: 'MEDIA_RESOLUTION_LOW' }`.

- [ ] **Step 1: Проверить формат вывода CLI.** Выполнить `claude -p 'Return ok=true' --output-format json --json-schema '{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}' --model haiku` и записать в комментарий `claude-cli.ts`, в каком поле JSON лежит структурированный результат. Ожидается: объект с полем, содержащим `{"ok":true}`.
- [ ] **Step 2: Написать падающие тесты** со stub'ами exec и fetch:

```ts
test('claude result is parsed and cached', async () => { /* stub exec returns fixture; second call does not exec */ })
test('claude usage-limit stderr → LlmLimitError', async () => { await expect(run(stubExecFail('Usage limit reached'))).rejects.toBeInstanceOf(LlmLimitError) })
test('invalid JSON twice → LlmOutputError, nothing cached', async () => { /* cache dir empty after */ })
test('ollama ECONNREFUSED → LlmUnavailableError', async () => {})
test('schema violation → LlmOutputError', async () => {})
```

- [ ] **Step 3: Запустить** `npm test -- llm`. Ожидается FAIL.
- [ ] **Step 4: Реализовать.** В кэш пишется только ответ, прошедший схему, через `writeJson`.
- [ ] **Step 5: Запустить.** Ожидается PASS.
- [ ] **Step 6: Commit** `feat(pipeline): llm providers with cache and typed errors`

---

### Task 4: Fetcher: robots, паузы, blocklist, детектор защиты от ботов, PDF

**Files:**
- Create: `pipeline/fetch/{fetcher,bot-detect,robots,pdf}.ts`
- Test: `tests/pipeline/fetcher.test.ts` (локальный `http.createServer`), `tests/fixtures/pages/{captcha-200.html,cf-challenge.html,datasheet.pdf}`

**Interfaces:**
- Consumes: `config` (Task 3), `Dataset.blocklist` (Task 1).
- Produces:
  - `fetchPage(url: string, opts?: { render?: boolean }): Promise<FetchResult>`.
  - `FetchResult = { status: 'ok'; url; text: string; html?: string; contentHash: string; fetchedAt: string } | { status: 'skipped'; url; reason: 'robots'|'blocklist'|'bot-protection'|'http-error'; detail?: string }`.
  - `render: true` → Playwright Chromium. PDF (по content-type) → текст через `unpdf`.
  - Сырой результат кэшируется в `.cache/pages/<sha256(url)>.json`. Повторный запрос возвращает кэш, если `--refresh` не задан, его передаёт CLI через `opts.refresh`.
  - `looksLikeBotWall(status: number, html: string): boolean`: 403/429/503, а также при любом статусе маркеры `captcha`, `cf-challenge`, `challenge-platform`, `px-captcha`, `Access Denied`, `Request unsuccessful. Incapsula` в небольшом документе (видимый текст < 2000 символов).

- [ ] **Step 1: Написать падающие тесты**

```ts
test('robots disallow → skipped/robots, no request made', async () => {})
test('blocklisted domain → skipped/blocklist', async () => {})
test('200 captcha page → skipped/bot-protection', async () => {})   // Review Focus 1
test('two requests to same host are ≥2000ms apart', async () => {}) // fake timers
test('sends configured User-Agent', async () => {})
test('pdf datasheet → extracted text contains "Weight"', async () => {})
```

- [ ] **Step 2: Запустить** `npm test -- fetcher`. Ожидается FAIL.
- [ ] **Step 3: Реализовать.** `robots.txt` кэшируется на хост, пауза случайная в диапазоне [minDelayMs, maxDelayMs] на хост.
- [ ] **Step 4: Запустить.** Ожидается PASS.
- [ ] **Step 5: Commit** `feat(pipeline): polite fetcher with bot-wall detection`

---

### Task 5: Сайты брендов: обнаружение моделей и извлечение характеристик

**Files:**
- Create: `pipeline/sources/brand-site.ts`, `pipeline/checks/crosscheck.ts`
- Create: `data/brands/phonak.json`, `data/brands/jabra-enhance.json` (два эталонных конфига)
- Test: `tests/pipeline/brand-site.test.ts`, `tests/fixtures/brands/*`

**Interfaces:**
- Consumes: `fetchPage` (Task 4), `llm` (Task 3), `literalCheck`, `rangeCheck` (Task 2), `normalizeName`, `modelSlug` (Task 1).
- Produces:
  - `discoverModelUrls(brand: Brand): Promise<string[]>`: обходит `catalogUrls` и собирает ссылки по `modelUrlPattern`, `datasheetUrlPattern` даёт связанные PDF.
  - `extractModel(brand: Brand, pages: Extract<FetchResult, {status:'ok'}>[]): Promise<ModelCandidate>`, где `ModelCandidate = { model: Model; fieldChecks: Record<string, CheckResult[]> }`.
    - LLM возвращает по каждому полю `{ value, unit?, quote, sourceIndex, derivation? }`, а `sourceUrl`, `fetchedAt` и `sourceType: 'official'` проставляет код по `sourceIndex`.
    - Поля, которых LLM не нашла, отсутствуют.
    - Для каждого поля код сразу записывает в `fieldChecks[path]` результаты `literalCheck` (по тексту страницы `sourceIndex`) и `rangeCheck`.
  - `matchExistingModel(candidate: Model, models: Model[]): Model | null`: тот же бренд + `normalizeName` совпадает с `name` или с одним из `aliases`.
  - `isInScope(m: Model): boolean`: `releaseDate ≥ config.releasedAfter`. Если даты нет → `true`, а изменение помечается в `failed-check` с `detail: 'no-release-date'`.
  - `crossCheck(path: string, quote: string, value: unknown): Promise<CheckResult>`: Ollama заново извлекает значение из `quote` и сравнивает, числа с допуском 2%. При `LlmUnavailableError` → `{ ok: false, detail: 'ollama-unavailable' }`.
  - `RISKY_PATHS`: `type`, `*.weightG`, `*.dimensionsMm`, `*.ipRating`, `*.power`, `connectivity`.

- [ ] **Step 1: Написать падающие тесты** (llm застаблен фикстурами):

```ts
test('discovers model URLs by pattern only', async () => {})
test('field missing from LLM output is absent, not null', async () => {})
test('sourceUrl comes from sourceIndex, not from LLM text', async () => {})
test('renamed model matches existing via aliases/normalizeName', () => {   // Review Focus 4
  expect(matchExistingModel(cand('Audéo Sphere™ Infinio'), [existing('Audeo Sphere Infinio')])?.slug).toBe('phonak-audeo-sphere-infinio')
})
test('crossCheck mismatch beyond 2% fails; ollama down → ollama-unavailable', async () => {})
```

- [ ] **Step 2: Запустить** `npm test -- brand-site`. Ожидается FAIL.
- [ ] **Step 3: Реализовать.** Промпт лежит в `brand-site.ts` и требует дословную цитату для каждого поля.
- [ ] **Step 4: Запустить.** Ожидается PASS.
- [ ] **Step 5: Живая проверка.** Запустить `npx tsx pipeline/cli.ts scrape --brand phonak --limit 1` (временный вход до Task 7, допустим прямой вызов функций). Ожидается: в `.cache/pages/` есть страницы, кандидат печатается и не содержит полей без цитаты.
- [ ] **Step 6: Commit** `feat(pipeline): brand site discovery and spec extraction`

---

### Task 6: Остальные источники: FDA, iOS-приложения, отзывы, обзоры, YouTube

**Files:**
- Create: `pipeline/sources/{openfda,itunes,reviews,pros-cons,youtube,third-party-facts}.ts`
- Test: `tests/pipeline/sources.test.ts`, `tests/fixtures/{openfda,itunes,reviews,youtube}/*`

**Interfaces:**
- Consumes: `fetchPage`, `llm` (с `tools: ['WebSearch']` для поиска обзоров), `forbiddenCheck`.
- Produces:
  - `fetchFdaEvents(sinceISO: string, brands: Brand[], models: Model[]): Promise<{ event: Omit<Event,'id'|'text'>; matched: boolean }[]>`.
    - Источники: `https://api.fda.gov/device/510k.json` и `/device/recall.json`, фильтр по `config.fdaProductCodes` и дате.
    - Сопоставление: заявитель → бренд (`Brand.group`/`name`), название устройства → модель через `normalizeName`. Без совпадения → `matched: false`.
    - Первый шаг задачи: свериться с FDA Product Classification и записать коды в `config.fdaProductCodes` с комментарием-источником.
  - `fetchIosVersion(iosId: string): Promise<Sourced<string> | null>`: через `https://itunes.apple.com/lookup?id=`, источник — trackViewUrl, quote — `version`.
  - `discoverReviewSources(model: Model): Promise<{ expert: string[]; retail: string[] }>`: `llm` + WebSearch. Домены google.*, amazon.* и из blocklist отбрасываются кодом.
  - `extractRetailReviews(page): Promise<{ rating: number; count: number; texts: string[] } | null>`.
  - `complaintThemes(texts: string[]): Promise<{ theme: string; share: number; n: number }[]>`. LLM тегирует каждый отзыв темами из фиксированного словаря: `battery`, `app`, `connectivity`, `sound-quality`, `comfort-fit`, `durability`, `feedback-whistling`, `customer-service`, `price-value`, `other`. Доля и `n` считаются в коде, темы с `n < 3` отбрасываются.
  - `searchVideos(model: Model): Promise<{ id; channel; title }[]>`: YouTube Data API v3 `search` (q=`<brand> <name> review`, type=video, maxResults=10, relevanceLanguage=en) + `videos?part=statistics`, топ-3 по просмотрам.
  - `analyzeVideo(id: string): Promise<{ pros: string[]; cons: string[] }>`: Gemini по `https://www.youtube.com/watch?v=<id>`.
  - `synthesizeProsCons(inputs: { sourceUrl: string; pros: string[]; cons: string[] }[]): Promise<Reviews['prosCons']>`. Каждый пункт обязан ссылаться хотя бы на один `sourceUrl` из inputs, пункты без источника или не прошедшие `forbiddenCheck` код отбрасывает.
  - `discoverThirdPartyFacts(model: Model): Promise<CandidateChange[]>`. Ищет через `llm` + WebSearch опубликованные исследования цен и прайсы клиник, а также источники «то же железо». Найденные страницы скачивает через `fetchPage`, извлекает с цитатой.
    - Выдаёт `kind: 'spec-change'`, `sourceType: 'third-party'` и только для путей `variants.*.priceUsd` (Rx, `{min,max,perPair}`) и `sameHardwareAs`.
    - Сразу проставляет `literalCheck` и `rangeCheck`.
    - Для OTC-моделей цену не ищет: она приходит с сайта бренда.

- [ ] **Step 1: Написать падающие тесты** (fetch и llm застаблены фикстурами):

```ts
test('FDA 510k fixture → fda-clearance with key = K-number; unknown applicant → matched:false', async () => {})
test('iTunes lookup → version with trackViewUrl as source', async () => {})
test('discoverReviewSources drops google/amazon/blocklisted domains', async () => {})
test('complaintThemes computes share in code and drops n<3', async () => {
  // 10 texts, LLM tags 4 battery, 2 app → [{theme:'battery', share:0.4, n:4}]
})
test('synthesizeProsCons drops items with unknown source or forbidden phrases', async () => {})
test('discoverThirdPartyFacts emits only Rx price/sameHardwareAs paths with sourceType third-party', async () => {})
```

- [ ] **Step 2: Запустить** `npm test -- sources`. Ожидается FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить.** Ожидается PASS.
- [ ] **Step 5: Commit** `feat(pipeline): fda, ios apps, reviews, youtube sources`

---

### Task 7: Маршрутизация изменений, события, CLI `update` с возобновлением

**Files:**
- Create: `pipeline/apply.ts`, `pipeline/progress.ts`, `pipeline/cli.ts`
- Modify: `package.json` (скрипты `"update": "tsx pipeline/cli.ts update"`, `"scrape"`, `"fda"`, `"apps"`, `"reviews"`, `"youtube"`)
- Test: `tests/pipeline/apply.test.ts`, `tests/pipeline/cli.test.ts`

**Interfaces:**
- Consumes: всё из Tasks 1–6, `CandidateChange` (Task 1), `crossCheck` и `RISKY_PATHS` (Task 5).
- Produces:
  - `diffModel(existing: Model | null, cand: ModelCandidate): CandidateChange[]`:
    - `existing === null` → один `new-model` с `after = cand.model` и `checks = cand.fieldChecks`;
    - иначе по одному изменению на каждый изменившийся листовой `Sourced`-путь: путь `*.priceUsd` с `sourceType: 'official'` → `price`, остальное → `spec-change`;
    - поля, которые есть в `existing`, но отсутствуют в кандидате, не удаляются: источник мог временно не отдать значение.
  - `withCrossChecks(c: CandidateChange): Promise<CandidateChange>`: для путей из `RISKY_PATHS` добавляет результат `crossCheck` в `checks[path]`.
  - `fingerprint(c: { modelSlug; path; after }): string`: sha256 от `modelSlug|path|stableStringify(after)`.
  - `route(c: CandidateChange, rejections: string[]): 'auto'|'pending'|'drop'`:
    - `drop`, если `fingerprint ∈ rejections` или `after` глубоко равен `before`;
    - `auto`, если `kind ∈ ['price','app-version','fda-event','review-stats','complaint-themes']` и все проверки `ok`;
    - иначе `pending`, а `kind` для `PendingChange` = `failed-check`, если какая-то проверка не прошла.
  - `applyAuto(c, dataset): Promise<Event[]>`: пишет JSON через `writeJson` и возвращает события:
    - `price` → `price-change`;
    - `fda-event` → `fda-clearance`/`fda-recall`;
    - `app-version` → `app-update`.

    События проходят `isDuplicateEvent`. Текст делает `eventText(event, model)` через `llm('claude')` и проверяет `forbiddenCheck`. Если проверка не прошла, используется шаблонный текст без LLM.
  - `enqueue(c): Promise<void>`: пишет `data/pending/<id>.json`.
  - CLI `update [--brand <slug>] [--resume] [--refresh]` по шагам: brands (`discoverModelUrls` → `extractModel` → `diffModel` → `withCrossChecks`) → third-party facts → fda → apps → reviews → youtube. Каждое изменение проходит `route`, затем `applyAuto` или `enqueue`. После каждой модели прогресс пишется в `.cache/progress.json`.
    - При `LlmLimitError` печатает `Claude usage limit reached. Resume later: npm run update -- --resume` и выходит с кодом 2.
    - При `LlmUnavailableError` для Gemini шаг youtube пропускается с предупреждением.
    - В конце печатает сводку: auto N, pending N, skipped sources N.

- [ ] **Step 1: Написать падающие тесты**

```ts
test('diffModel: new model → single new-model; official price change → price; field missing in candidate is not removed', () => {})
test('price change with passing checks → auto and emits price-change event', async () => {})
test('spec change → pending even if checks pass', () => {})
test('auto kind with failing check → pending failed-check', () => {})
test('rejected fingerprint → drop', () => {})
test('LlmLimitError mid-run: exit 2, progress saved, no *.tmp, resume skips done models', async () => {}) // Review Focus 3
```

- [ ] **Step 2: Запустить** `npm test -- apply cli`. Ожидается FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить.** Ожидается PASS.
- [ ] **Step 5: Живая проверка.** `npm run update -- --brand jabra-enhance`. Ожидается: появились файлы в `data/pending/`, напечатана сводка, `npm test` зелёный.
- [ ] **Step 6: Commit** `feat(pipeline): change routing, events, resumable update command`

---

### Task 8: Страница одобрения `/review` (только dev)

**Files:**
- Create: `src/lib/review/apply-decision.ts`, `app/review/page.tsx`, `app/review/actions.ts`, `app/review/ModelCard.tsx`, `app/review/ChangeRow.tsx`
- Test: `tests/lib/apply-decision.test.ts`, `tests/app/review-guard.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `PendingChange`, `writeJson`, `deleteJson`, `fingerprint` (Task 7), `eventText` (Task 7).
- Produces:
  - `applyDecision(dataset: Dataset, pendingId: string, decision: { action: 'approve'; skipPaths?: string[] } | { action: 'reject' }): { writes: { path: string; value: unknown }[]; deletes: string[]; rejections: string[]; newEvents: Omit<Event,'id'|'text'>[] }`. Чистая функция:
    - `approve` для `new-model` записывает модель без `skipPaths`, удаляет pending, даёт событие `new-model`;
    - `reject` добавляет `fingerprint` в `rejections` и удаляет pending.
  - Server actions `approveChange(id, skipPaths?)` и `rejectChange(id)` вызывают `applyDecision` и применяют результат. Первая строка каждой: `if (process.env.NODE_ENV !== 'development') throw new Error('review is dev-only')`.
  - `page.tsx`: `notFound()` вне dev.
    - Для `new-model` — карточка со всеми полями. Прошедшие проверки отмечены заранее, проблемные подсвечены с `detail`. У каждого поля ссылка на источник и цитата.
    - Для остальных изменений — строка «было → стало».

- [ ] **Step 1: Написать падающие тесты**

```ts
test('approve new-model with skipPaths omits those fields and emits new-model event', () => {})
test('reject stores fingerprint; same change later routes to drop', () => { /* uses route() */ }) // Review Focus 5
test('actions throw outside development', async () => {})
```

- [ ] **Step 2: Запустить** `npm test -- apply-decision review-guard`. Ожидается FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить.** Ожидается PASS. Затем `npm run dev` → `http://localhost:3000/review` показывает pending из Task 7, одобрение модели создаёт `data/models/<slug>.json`.
- [ ] **Step 5: Проверить production-сборку.** `npm run build && npm start` → `/review` возвращает 404.
- [ ] **Step 6: Commit** `feat(review): dev-only approval page`

---

### Task 9: Каркас сайта, каталог, страница модели

**Files:**
- Create: `app/layout.tsx`, `app/page.tsx`, `app/hearing-aids/page.tsx`, `app/hearing-aids/[slug]/page.tsx`
- Create: `src/lib/site/{catalog-index,spec-rows,jsonld}.ts`, `src/components/{SpecTable,SourceNote,AdSlot,BuyBoxSlot,ReviewSummary,ProsCons,YouTubeEmbed,CatalogFilters}.tsx`
- Test: `tests/lib/site.test.ts`, `tests/components/spec-table.test.tsx`

**Interfaces:**
- Consumes: `loadDataset` (Task 1).
- Produces:
  - `buildCatalogIndex(models: Model[]): CatalogItem[]`, где `CatalogItem = { slug; brand; name; type; formFactors: FormFactor[]; powerTypes: PowerType[]; connectivity: { mfi?; asha?; leAudio?; auracast? }; priceMin?: number; releaseDate?: string; weightGMin?: number }`.
  - `filterCatalog(items: CatalogItem[], f: { type?: ModelType[]; formFactor?: FormFactor[]; power?: PowerType[]; auracast?: boolean; brand?: string[]; priceMax?: number }): CatalogItem[]`. Фильтр по полю отбрасывает только модели, у которых известное значение не подходит. Модели без значения проходят все фильтры, кроме `priceMax` и `auracast`.
  - `specRows(models: Model[]): { label: string; cells: ({ text: string; source: Sourced<unknown> } | null)[] }[]`, по одному столбцу на вариант. `null` рендерится как «—».
  - `productJsonLd(model: Model, brand: Brand): object`: `@type: Product`, name, brand, weight/size из первого варианта, без `aggregateRating` и `review`.
  - `SourceNote`: иконка со ссылкой на источник. Для `third-party` показывает подпись `According to <hostname>`.
  - `AdSlot({ id, minHeight })`: резервирует высоту и пока ничего не рендерит.
  - `BuyBoxSlot`: рендерится только для `type !== 'rx'`, тоже пустой резерв.
  - `YouTubeEmbed`: lite-embed (превью, iframe по клику) через `youtube-nocookie.com`.
  - Футер со ссылками на служебные страницы (Task 11) и подписью «Not medical advice».

- [ ] **Step 1: Написать падающие тесты**

```ts
test('specRows renders missing Rx price as null cell, not undefined', () => {})       // Review Focus 2
test('filterCatalog keeps model without weight when filtering by formFactor', () => {}) // Review Focus 2
test('productJsonLd has no aggregateRating or review keys', () => {})
test('SpecTable shows "—" for null and "According to example.com" for third-party', () => {})
```

- [ ] **Step 2: Запустить** `npm test -- site spec-table`. Ожидается FAIL.
- [ ] **Step 3: Реализовать.**
  - Страница модели: характеристики, варианты, сводка отзывов (оценки по источникам + темы жалоб с долями, без цитат), плюсы и минусы с подписью из Global Constraints, видео, «Same hardware as», ближайшие конкуренты (из Task 10, пока пустой список), `BuyBoxSlot`, два `AdSlot`.
  - Изображение: press-фото только при `brand.imageLicense === 'press-kit-editorial'` и наличии `public/images/<slug>.*`, иначе SVG-иконка форм-фактора.
  - Главная: 12 последних моделей по `releaseDate` и 10 последних событий.
  - GA4: `<GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />`, только если переменная задана.
- [ ] **Step 4: Запустить** `npm test` → PASS. Затем `npm run build` → успешная статическая генерация всех `/hearing-aids/[slug]`.
- [ ] **Step 5: Commit** `feat(site): layout, catalog, model pages`

---

### Task 10: Сравнения: курируемые пары, страницы `a-vs-b`, инструмент

**Files:**
- Create: `src/lib/site/pairs.ts`, `app/compare/[pair]/page.tsx`, `app/compare/page.tsx`
- Modify: `app/hearing-aids/[slug]/page.tsx` (блок «Closest competitors»)
- Test: `tests/lib/pairs.test.ts`

**Interfaces:**
- Consumes: `specRows`, `buildCatalogIndex` (Task 9).
- Produces:
  - `competitorsOf(slug: string, items: CatalogItem[], k = 10): string[]`. Оценка:
    - +3 за тот же `type`;
    - +2 за общий форм-фактор;
    - +1, если цены отличаются не более чем на 30%;
    - +1, если даты выхода отличаются не более чем на 12 месяцев.

    При равенстве сортировка по slug.
  - `selectCuratedPairs(items: CatalogItem[], k = 10): [string, string][]`: объединение `competitorsOf` по всем моделям, внутри пары slug'и по алфавиту, без дублей.
  - `pairSlug(a, b) = '<min>-vs-<max>'` и `parsePairSlug(s): [string, string] | null`.
  - `/compare/[pair]`: `generateStaticParams` = курируемые пары, `dynamicParams = false`. Таблица `specRows([a, b])`, сводки отзывов, плюсы и минусы обеих моделей.
  - `/compare?a=&b=`: клиентский инструмент, `metadata.robots = { index: false, follow: true }`. Если пара курируемая — ссылка на её канонический URL.

- [ ] **Step 1: Написать падающие тесты**

```ts
test('pairs are deduped and alphabetically ordered', () => {})
test('each model has min(k, n-1) competitors', () => {})
test('selection is deterministic', () => {})
test('parsePairSlug rejects malformed and self-pairs', () => {})
```

- [ ] **Step 2: Запустить** `npm test -- pairs`. Ожидается FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить** `npm test` → PASS. Затем `npm run build`. Ожидается: количество `/compare/*` страниц ≤ число моделей × 10.
- [ ] **Step 5: Commit** `feat(site): curated comparisons and compare tool`

---

### Task 11: Бренды, карта платформ, лента событий, служебные страницы, sitemap

**Files:**
- Create: `app/brands/[brand]/page.tsx`, `app/platforms/page.tsx`, `app/news/page.tsx`, `app/news/[id]/page.tsx`
- Create: `app/methodology/page.tsx`, `app/not-medical-advice/page.tsx`, `app/corrections/page.tsx`, `app/privacy/page.tsx`, `app/about-bot/page.tsx`
- Create: `app/sitemap.ts`, `app/robots.ts`, `src/lib/site/sitemap-entries.ts`
- Test: `tests/lib/sitemap.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `selectCuratedPairs`, `pairSlug` (Task 10).
- Produces:
  - `buildSitemapEntries(dataset: Dataset, baseUrl: string): { url: string; lastModified?: string }[]`. Входят: `/`, `/hearing-aids`, все модели, курируемые пары, бренды, `/platforms`, `/news`, события и служебные страницы. Не входят: `/compare` (инструмент) и `/review`.
  - `/platforms`: группы по `platform` + рёбра `sameHardwareAs`, у каждого ребра `SourceNote`.
  - `/news`: события по убыванию даты.
  - `/about-bot`: описание User-Agent, правил сбора и контакта для удаления (форма-ссылка на `/corrections`).
  - `/methodology`: откуда берутся данные, что значит `official`/`third-party`/`derived`, что тексты отзывов не публикуются, что мы не тестируем устройства.

- [ ] **Step 1: Написать падающие тесты**

```ts
test('sitemap includes curated pair, excludes non-curated pair and /compare tool', () => {})
test('sitemap never includes /review', () => {})
```

- [ ] **Step 2: Запустить** `npm test -- sitemap`. Ожидается FAIL.
- [ ] **Step 3: Реализовать** страницы и `sitemap.ts`/`robots.ts`. `robots.ts` разрешает всё, кроме `/review` и `/compare?`, и указывает sitemap.
- [ ] **Step 4: Запустить** `npm test` → PASS. Затем `npm run build` без ошибок.
- [ ] **Step 5: Commit** `feat(site): brands, platform map, news, legal pages, sitemap`

---

### Task 12: Конфиги всех брендов, первая загрузка, деплой

**Files:**
- Create: `data/brands/*.json`:
  - Rx: Phonak, Unitron, Oticon, Bernafon, Philips, Signia, Rexton, Widex, ReSound, Beltone, Starkey, Kirkland;
  - OTC: Jabra Enhance, Lexie, Eargo, Sennheiser, Audien, MDHearing;
  - Apple (AirPods Pro).
- Create: `README.md`: установка, ключи, `npm run update`, `/review`, публикация.

Шаги, где нужен владелец, помечены **[владелец]**.

- [ ] **Step 1: Для каждого бренда заполнить `scraper`** (catalogUrls, modelUrlPattern, render) и проверить: `npm run scrape -- --brand <slug> --limit 1`. Ожидается: модель извлечена или источник явно `skipped` с причиной. Бренды со `skipped/bot-protection` отметить в README, не обходить.
- [ ] **Step 2: [владелец] Установить Ollama и `ollama pull qwen3:8b`. Получить бесплатные `GEMINI_API_KEY` и `YOUTUBE_API_KEY`, записать в `.env.local`.**
- [ ] **Step 3: Полный прогон** `npm run update` (при коде 2 повторять `npm run update -- --resume`). Ожидается сводка с pending > 0.
- [ ] **Step 4: [владелец] Разобрать очередь на `/review`** (разово около 1.5–2.5 часа).
- [ ] **Step 5: Проверка.** `npm test && npm run build`. Ожидается PASS, страницы моделей, пар, брендов и новостей сгенерированы, в `out`/`.next` нет `/review`.
- [ ] **Step 6: [владелец] Создать проект на Vercel Pro, задать env, подключить домен. Затем `git push`.** Ожидается: сайт открывается, `/sitemap.xml` валиден, `/review` → 404.
- [ ] **Step 7: Commit** `chore: brand configs, initial dataset, readme`
