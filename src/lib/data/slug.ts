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

/** File name and URL segment for a model. */
export function modelSlug(brand: string, name: string): string {
  return normalizeName(`${brand} ${name}`)
    .replace(/\+/g, ' plus ') // "Pure+" must not overwrite "Pure"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
