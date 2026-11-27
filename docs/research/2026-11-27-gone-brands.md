# Hearing-aid brands that left the US market (since 2018-01-01)

Research for the model archive plan, Task 12. Written 2026-11-27.

**Method.** Web search and reading of public news pages, press releases and company pages. Nothing was crawled. No SEC lookups were made (ruling F1). One SEC exhibit URL is cited because a search returned it; it was not fetched. Domain status comes from search results and news text only. No gone brand's live site was fetched. The Web Archive URLs below are the original URLs to look up in the archive. **Nobody has checked that the archive holds copies of them.** The crawl should confirm them with the CDX API.

**Nothing here is in data files yet.** The owner approves brands and sources later through `/review`. Only after that do they go into `data/atlas/sites.json` and `data/brands/*.json`.

Legend: ✔ checked in a primary or reputable source · ⚠ unverified or from one secondary source.

## Summary

| Brand | Type | Status | What happened (when) | Former domain | Domain now (from search) |
| --- | --- | --- | --- | --- | --- |
| Eargo | OTC (DTC) | **closed** | Taken private by Patient Square 2024-02-16 ✔; merged with hearX into LXE Hearing 2025-03-31 ✔; LXE US wind-down announced mid-July 2026 ✔ | eargo.com | Live with wind-down notice as of 2026-07-15 ✔; later state unknown |
| Lexie (hearX) | OTC | **closed** | Lexie B1/B2/B3 "Powered by Bose" after the 2022-07-27 Bose deal ✔; part of LXE 2025 ✔; US wind-down July 2026 ✔ | lexiehearing.com/us | Live with notice in July 2026 ✔; later unknown |
| Go Hearing | OTC (low-price LXE brand) | **closed** | LXE brand (Go Prime, Go Ultra); in the July 2026 wind-down ✔; launch date ⚠ | gohearing.com | Unknown |
| Lively | DTC Rx (ReSound-made) | **acquired → renamed** | Founded 2018 NYC; GN bought 91% 2021-12-14 ✔; renamed Jabra Enhance Nov 2022 ✔ | livelyhearing.com | Redirects to jabraenhance.com ⚠ (implied by the rebrand coverage, not observed) |
| Bose (SoundControl) | Self-fitting, FDA 510(k) K211008 | **exited hearing aids** | SoundControl sold 2021–2022; Health division closed May 2022 ✔; tech licensed to Lexie 2022-07-27 ✔ | bose.com (product pages) | bose.com live; SoundControl page still indexed ⚠ |
| Sony | OTC (made by WS Audiology) | **exited US** | CRE-C10/CRE-E10 (2022), CRE-C20; WSA and Sony did not renew the 2022 deal; exit reported ~April 2026 ✔ | electronics.sony.com (OTC category) | Domain live; OTC products removed ✔ |
| Nuheara (+ HP Hearing PRO) | Hearing earbuds; FDA OTC (IQbuds2 PRO, K221064) | **closed** | Voluntary administration 2024-08-07 (KPMG) ✔; DOCA 2025, company to be wound up on effectuation ✔ | nuheara.com (/usa); hphearingpro.com | nuheara.com/usa pages still indexed ⚠; state unknown |
| Whisper | Rx (subscription) | **closed / withdrawn** | Launched 2020; voluntary market withdrawal effective 2023-06-08, full refunds ✔ | whisper.ai | Unknown |
| Hansaton (US) | Rx (Sonova brand) | **exited US** | Announced 2018-09-18; left US 2019-06-30; customers and staff moved to Unitron ✔ | hansaton-usa.com ⚠ | Unknown |

Borderline cases and false leads are listed after the per-brand notes.

---

## Per-brand notes

