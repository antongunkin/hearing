/** Source text in one prompt (Ruling M: Claude's budget). */
export const PROMPT_TEXT_BUDGET = 48_000

/** The part of the text that fits `max`, placed where matches of `words` (a global pattern) are densest. */
export function excerpt(text: string, max: number, words: RegExp): string {
  if (text.length <= max) return text
  const hits = [...text.matchAll(words)].map((match) => match.index)
  let best = { start: 0, count: 0 }
  for (const hit of hits) {
    const start = Math.min(Math.max(0, hit - 500), text.length - max)
    const count = hits.filter((other) => other >= start && other < start + max).length
    if (count > best.count) best = { start, count }
  }
  return text.slice(best.start, best.start + max)
}
