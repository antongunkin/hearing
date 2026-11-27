import { visibleText } from './html'

const BLOCKED_STATUSES = [403, 429, 503]

/**
 * Vendor fingerprints that only an anti-bot interstitial carries, wherever they sit in the markup:
 * Cloudflare (challenge / Turnstile), PerimeterX, DataDome, Akamai ("access denied") and Imperva/Incapsula.
 */
const CHALLENGE = /cf-challenge|cf-turnstile|challenge-platform|px-captcha|datadome|captcha-delivery|access denied|request unsuccessful\. incapsula/i

/**
 * A mounted, interactive CAPTCHA widget: reCAPTCHA v2's `g-recaptcha` or hCaptcha's `h-captcha` class. A page
 * whose only content is one of these is a challenge. The invisible reCAPTCHA v3 badge (`grecaptcha-badge`, no
 * hyphen) rides on ordinary pages behind a protected form and is not a challenge — the `[gh]-` dash excludes it.
 */
const CAPTCHA_WIDGET = /class\s*=\s*["'][^"']*\b[gh]-(?:re)?captcha\b/i

/**
 * Cloudflare injects its "JavaScript detections" probe on ordinary pages it proxies, not only on challenges,
 * so its script path is removed before the `challenge-platform` fingerprint is looked for.
 */
const JS_DETECTIONS = /challenge-platform\/scripts\/jsd\//gi

/** The Google disclosure every page behind invisible reCAPTCHA must show; benign, and often a page's only "captcha". */
const RECAPTCHA_BADGE = /protected by\s+reCAPTCHA/gi

/** A page with at least this much visible text is a real page, never a wall. */
const SMALL_TEXT = 2000

/**
 * Whether the site is refusing automated visitors. Such a source is skipped, never worked around.
 *
 * A blocked status is decisive. Otherwise a wall is a near-empty page (little visible text) that carries a
 * vendor challenge fingerprint, a mounted CAPTCHA widget, or a visible CAPTCHA prompt. The bare word "captcha"
 * in an attribute name, a config value, a hidden form field, a CSS class, or the reCAPTCHA badge disclosure is
 * not a wall: ordinary pages with a protected contact form carry all of these.
 */
export function looksLikeBotWall(status: number, html: string): boolean {
  if (BLOCKED_STATUSES.includes(status)) return true

  const text = visibleText(html)
  if (text.length >= SMALL_TEXT) return false

  const markup = html.replace(JS_DETECTIONS, '')
  const prompt = text.replace(RECAPTCHA_BADGE, '')
  return CHALLENGE.test(markup) || CAPTCHA_WIDGET.test(markup) || /captcha/i.test(prompt)
}
