# signia.net: notes

Read README.md and notes.md before working with this site; append what you learn, with the date.

## Log

Started 2026-11-27. Add entries below as `- YYYY-MM-DD: what was tried and what came of it`.

- 2026-11-27: First crawl, after fixing a false-positive in `looksLikeBotWall`. The `/en-us/support/` pages carry a reCAPTCHA contact form (`recaptcha/api.js` + hidden `__CaptchaValue` fields + the "protected by reCAPTCHA" badge) with little server-rendered text; the old detector wrongly read that as a wall. Now fetched fine. 57 pages, 3 failures (three es-ar/ar locale 404s). describe → 25 statements, brand-config card queued to /review.