### Eargo
- **Status:** closed. Corporate history: Nasdaq EAR. Patient Square became the majority owner in Nov 2022 through a rights offering (about 76%). A take-private deal was announced 2023-10-30 at $2.55 per share and closed 2024-02-16, when Eargo was delisted ✔. Eargo merged with hearX on 2025-03-31 to form LXE Hearing, with $100M from Patient Square ✔. The Eargo 8 launched in May 2025. Around 2026-07-15, LXE announced a US wind-down ✔: support continues through 2026-09-15, warranty claims are processed up to that date, and no further firmware updates are promised. No buyer had been announced as of the latest coverage (mid-July 2026).
- **Domain:** eargo.com. It was live and showed the wind-down notice on 2026-07-15 (HearingTracker screenshot). Its state after September is unknown.
- **SEC:** a public company until 2024. Its CIK appears in the cited exhibit URL. **`secCik` is not proposed**, because the SEC step is always skipped (ruling F1).
- **Archive catalog URLs to look up:**
  - `https://www.eargo.com/products-hearing-aids` (current config)
  - `https://eargo.com/hearing-aids` ⚠, `https://shop.eargo.com/` ⚠ (older patterns, not verified)
- **Proposed `historySources`:**
  - https://www.sec.gov/Archives/edgar/data/1719395/000114036124008279/ny20021593x2_ex99-1.htm (Eargo press release on the closing of the Patient Square acquisition, 2024-02-16; not fetched)
  - https://www.ropesgray.com/en/news-and-events/news/2025/03/eargo-and-hearx-close-merger-announce-new-combined-company-lxe-hearing
  - https://hearingreview.com/hearing-products/hearing-aids/otc/lxe-hearing-announces-wind-down-of-us-operations-affecting-eargo-lexie-and-go-brands (2026-07-17)
  - https://www.hearingtracker.com/news/eargo-and-lexie-parent-lxe-hearing-begins-u-s-wind-down
- Also seen: https://www.hearingtracker.com/news/eargo-to-be-fully-acquired-by-patient-square-capital-and-become-a-private-company, and LXE's own statement at https://lxehearing.com (cited by Hearing Review, not fetched).

### Lexie (hearX)
- **Status:** closed in the US. hearX is South African; its professional business continues outside the US ✔.
  - Lexie Lumen went on sale at Walgreens nationwide from 2022-10-17 ✔.
  - The Bose partnership was announced 2022-07-27 ✔. It produced the Lexie B1, then the B2 and B2 Plus "Powered by Bose", and the B3 (May 2026, $999) ⚠ for the month.
  - The H1 Hearing Buds launched in 2025.
  - Lexie was part of the LXE merger on 2025-03-31, and the US wind-down was announced in July 2026 ✔.
- **Domain:** lexiehearing.com/us. Live with the notice in July 2026 ✔; later state unknown.
- **Archive catalog URLs:** `https://lexiehearing.com/us` (current config), `https://lexiehearing.com/us/hearing-aids` ⚠, and product pages matching `lexiehearing.com/us/(products|hearing-aids)/…` (pattern from the current config).
- **Proposed `historySources`:**
  - https://www.businesswire.com/news/home/20220727005573/en/Bose-Enters-Into-Partnership-With-Lexie-Hearing
  - https://www.ropesgray.com/en/news-and-events/news/2025/03/eargo-and-hearx-close-merger-announce-new-combined-company-lxe-hearing
  - https://hearingreview.com/hearing-products/hearing-aids/otc/lxe-hearing-announces-wind-down-of-us-operations-affecting-eargo-lexie-and-go-brands
  - https://www.techlicious.com/blog/eargo-lexie-hearing-air-owners-losing-support-september-15/ (2026-07-17; lists the affected models)

### Go Hearing
- **Status:** closed. It was LXE's low-price OTC brand, with the Go Prime (ITE, about $249) and the Go Ultra (BTE, about $299), both sold at Best Buy and Walmart. LXE's notice sends Go customers to Lexie support ✔. **Launch date not found** ⚠. It is not in `data/brands` today. Whether to add it is the owner's decision: it has a small catalog and little coverage.
- **Domain:** gohearing.com (named by Techlicious). Current state unknown.
- **Archive catalog URLs:** `https://gohearing.com/` ⚠ (deeper paths unknown).
- **Proposed `historySources`:**
  - https://hearingreview.com/hearing-products/hearing-aids/otc/lxe-hearing-announces-wind-down-of-us-operations-affecting-eargo-lexie-and-go-brands
  - https://www.techlicious.com/blog/eargo-lexie-hearing-air-owners-losing-support-september-15/

