/** Comparison form of a product name: no ™®©, diacritics, "hearing aid(s)", case or extra spaces. */
export function normalizeName(name: string): string {
  return name
    .replace(/[™®©]/g, '') // before NFKD, which would turn ™ into the letters "TM"
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\bhearing\s+aids?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lowercase ASCII words joined by hyphens; empty when the text has no letters or digits. */
export function slugify(text: string): string {
  return normalizeName(text)
    .replace(/\+/g, ' plus ') // "Pure+" must not overwrite "Pure"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** File name and URL segment for a model: brand, then the name without a repeated brand. */
export function modelSlug(brand: string, name: string): string {
  const prefix = slugify(brand)
  const full = slugify(name)
  if (full === prefix) return prefix
  const rest = full.startsWith(`${prefix}-`) ? full.slice(prefix.length + 1) : full
  return [prefix, rest].filter(Boolean).join('-')
}
