import { config } from '@/pipeline/config'
import type { Reply } from './fetcher'
import { isHtml } from './html'

const IDLE_TIMEOUT_MS = 10_000

export class BrowserLaunchError extends Error {
  constructor(cause: unknown) {
    super(`Chromium did not start (npx playwright install chromium): ${(cause as Error).message}`, { cause })
    this.name = 'BrowserLaunchError'
  }
}

/**
 * Loads one URL in headless Chromium. Only a successful HTML document runs, and comes back as it stands
 * after its scripts. Anything else (a redirect, an error or challenge status, a PDF) comes back as
 * received, so that the caller applies its checks to it. `allows` filters what the page itself requests.
 */
export async function renderPage(url: URL, allows: (url: URL) => boolean): Promise<Reply> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch().catch((cause: unknown) => {
    throw new BrowserLaunchError(cause)
  })
  try {
    const context = await browser.newContext({ userAgent: config.userAgent, serviceWorkers: 'block' })
    let requested = false
    let reply: Reply | undefined
    let runs = false

    await context.route('**/*', async (route) => {
      const request = route.request()
      if (!request.isNavigationRequest()) {
        return allows(new URL(request.url())) ? route.continue() : route.abort()
      }
      // Only the document itself. A reload or redirect started by a script (which is how a script
      // challenge gets its second try), a frame and a popup are all refused.
      if (requested) return route.abort('aborted')
      requested = true
      try {
        const response = await route.fetch({ maxRedirects: 0 })
        const headers = response.headers()
        reply = {
          status: response.status(),
          contentType: headers['content-type'] ?? '',
          location: headers.location ?? null,
          body: await response.body(),
        }
        runs = response.ok() && isHtml(reply.contentType)
        return runs ? route.fulfill({ response }) : route.abort('aborted')
      } catch {
        return route.abort('failed')
      }
    })

    const page = await context.newPage()
    try {
      await page.goto(url.href, { waitUntil: 'commit' })
    } catch (error) {
      if (reply && !runs) return reply
      throw error
    }
    // Pages that keep polling never go idle: take what is there after the timeout.
    await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT_MS }).catch(() => {})
    return { ...reply!, contentType: 'text/html', body: new TextEncoder().encode(await page.content()) }
  } finally {
    await browser.close()
  }
}