### Lively
- **Status:** acquired, then renamed.
  - Founded in New York in 2018. It sold ReSound-made Rx hearing aids online (Lively 2 Lite, Plus and Pro).
  - On 2021-12-14, GN Hearing bought 91% for DKK 625M; management kept 9% ✔.
  - In Nov 2022, Lively Hearing Corp. became GN Consumer Hearing Corp. d/b/a Jabra Enhance ✔. The models were renamed: Lite → Enhance Select 50, Plus → Select 100, Pro → Select 200.
- **Domain:** livelyhearing.com, which presumably redirects to jabraenhance.com ⚠ (not observed). `data/atlas` already lists livelyhearing.com.
- **Related:**
  - The Jabra Enhance About page reportedly says "We are now Jabra Hearing" ⚠ (one search snippet; no press release found).
  - GN's hearing business is classified as discontinued operations, and an Amplifon purchase is expected by the end of 2026 ⚠ (Capitol Forum, HearingTracker). This changes the owner of jabra-enhance, ReSound and Beltone. It does not make them gone.
- **Archive catalog URLs:** `https://www.livelyhearing.com/`, `https://www.livelyhearing.com/hearing-aids` ⚠, plus Lively 2 model pages under that domain ⚠ (2019–2022).
- **Proposed `historySources`:**
  - https://hearingreview.com/inside-hearing/industry-news/gn-hearing-acquires-online-hearing-aid-provider-lively
  - https://www.hearingtracker.com/de/press-releases/gn-hearing-acquires-new-york-based-lively-a-leader-in-online-hearing-care (GN press release, syndicated copy; the gn.com original was not found)
  - https://hearingreview.com/hearing-products/hearing-aids/otc/lively-rebranded-to-jabra-enhance
  - https://hearinghealthmatters.org/hearing-technologies/2022/lively-gn-jabra-enhance-hearing-aids/

### Bose (SoundControl hearing aids)
- **Status:** exited hearing aids. Bose itself is active.
  - SoundControl was FDA-cleared (K211008), unveiled in May 2021 at $849, and later cut to $599 ✔.
  - In May 2022, the Boston Globe reported that Bose closed its Health division after an internal review concluded that Bose "should no longer be selling hearing aids" ✔.
  - On 2022-07-27, Bose licensed its self-fitting technology to Lexie (hearX) and stopped making SoundControl ✔. This was a licence and partnership, **not a sale of the business**.
  - Hearphones (a 2016 PSAP, not a hearing aid) were discontinued around 2020 ⚠.
- **Owner decision:** `gone` would apply to the hearing-aid line only. Bose's site is live, so the brand config should list only archived SoundControl URLs.
- **Domain:** bose.com is live. The US SoundControl product page is still indexed ⚠.
- **Archive catalog URLs:** `https://www.bose.com/p/bose-soundcontrol-hearing-aids/SNDCONTL-HEARINGAIDS-GRY-US.html`; the older 2021 URL format `https://www.bose.com/en_us/products/headphones/earbuds/soundcontrol-hearing-aids.html` ⚠ (guessed).
- **Proposed `historySources`:**
  - https://www.businesswire.com/news/home/20220727005573/en/Bose-Enters-Into-Partnership-With-Lexie-Hearing
  - https://www.bose.com/pressroom/upcoming-hearx-announcement
  - https://hearingreview.com/hearing-products/hearing-aids/otc/bose-exiting-hearing-aid-market
  - https://hearingtracker.com/news/bose-cease-hearing-aid-sales

### Sony
- **Status:** exited the US OTC market.
  - WS Audiology made the line under a 2022 agreement: CRE-C10 (CIC, disposable battery, $700), CRE-E10 (earbud, $900) and CRE-C20 (rechargeable CIC, $1,000) ✔.
  - The products were "no longer available" on Sony's US site for months. Around April 2026, WSA confirmed the deal was not renewed ✔. WSA honours warranties.
