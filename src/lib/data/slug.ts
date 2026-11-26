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

/** Whether `name` stands in `text` as whole words, both in comparison form. False for an empty name. */
export function containsName(text: string, name: string): boolean {
  const words = (value: string) => normalizeName(value).split(/[^a-z0-9+]+/).filter(Boolean).join(' ')
  const needle = words(name)
  return needle !== '' && ` ${words(text)} `.includes(` ${needle} `)
}

/** Comparison form of a model name, without a leading brand name (`brand` is a brand slug). */
export function nameWithoutBrand(brand: string, name: string): string {
  const prefix = normalizeName(brand.replaceAll('-', ' '))
  const key = normalizeName(name)
  return key.startsWith(`${prefix} `) ? key.slice(prefix.length + 1) : key
}

/** Whether the text names the model, by its name or an alias, with or without the brand. */
export function namesModel(text: string, model: { brand: string; name: string; aliases: string[] }): boolean {
  return [model.name, ...model.aliases].some((name) => containsName(text, nameWithoutBrand(model.brand, name)))
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
