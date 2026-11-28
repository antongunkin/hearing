# mdhearingaid.com: notes

Read README.md (none yet) and notes.md before working with this site; append what you learn, with the date.

## Log

- 2026-11-28: support.mdhearingaid.com answers 403 (bot wall) to a plain retry; static.mdhearingaid.com (the PDF host) has robots.txt HTTP 403, so the pipeline treats it as a refusal. Both honoured, nothing worked around.
- 2026-11-28: Web Archive has the support pages and manual PDFs. Raw copies read through fetchPage: Manuals-and-Guides category (20260130205827) and the NEO, AIR, VOLT, VOLT MAX, CORE, Read Me First and App manuals articles (2025-08..2025-10); they link PDFs at static.mdhearingaid.com/collateral/*.pdf. PDF copies that read with text and name their model: NEO-SeriesR (20240626204644), NEOXS-SeriesR (20240716014951), AIR3-SeriesA (20240701131935), VOLT-SeriesH (20240518003127). No copy yet of NEOXS2-SeriesH, NEOXSPRO-SeriesH, VOLTMAX2-SeriesAV.
- 2026-11-28: the six mdhearing models hold no documents. To link these manuals the brand needs scraper.documentUrlPattern (e.g. the static.mdhearingaid.com/collateral/ PDFs); that is a brand-config change, so it goes through /review.