- **Owner decision:** as with Bose, the company is alive and only its hearing-aid line is gone.
- **Domain:** electronics.sony.com is live; the OTC category was emptied ✔.
- **Archive catalog URLs:** `https://electronics.sony.com/more/otc-hearing-aid/c/all-otc-hearing-aid` ✔ (named by HearingTracker), plus model pages under `electronics.sony.com/…/p/cre-c10…` etc. ⚠.
- **Proposed `historySources`:**
  - https://www.hearingtracker.com/news/sales-of-sony-hearing-aids-discontinued-wsa-eyes-next-steps-for-otc-market
  - https://thecapitolforum.com/four-years-after-otc-hearing-aid-rule-competition-in-hearing-aid-market-remains-limited/
  - An official Sony or WSA statement was not found ⚠. The WSA annual report 2026 is reportedly the basis, but it was not read.

### Nuheara (incl. HP Hearing PRO)
- **Status:** closed. Nuheara was Perth-based and listed on the ASX as NUH.
  - US products: IQbuds Boost (2018), IQbuds2 MAX (2020) and IQbuds2 PRO, FDA self-fitting OTC hearing aid K221064, cleared 2022-10-30 ✔.
  - The PRO was sold as **HP Hearing PRO** under an HP brand licence ($699; Best Buy, Target, Amazon) ✔.
  - Voluntary administrators (KPMG) were appointed on 2024-08-07, after a convertible note held by Realtek could not be renegotiated ✔.
  - A DOCA followed in 2025. It provides for the company to be wound up on effectuation ✔.
- **Domain:** nuheara.com (US section `/usa/`) and hphearingpro.com. Search still indexes nuheara.com/usa product pages; their current state is unknown ⚠.
- **Archive catalog URLs:** `https://www.nuheara.com/usa/products` ⚠ (indexed path), `https://www.nuheara.com/usa/` ⚠, `https://hphearingpro.com/` ⚠.
- **Proposed `historySources`:**
  - https://kpmg.com/au/en/creditors/nuheara.html
  - https://assets.kpmg.com/content/dam/kpmg/au/pdf/creditors/nuheara/nuheara-first-circular-to-creditors-8-august-2024.pdf
  - https://www.businessnewsaustralia.com/articles/looming-cash-crunch-forces-medical-technology-company-nuheara-to-call-in-administrators.html
  - https://hearingreview.com/hearing-products/hearing-aids/otc/nuheara-receives-fda-clearance-for-hp-hearing-pro

### Whisper
- **Status:** closed. The Whisper Hearing System was an Rx device with a pocket "Whisper Brain" AI processor, offered as a subscription at $179/month. It launched in 2020 after a $35M Series B ✔. The voluntary market withdrawal took effect 2023-06-08: no further service or production, full refunds, and limited support until 2023-12-01 ✔.
- **Domain:** whisper.ai. Current state unknown.
- **Archive catalog URLs:** `https://whisper.ai/` (single product; deeper paths ⚠).
- **Proposed `historySources`:**
  - https://www.hearingtracker.com/news/whisper-ai-announces-voluntary-market-withdrawal-of-whisper-hearing-systems-will-issue-refunds-to-purchasers
  - https://techcrunch.com/2020/10/15/whisper-announces-35m-series-b-to-change-hearing-aids-with-ai-and-subscription-model

### Hansaton (US)
- **Status:** exited the US. Hansaton is a Sonova Rx brand, sold through hearing care professionals. Sonova US announced on 2018-09-18 that Hansaton would leave the US effective 2019-06-30. Its customers and staff moved to Unitron ✔ (Unitron-hosted copy of the release; the India mirror I fetched had no body text, and the Canada URL comes from search).
- **Domain:** hansaton-usa.com ⚠ (from trade directories). Current state unknown.
- **Archive catalog URLs:** `https://www.hansaton-usa.com/` ⚠ (product paths unknown; 2018 lines included AQ, jam and beat).
- **Proposed `historySources`:**
  - https://www.unitron.com/ca/en_ca/learn/sonova-us-plans-departure-of-hansaton.html
  - https://hearingreview.com/hearing-products/hearing-aids/bte/hansaton-launches-brand-in-united-states (background only)

---

## Borderline cases (owner decides; not proposed as gone brands)

