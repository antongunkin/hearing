import type { CheckResult } from '@/src/lib/schema/pending'

// Phrases that imply first-hand testing or an invented expert voice. Text written for the site must not contain them.
const FORBIDDEN = [/\btested\b/i, /hands-on/i, /we wore/i, /in our testing/i, /our (audiologist|expert)/i]

export function forbiddenCheck(text: string): CheckResult {
  const normalized = text.replace(/\s+/g, ' ')
  const hits = FORBIDDEN.filter((pattern) => pattern.test(normalized)).map((pattern) => pattern.source)
  return hits.length === 0
    ? { name: 'forbidden', ok: true }
    : { name: 'forbidden', ok: false, detail: `forbidden phrase(s): ${hits.join(', ')}` }
}
