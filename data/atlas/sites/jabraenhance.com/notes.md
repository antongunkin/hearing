# jabraenhance.com: notes

Read README.md and notes.md before working with this site; append what you learn, with the date.

## Log

Started 2026-11-27. Add entries below as `- YYYY-MM-DD: what was tried and what came of it`.

- 2026-11-27: Re-crawled with `--refresh` after fixing a false-positive in `looksLikeBotWall` (it flagged pages carrying a reCAPTCHA-protected contact form as walls). The Helpjuice-powered `help.jabraenhance.com` articles now fetch fine (HTTP 200, real text) — the owner correctly identified these as open, not blocked. 58 pages, 4 failures (`/refer` and `/my-account` are robots-disallowed; two 404s). describe → 35 statements, brand-config card queued to /review.