- **Jabra Enhance Plus:** a product, not a brand. The OTC earbud was discontinued 2024-10-01, with support until 2026-10-01 ✔ (https://www.hearingtracker.com/news/jabra-enhance-plus-otc-hearing-aid-to-be-discontinued). It belongs under `jabra-enhance` as a `discontinued` model. GN also ended its Jabra Elite and Talk earbuds (announced 2024-06-11).
- **iHEAR (iHear Medical → InnerScope):** InnerScope Hearing Technologies (OTC: INND) bought iHear Medical's assets on 2021-10-05 ✔ (https://www.bioworld.com/articles/512084-innerscope-acquires-ihear-expands-direct-to-consumer-hearing-aid-platform). The iHEAR OTC line was sold at CVS.com (2022) and Walmart (2023). In Oct 2025 came an alliance around AiNnova's purchase of OTCHealth Inc. The brand's current status is **unclear** ⚠. Re-check before treating it as gone.
- **Panasonic:** a Newsquawk headline reports, citing Nikkei, that Panasonic exits the hearing aid business. The item is undated ⚠. Panasonic entered the US in 2010, but **no evidence of US sales after 2018 was found**, so this is probably out of scope.
- **Zounds Hearing:** CB Insights lists it as "dead". No date or source was found ⚠. There was an earlier Chapter 11 in 2009.
- **Hearing Help Express (Intricon):** a mail-order DTC seller. Intricon sold its hearing health business to inHearing in Sept 2024 ✔ (https://prnewswire.com/news-releases/inhearing-technology-inc-announced-the-acquisition-of-intricons-hearing-health-business-302251189.html). What became of the HHE brand is unknown ⚠.
- **Starkey MicroTech / AudioSync:** later Starkey materials list only Audibel, NuEar and Starkey. The drop date is unknown, probably before 2018 ⚠.
- **Ownership changes (status stays `active`):** GN Hearing (ReSound, Beltone, Jabra Enhance, Interton) is expected to pass to Amplifon by the end of 2026 ⚠. Sennheiser hearing is under Sonova (already noted in the spec).

## Checked and not gone (no closure or exit found)

| Brand | Finding |
| --- | --- |
| Nano Hearing Aids | Bought by Trinity Investors and Sancus in 2021; settled with Vermont in Feb 2025; moved manufacturing to the US in July 2025. Active. |
| Olive Union | Olive Air OTC is "In Commercial Distribution" in GUDID. Only the older Olive Plus is marked not in distribution (Apr 2023). No exit found. |
| Orka | Orka Two was "out of stock" for a while ⚠, but ORKA showed a new RIC with ANC at AWE 2026. Active. |
| Otofonix | Trademark activity in 2024; still sold online. No closure found. |
| Concha Labs | Concha Sol (FDA K233747) still reviewed as current by WIRED in June 2025. Active. |
| Tweak (Ear Technology Corp.) | GUDID lists a Tweak OTC hearing aid. No closure news found ⚠. |
| Walgreens-branded | Walgreens BTE OTC (GUDID published May 2024) is "In Commercial Distribution". No "Ascent" line or exit found. |
| Audicus | BBB responses in 2025; about 83 staff per PitchBook (2025). Active. |
| Earlens | Funding in April 2024; listed as operational. No exit found. |
| Interton, Sonic, NuEar | GUDID entries in commercial distribution; new launches. Active. |
| Sound World Solutions (CS50+) | PSAP, not a hearing aid. Out of scope. |
| Doppler Labs (Here One) | PSAP; closed Nov 2017, before the window. Out of scope. |

## Suggested next steps for the owner (in `/review`)

1. Confirm the gone list. Strong candidates: Eargo, Lexie and Lively, which are already in `data`, plus Nuheara, Whisper, Sony, Bose and Hansaton. Go Hearing is optional.
2. For Bose and Sony, decide whether `gone` fits a brand whose company is still alive and only left hearing aids.
3. Approve or trim each `historySources` list. Then the controller adds the approved domains to `data/atlas/sites.json` (eargo.com, lexiehearing.com and livelyhearing.com are already listed) and runs `atlas:crawl` / `atlas:describe` against Web Archive copies only.
