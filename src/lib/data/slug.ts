/** Lowercase without ™®© and diacritics. */
function fold(text: string): string {
  return text
    .replace(/[™®©]/g, '') // before NFKD, which would turn ™ into the letters "TM"
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

/** Comparison form of a product name: no ™®©, diacritics, "hearing aid(s)", case or extra spaces. */
export function normalizeName(name: string): string {
  return fold(name)
    .replace(/\bhearing\s+aids?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The words of folded text. A point or comma between digits stays in the word: "4.7" holds no "7". */
const wordsOf = (text: string) => text.match(/(?:[a-z0-9+]|(?<=\d)[.,](?=\d))+/g) ?? []

/** Whether `name` stands in `text` as whole words, both in comparison form. False for an empty name. */
export function containsName(text: string, name: string): boolean {
  const words = (value: string) => wordsOf(normalizeName(value)).join(' ')
  const needle = words(name)
  return needle !== '' && ` ${words(text)} `.includes(` ${needle} `)
}

/** Comparison form of a model name, without a leading brand name (`brand` is a brand slug). */
export function nameWithoutBrand(brand: string, name: string): string {
  const prefix = normalizeName(brand.replaceAll('-', ' '))
  const key = normalizeName(name)
  return key.startsWith(`${prefix} `) ? key.slice(prefix.length + 1) : key
}

/** Words that product names share with ordinary text. */
const COMMON_WORDS = new Set(['air', 'basic', 'elite', 'go', 'lite', 'max', 'mini', 'one', 'plus', 'premium', 'pro', 'select'])

/** Whether words are likely to turn up on a page that is not about the model: "7", "plus", "pro max". */
const isWeak = (words: string[]) =>
  words.length === 1 || words.every((word) => !/[a-z]/.test(word)) || words.every((word) => COMMON_WORDS.has(word))

/** Whether the words stand in `text` next to each other, with nothing but spaces and hyphens between. */
function standsTogether(text: string, words: string[]): boolean {
  const phrase = words.map((word) => word.replace(/[.+]/g, '\\$&')).join('[\\s-]+')
  return new RegExp(String.raw`(?<![a-z0-9+])(?<!\d[.,])${phrase}(?![a-z0-9+])(?![.,]\d)`).test(text)
}

/**
 * Whether the text names the model, by its name or an alias. The brand may be left out, except before a
 * name too weak to stand alone (one word, only numbers, or only common words): that one must directly
 * follow the brand.
 */
export function namesModel(text: string, model: { brand: string; name: string; aliases: string[] }): boolean {
  const brand = wordsOf(fold(model.brand.replaceAll('-', ' ')))
  // As written: "hearing aids" stays, and ™®© part words instead of joining them.
  const written = fold(text.replace(/[™®©]/g, ' '))
  return [model.name, ...model.aliases].some((name) => {
    const words = wordsOf(nameWithoutBrand(model.brand, name))
    if (words.length === 0) return false
    return isWeak(words) ? standsTogether(written, [...brand, ...words]) : containsName(text, words.join(' '))
  })
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
