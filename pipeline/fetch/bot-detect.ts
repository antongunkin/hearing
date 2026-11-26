import { visibleText } from './html'

const BLOCKED_STATUSES = [403, 429, 503]
const MARKERS = /captcha|cf-challenge|challenge-platform|px-captcha|access denied|request unsuccessful\. incapsula/i
/**
 * Anti-bot code that ordinary pages carry without refusing anyone; its names contain the markers.
 * The patterns are bounded: pages hold long unbroken runs on which an open one takes minutes.
 */
const PASSIVE_EMBEDS = [
  /<script\b[^<>]*?\ssrc\s*=\s*["']?[^"'\s<>]*\/recaptcha\/(?:api|enterprise)\.js[^<>]*>/gi, // reCAPTCHA loader
  /challenge-platform\/scripts\/jsd\//gi, // Cloudflare JavaScript detections
  /captcha(?=[\w-]{0,40}?site[_-]?key)/gi, // config names such as recaptchaSiteKey
]
/** A page with less visible text than this is small. Real pages mention the markers too (a form's reCAPTCHA). */
const SMALL_TEXT = 2000

/** Whether the site is refusing automated visitors. Such a source is skipped, never worked around. */
export function looksLikeBotWall(status: number, html: string): boolean {
  if (BLOCKED_STATUSES.includes(status)) return true
  const markup = PASSIVE_EMBEDS.reduce((rest, embed) => rest.replace(embed, ''), html)
  return MARKERS.test(markup) && visibleText(html).length < SMALL_TEXT
}
