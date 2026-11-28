# Agent notes

## Site atlas notes rule

Before working with a site in `data/atlas/sites/<domain>/`, read its `README.md` and `notes.md`. Afterwards, append
what you learned to that site's `notes.md` as a dated line: `- YYYY-MM-DD: what was tried and what came of it`. Do not
rewrite earlier entries.

## Standing rules

- Brand configs (`data/brands/*.json`) change only through `/review` (kind `brand-config`). Company relations reach the
  site only through `/review` (kind `relation`).
- Raw pages and PDFs live only in `.cache/raw/`. Never commit them, nor `.cache/` or `data/pending/`. The repository is public.
- Never fetch Google (including Shopping and Play) or Amazon.
- Every network request goes through `fetchPage`.
- No personal details of the owner in code, data, docs or request headers.
- `/review` is for development only, bound to loopback.
