import { visibleText } from './html'

const BLOCKED_STATUSES = [403, 429, 503]
const MARKERS = /captcha|cf-challenge|challenge-platform|px-captcha|access denied|request unsuccessful\. incapsula/i
/** A page with less visible text than this is small. Real pages mention the markers too (a form's reCAPTCHA). */
const SMALL_TEXT = 2000

/** Whether the site is refusing automated visitors. Such a source is skipped, never worked around. */
export function looksLikeBotWall(status: number, html: string): boolean {
  if (BLOCKED_STATUSES.includes(status)) return true
  return MARKERS.test(html) && visibleText(html).length < SMALL_TEXT
}
