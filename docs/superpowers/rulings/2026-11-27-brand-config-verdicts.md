# Brand config verdicts (2026-11-27)

Read-only check of the 14 `brand-config` cards in `data/pending/industry-brands-<slug>.json` against
`data/atlas/sites/<domain>/report.json` (pages, `urls`, templates, `pdfHosts`, per-page `pdfs`, `needsRender`), the
site README, the current `data/brands/<slug>.json` (every card's `before` equals it), and `src/lib/schema/brand.ts`.
All 14 `after` values pass the strict `Brand` schema and compile as RegExp. Patterns were run over every URL in each report.
Status: `eargo` is `gone` and all the others are `active`, as required. Only `eargo` has `archive`. Every proposal has
`render: false`. That fits every catalog page, all of which have `needsRender: false`. Where a support page is
flagged as needing render, the note under its brand says so.

Summary: 5 REJECT (bernafon, eargo, resound, rexton, sennheiser) and 9 APPROVE-WITH-NOTE.

## apple: APPROVE-WITH-NOTE
- Catalogs `/airpods-pro/` and `/airpods-pro/compare/` were both crawled. `modelUrlPattern` is unchanged (`^https://www\.apple\.com/airpods-pro/specs/$`) and matches only that page, so it stays limited to AirPods Pro (rule 8).
- `documentUrlPattern` `^https://www\.apple\.com/environment/pdf/products/airpods/.*\.pdf$` matches 1 of the 5 PDFs in the report. It rejects the generic environment reports and the goldmansachs.com PDFs.
- Note: `supportUrls` lists the model page itself (`/airpods-pro/specs/`). That is harmless, and it is how the environment PDF gets collected. `/airpods-pro/hearing-health/` is a feature page with 0 PDFs, not a support page.

## audien: APPROVE-WITH-NOTE
- The catalog `/collections/all` and the explicit 7-slug model pattern are unchanged. The pattern matches the 7 clean product URLs and none of the `?_pos=` duplicates or accessories.
- Note: the only addition, `/pages/support`, is a contact page (phone, email, form) with 0 PDFs and no model list, so it adds nothing. Consider dropping it. Products not in the pattern (`atom-x-connect-otc-hearing-aid`, `atom-x-otc-hearing-aid`) were already missing before this card.

## beltone: APPROVE-WITH-NOTE
- The catalog and pattern are unchanged and match the 8 `/en-us/products/hearing-aids/beltone-*` pages. The added `/en-us/help-center/hearing-aids-support` was crawled and lists the per-model support pages.
- Note: that hub has 0 PDFs, and the user guides sit one level deeper on `/help-center/hearing-aids-support/beltone-*-support` pages, which are not fetched. Adding no `documentUrlPattern` is consistent: the only PDF in the report is a GN charger notice.

## bernafon: REJECT
- `supportUrls` were added for the documents they carry: `/for-professionals/resource-centre` links 18 PDFs (TD and IFU files such as `281334US_TD_BE_Alpha_MNR_T…pdf`), and the compatibility guide and app pages link more. But the card has no `documentUrlPattern`. The scraper only keeps document links when that pattern is set, so all 41 Demant PDFs (37 on `damcdn.demant.com`, 4 on `assets.ha.demant.com`) are dropped.
- Fix: add `documentUrlPattern` `^https://(?:damcdn\.demant\.com|assets\.ha\.demant\.com)/.+\.pdf`, the same Demant pattern the oticon card uses. Everything else is fine: the catalog and pattern are unchanged and match 5 `/products/{n}/{slug}` pages.
- Note: `/support/compatibility-guide` is flagged needsRender, although its 2 PDFs were read without render. The pattern also queues `cros-and-bicros-minirite-t-r` (a CROS device), the same as before.

## eargo: REJECT
- `modelUrlPattern` `^https://www\.eargo\.com/products-hearing-aids/[a-z0-9-]+/?$` matches no URL in the report (the card's own check fails). The report's model URLs are `https://shop.eargo.com/eargo-5|6|7|max|neo|neo-hifi|plus` and `https://www.eargo.com/guides/eargo-7/` (also eargo-8, eargo-se, link-by-eargo). Older copies link from `eargo.com` without `www.`.
- `archive.catalogUrls` is `https://web.archive.org/web/2023id_/https://www.eargo.com/products-hearing-aids`, which breaks rule 6:
  - It is a Web Archive URL, not the original, and "2023" is not a real timestamp. The card's check says it is in neither the report nor the fetch log.
  - It would trigger the latent `ownHosts` bug parked in `2026-11-27-atlas-and-archive.md`: `web.archive.org` would become a gone-brand host and block the archive.
  - It is redundant anyway, because a gone brand falls back to `scraper.catalogUrls`.
- Fix:
  - Drop `archive`, or give it original URLs such as `https://www.eargo.com/products-hearing-aids` and `https://shop.eargo.com/store`.
  - Change the pattern to something like `^https?://(?:www\.|shop\.)?eargo\.com/(?:eargo-[a-z0-9-]+|guides/(?:eargo-[a-z0-9-]+|link-by-eargo))/?$`.
  - Add `https://shop.eargo.com/store` as a catalog page.
  - Optionally, add a document pattern for `d9jpa82qnx9c8.cloudfront.net/assets/EARGO_*.pdf`.
- `status: gone` and `supportUrls` `https://www.eargo.com/guides/` are correct.

## jabra-enhance: APPROVE-WITH-NOTE
- The pattern narrows from `/product/[a-z0-9-]+` to `/product/enhanceselect[a-z0-9]+`. This has a reason: the old pattern also matched the 9 comparison pages (`m3-vs-500`, `700-vs-100`, …). The new one matches exactly `enhanceselectm1|m2|m3`, the 3 pages in the product sitemap. No model page is lost.
- `documentUrlPattern` `^https://(cdn|sound-files)\.jabraenhance\.com/.+\.pdf$` matches the 5 own PDFs (for example `cdn.jabraenhance.com/shared/userguides/enhance-select-m3.pdf`) and rejects the hearingloss.org PDF.
- Note: `/start` is flagged needsRender, but its 2 getting-started PDFs were read without render.

## kirkland-signature: APPROVE-WITH-NOTE
- The catalog moves from `/hearing-aid-center.html` to `https://www.costco.com/f/-/hearing-aid-center`, the page that was actually fetched. The `kirkland-signature-…hearing-aid…` pattern is unchanged, which keeps it limited to hearing-aid pages (rule 8).
- Note: `supportUrls` repeats the catalog URL. That is a useless duplicate fetch, so drop it. The pattern matches 0 URLs because Costco lists no Kirkland Signature aid (the report shows Philips, Jabra, Rexton, Sonite and Audien). This matches the README and was already true before.

## oticon: APPROVE-WITH-NOTE
- The catalog and pattern are unchanged (11 matches). `documentUrlPattern` `^https://(?:damcdn\.demant\.com|p3\.aprimocdn\.net|assets\.ha\.demant\.com)/.+\.pdf` matches all 62 PDFs in the report, and every one is on a Demant/Oticon CDN.
- Note: neither support page lists model documents:
  - `/products/app` links Companion App IFUs.
  - `/support/compatibility-guide` (flagged needsRender, but its 4 PDFs were read without render) links compatibility overviews.
  - Expect "documents match no model page" warnings.
- Note: the unchanged family exclusion (`opn`, `more`, `xceed`, `zircon`, …) may cut models sold since 2018 that are still in the live catalog (for example `/products/100051/oticon-opn-bte-plus-power`). This is a separate question for the owner, not a defect of this card.

## philips: APPROVE-WITH-NOTE
- The pattern drops the `(?!30-)` exclusion. It now matches 18 pages, including 9 `hearlink-30-*` pages that the en-us catalog lists. This reverses a documented choice (repo README: "HearLink 30 is left out by the pattern"), and the card gives no reason. It is consistent with the `onSaleSince 2018` scope, though. Approve only if the owner accepts the HearLink 30 cards, and update the README row.
- `documentUrlPattern` `^https://damcdn\.demant\.com/[0-9a-f-]+/.+\.pdf$` matches all 30 PDFs. The support page `/en-us/products/hearlink-2-app` only adds 9 app IFUs, not model documents.

## resound: REJECT
- The widened pattern `^https://www\.resound\.com/en-us/hearing-aids/resound-hearing-aids/[a-z0-9-]+$` rightly picks up unprefixed model slugs (`enzo-q`, `enzo-3d`, `enzo2`, `linx-3d`, `linx2`). It also matches `/resound-hearing-aids/rechargeable`, a feature page and not a model, which breaks rule 3.
- Fix: exclude that page, for example `…/resound-hearing-aids/(?!rechargeable$)[a-z0-9-]+$`.
- Note:
  - `/en-us/help/accessories` is in the report's URLs but was not crawled.
  - The support hubs have 0 PDFs. The guides are on the per-model `/en-us/help/hearing-aids/{slug}` pages, which are not fetched.
  - `documentUrlPattern` `^https://www\.resound\.com/-/media/.+\.pdf$` has a single example in the report (an Assist survey). The README also mentions PDFs on `cdn1-originals.webdamdb.com`, which the pattern does not cover.

## rexton: REJECT
- `modelUrlPattern` now covers `(reach|bicore|mycore|trucore)` (19 matches), but `catalogUrls` only adds `/en-us/hearing-aids/bicore/`. The family pages `/en-us/hearing-aids/mycore/` and `/trucore/` are in the report but missing, so those 8 models can only arrive as support-only models, not as catalog models. Fix: add both pages to the catalog, or drop the two families from the pattern. `motioncore` is left out either way.
- Neither support URL fits rule 2:
  - `/en-us/support/faq/` is a general FAQ with 12 links and 0 PDFs.
  - `/en-us/support/hearing-aids/bte-rechargeable/` is one of 8 style pages, picked arbitrarily, and was not crawled.
  - Fix: use the hub `/en-us/support/hearing-aids/` instead.
- `documentUrlPattern` `^https://cdn\.rexton\.com/-/media/.+\.pdf` is fine: it matches all 14 `cdn.rexton.com` PDFs, including `?rev=` feature overviews.

## sennheiser: REJECT
- The new pattern `^https://us\.sennheiser-hearing\.com/(collections/[a-z0-9-]+/)?products/(sennheiser-)?all-day-clear[a-z0-9-]*$` matches 25 report URLs. 21 of them are accessories (`all-day-clear-cerustop`, `-charging-case`, `-power-pack`, `-replacement-ear-tips`, `-wax-guards`, `-tv-connector`, and the `-set` bundles). The old pattern only matched `sennheiser-all-day-clear` and `-slim`, so this breaks rule 3.
- `supportUrls` has two problems:
  - `https://support.sennheiser-hearing.com/hc/en-us` is in neither the report nor the fetch log (the card's check fails).
  - `/products/sennheiser-all-day-clear` is a model page, not a support page.
- Fix: keep the old `sennheiser-` prefix and allow only a collection prefix: `^https://us\.sennheiser-hearing\.com/(?:collections/[a-z0-9-]+/)?products/sennheiser-all-day-clear(?:-slim)?$`. Drop both support URLs. Keeping the catalog `/collections/hearing` is fine.

## starkey: APPROVE-WITH-NOTE
- The catalog and pattern are unchanged (6 AI family pages). `/support/operations-manuals` (36 PDFs) and `/compatibility` are good support pages.
- `documentUrlPattern` covers `cdn.mediavalet.com/usil/starkeyhearingtech/…pdf` and `eifu.starkey.com/eifu/pages/viewers/pdf?groupDocNumber=…`, matching 43 of 45 PDFs. It rejects jnnp.bmj.com.
- Note: `/hearing-aids/bluetooth-hearing-aids` is a topic page, as the site README itself says, and not a support page. Its PDFs are Auracast flyers, so drop it. The site-wide ESG and climate PDFs also match the pattern and will count as unmatched documents.

## unitron: APPROVE-WITH-NOTE
- The catalog and pattern are unchanged (`insera-s-r`, `moxi-s-rx`). `documentUrlPattern` `^https://www\.unitron\.com/content/dam/.+\.pdf(\.coredownload\.pdf)?$` matches all 78 PDFs, all on unitron.com. `/professionals/hearing-aid-resources` links 23 datasheets, for example `uh-datasheet-moxi-s-rx-….pdf.coredownload.pdf`.
- Note: the user-guide subpages are picked inconsistently. `/support/user-guides/blu` (an older platform, not crawled) is included, while `/smile`, `/vivante` and `/previous-platforms` in the report are not. `/support/user-guides/accessories` is flagged needsRender, although its 2 PDFs were read without render.

## Second round: gone brands (2026-11-27)

Cards `industry-brands-eargo` and `industry-brands-lexie` were checked against the same report, schema and rule 6. `applyDecision` can edit only a `new-model` card (`skipPaths`), so a `brand-config` card cannot be approved with corrections. Both were rejected through `applyDecision`, and their fingerprints are in `data/rejections.json`. The corrected configs below pass the `Brand` schema and were run over every URL in the reports.

### eargo: REJECT (second time)
- `archive.catalogUrls` is again a Web Archive URL (`web/20260417045936id_/…/products-hearing-aids/`). `ownHosts` would then include `web.archive.org`.
- `modelUrlPattern` is unchanged and still matches no URL in the report. No `archive.modelUrlPattern` and no document pattern were given.
- Proposed instead:
  - `archive.catalogUrls`: `https://www.eargo.com/`, `https://shop.eargo.com/store`, `https://www.eargo.com/products-hearing-aids`. The home copies from 2018 to 2024 link the shop model pages. `/store` is linked from the 2018 copy. The catalog copy is from 2026-04-17.
  - `modelUrlPattern` (in `scraper` and `archive`): `^https?://(?:shop\.eargo\.com/eargo-[a-z0-9-]+|(?:www\.)?eargo\.com/guides/(?:eargo-[a-z0-9-]+|link-by-eargo))/?$`. It matches 11 URLs: the 7 `shop.eargo.com/eargo-*` pages and the 4 guides pages. It does not match `/eargo-difference`, `/eargo-101`, the blog or the legal pages.
  - No `documentUrlPattern`. The only PDF host in the report is `d9jpa82qnx9c8.cloudfront.net`, which is not a brand host, and the archive's PDF lookup searches only `eargo.com`.

### lexie: REJECT
- All three `archive.catalogUrls` are Web Archive URLs, so `web.archive.org` would be an own host.
- `modelUrlPattern` `…/us/(?:products|hearing-aids)/…` matches no URL in the report. The real model pages are `/us/lexie-*-hearing-aid(s)`.
- `documentUrlPattern` matches the 4 `www.lexiehearing.com/documents/…pdf` files. Archive originals can lack `www.` or use http, so the pattern should allow both.
- Proposed instead:
  - `archive.catalogUrls`: `https://lexiehearing.com/us` (copies from 2021 to 2026).
  - `modelUrlPattern` (in `scraper` and `archive`): `^https?://(?:www\.)?lexiehearing\.com/us/lexie-[a-z0-9-]+-hearing-aids?(?:\.html)?$`. It matches the B1, B2, B2 Plus and Lumen pages, but not `/us/accessories/…`, `support-lexie-*`, `lexie-privacy-policy` or `lexie-rewards`.
  - `documentUrlPattern`: `^https?://(?:www\.)?lexiehearing\.com/documents/.+\.pdf$`. The `supportUrls` from the card stay as they are.
  - The 2025 and 2026 home copies have no links, so B3 and H1 model pages are not reached from the catalog.

## Third round: Web Archive model patterns for live brands (2026-11-27)

The Web Archive step reads a live brand's archived catalog copies with `scraper.modelUrlPattern` unless
`archive.modelUrlPattern` is set. Several live patterns match only today's model pages, so `.cache/archive-run4.log`
found no old models. Every active brand's cached catalog copies (`.cache/raw/log.jsonl`, `web/<ts>id_/<catalogUrl>`,
status 200) were parsed for links, and the live pattern and the new pattern were run over them. An `archive` block is added
only where the live pattern misses archived model pages. Its `catalogUrls` equal `scraper.catalogUrls`, because the schema requires them,
so the archive step reads the same catalogs as before. `scraper` is unchanged. Each config went through a `brand-config` card that was approved with `applyDecision`.

### audien: archive pattern added
- Pattern: `^https?://(?:www\.)?audienhearing\.com/products/(?:the-)?(?:audien-)?(?:ev\d+|atom|ion)(?:-(?!charger|dock|case|copy)[a-z0-9]+)*/?$`
- The live 7-slug list matches 0 links in the one cached copy (2020-10-31). The new pattern matches 2:
  `https://audienhearing.com/products/ev1` and `https://audienhearing.com/products/ev3`. `?variant=` links do not match.
- Over the live atlas report it matches 17 hearing-aid pages (for example `atom-pro-2`, `audien-atom`, `ion-iq`). It matches no
  charger dock, charger case, `-copy` page, ear tip, maintenance kit, shield, protection plan or gift card.
- Note: the fetcher marks that 2020 copy `archived-wall`, but it is a real Shopify listing of EV1 and EV3. Until that is
  fixed, the archive step reads 0 Audien catalog copies.

### bernafon: archive pattern added
- Pattern: `^https?://(?:www\.)?bernafon\.us/products/hearing-aids/family/[a-z0-9-]+/?$`
- The archived catalog links family pages only, never `/products/{n}/{slug}` style pages. The live pattern matches 0 links in
  3 copies. The new pattern matches 3: `/products/hearing-aids/family/alpha`, `/family/alpha-xt` and `/family/encanta`
  (2024: 2, 2025: 3, 2026: 3). It does not match `/category/behind-the-ear`, accessories, the app page or music.
- Bernafon models are stored per family (`bernafon-alpha`, …), so a family page is a model page. The live atlas also has
  `/family/leox` and `/family/viron`, and the pattern matches both. The cached copies start in 2024.

### jabra-enhance: archive pattern added
- Pattern: `^https?://(?:www\.)?jabraenhance\.com/product/enhance(?:select[a-z0-9]+|plus)/?$`
- The live pattern matches 10 of the 11 archived model links. It misses `https://www.jabraenhance.com/product/enhanceplus`
  (Jabra Enhance Plus, in the 2023 copy). The new pattern matches all 11, from `enhanceselect50`, `50r`, `100`, `200`, `300`,
  `500` and `700` to `m1`, `m2` and `m3`. It does not match the `/product` catalog or the `…-vs-…` comparison pages.

### oticon: archive pattern added
- Pattern: `^https?://(?:www\.)?oticon\.com/products/hearing-aids/family/[a-z0-9-]+/?$`
- The archived catalogs (2025-11-19, 2026-09-03) link family pages only. The live pattern, with its family exclusion,
  matches 0 links. The new pattern matches 11 families. 5 of them are old: `/family/more`, `/family/own`, `/family/play-px`,
  `/family/real` and `/family/xceed`. The others are intent, own-si, play-si, reveal, verit and zeal. It does not match the
  `/category/…` pages or the catalog.
- Oticon models are stored per family (`oticon-intent`, …). Over the live atlas it also matches `opn-s`, `opn-play`,
  `xceed-play`, `jet-px` and `cros`.

### Not needed
- apple: the live pattern `/airpods-pro/specs/` matches in all 14 copies (2019 to 2026). The other AirPods lines stay out of scope (rule 8).
- beltone: the live pattern matches 8 `beltone-*` pages in 4 copies (2023 to 2026). `jabra-enhance-plus` is a Jabra product.
- mdhearing: the live pattern matches 6 pages in 5 copies (2022 to 2026), including Air, Volt and Volt Max. The trailing-slash duplicates are the same pages.
- phonak: the live pattern matches 27 links in 5 copies (2022 to 2026), including Marvel, Paradise and the Bolero, Naida Link M and Slim pages.
  It also matches the non-model pages `/guide` (the extraction failure in run 4) and `/lumity-hearing-aids`. That is an overmatch, not a miss, so no pattern was added.
- philips: the Web Archive does not serve the site (CDX 403, `archive-excluded`), so it has no copies and no pattern.
- kirkland-signature, resound, rexton, sennheiser, signia, starkey, unitron, widex: no catalog copy is cached, because
  run 4 stopped at phonak or skipped the brand. They are not decided. Their live patterns are narrow (one family or a name filter)
  and are worth checking once copies are cached.
