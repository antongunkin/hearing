import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { looksLikeBotWall } from './bot-detect'
import type { Reply } from './fetcher'
import { isHtml } from './html'

const IDLE_TIMEOUT_MS = 10_000

export class BrowserLaunchError extends Error {
  constructor(cause: unknown) {
    super(`Obscura did not start (install from https://github.com/h4ckf0r0day/obscura): ${(cause as Error).message}`, { cause })
    this.name = 'BrowserLaunchError'
  }
}

let serverEndpoint: Promise<string> | undefined

function waitForPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5_000
    const tryConnect = () => {
      const socket = createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => { socket.destroy(); resolve() })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() >= deadline) reject(new Error(`port ${port} did not open within 5s`))
        else setTimeout(tryConnect, 100)
      })
    }
    tryConnect()
  })
}

async function startServer(): Promise<string> {
  const port = 9222
  const proc = spawn('obscura', ['serve', '--port', String(port)], { stdio: 'ignore' })
  const spawnFailed = new Promise<never>((_, reject) => proc.once('error', reject))
  try {
    await Promise.race([waitForPort(port), spawnFailed])
  } catch (cause) {
    proc.kill()
    throw cause
  }
  proc.once('exit', () => { serverEndpoint = undefined })
  process.once('exit', () => proc.kill())
  return `ws://127.0.0.1:${port}`
}

function getEndpoint(): Promise<string> {
  if (process.env.OBSCURA_ENDPOINT) return Promise.resolve(process.env.OBSCURA_ENDPOINT)
  return (serverEndpoint ??= startServer().catch((err: unknown) => {
    serverEndpoint = undefined
    throw err
  }))
}

/**
 * Loads one URL in headless Obscura. Only a successful HTML document that is no bot wall runs, and
 * comes back as it stands after its scripts. Anything else (a redirect, an error status, a challenge, a
 * PDF) comes back as received, so that the caller applies its checks to it. `allows` filters what the page itself requests.
 */
export async function renderPage(url: URL, allows: (url: URL) => boolean): Promise<Reply> {
  const endpoint = await getEndpoint().catch((cause: unknown) => {
    throw new BrowserLaunchError(cause)
  })
  const { chromium } = await import('playwright')
  const browser = await chromium.connectOverCDP(endpoint).catch((cause: unknown) => {
    throw new BrowserLaunchError(cause)
  })
  let context: import('playwright').BrowserContext | undefined
  try {
    context = await browser.newContext({ serviceWorkers: 'block' })
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
        // A challenge is not run even when it would clear by itself: that would be getting past it.
        runs =
          response.ok() &&
          isHtml(reply.contentType) &&
          !looksLikeBotWall(reply.status, new TextDecoder().decode(reply.body))
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
    return { ...reply!, contentType: 'text/html', body: new TextEncoder().encode(await page.content()), rendered: true }
  } finally {
    await context?.close().catch(() => {})
    await browser.disconnect()
  }
}
