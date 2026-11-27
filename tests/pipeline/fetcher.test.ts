// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { config } from '@/pipeline/config'
import { looksLikeBotWall } from '@/pipeline/fetch/bot-detect'
import { fetchPage, type FetchResult } from '@/pipeline/fetch/fetcher'
import { readBody, readLog } from '@/pipeline/fetch/raw-store'

const launch = vi.hoisted(() => vi.fn())
vi.mock('playwright', () => ({ chromium: { launch } }))

const fixture = (name: string) => readFile(fileURLToPath(new URL(`../fixtures/pages/${name}`, import.meta.url)))

const delays = { minDelayMs: config.minDelayMs, maxDelayMs: config.maxDelayMs }
const archive = { archiveHosts: config.archiveHosts, archiveDelayMs: config.archiveDelayMs }
const home = process.cwd()

// The cache and the blocklist are relative to the working directory.
let cwd: string
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'fetcher-'))
  process.chdir(cwd)
})
afterAll(async () => {
  process.chdir(home)
  await rm(cwd, { recursive: true, force: true })
})

const servers: Server[] = []
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://hearing.test/')
  Object.assign(config, { minDelayMs: 0, maxDelayMs: 0 })
})
afterEach(async () => {
  Object.assign(config, delays, archive)
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  launch.mockReset()
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    }),
  )
})

type Route = { status?: number; type?: string; headers?: Record<string, string>; body?: string | Buffer } | 'hang-up'

/** A local site. Unlisted paths, `/robots.txt` included, answer 404. */
async function serve(routes: Record<string, Route>) {
  const hits: { path: string; userAgent: string }[] = []
  const handler: RequestListener = (request, response) => {
    hits.push({ path: request.url!, userAgent: request.headers['user-agent'] ?? '' })
    const route = routes[request.url!] ?? { status: 404, body: 'Not found' }
    if (route === 'hang-up') return void request.socket.destroy()
    response.writeHead(route.status ?? 200, { 'content-type': route.type ?? 'text/html', ...route.headers })
    response.end(route.body ?? '')
  }
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { origin: `http://127.0.0.1:${port}`, port, hits, paths: () => hits.map((hit) => hit.path) }
}

const robots = (body: string): Route => ({ type: 'text/plain', body })
const page = (body: string): Route => ({ body: `<!doctype html><html><body>${body}</body></html>` })
const get = (url: string, opts: Parameters<typeof fetchPage>[1] = {}) => fetchPage(url, { blocklist: [], ...opts })

function ok(result: FetchResult) {
  if (result.status !== 'ok') throw new Error(`skipped: ${result.reason} ${result.detail}`)
  return result
}

describe('robots.txt', () => {
  test('robots disallow → skipped/robots, no request made', async () => {
    const site = await serve({
      '/robots.txt': robots('User-agent: *\nDisallow: /private'),
      '/private/a': page('secret'),
    })

    const result = await get(`${site.origin}/private/a`)

    expect(result).toMatchObject({ status: 'skipped', reason: 'robots', url: `${site.origin}/private/a` })
    expect(site.paths()).toEqual(['/robots.txt'])
  })

  test('404 allows, and the file is read once per host', async () => {
    const site = await serve({ '/a': page('a'), '/b': page('b') })

    expect(ok(await get(`${site.origin}/a`)).text).toBe('a')
    expect(ok(await get(`${site.origin}/b`)).text).toBe('b')
    expect(site.paths()).toEqual(['/robots.txt', '/a', '/b'])
  })

  test.each([
    ['a server error', { status: 503 } as Route],
    ['a refusal', { status: 403 } as Route],
    ['a network error', 'hang-up' as Route],
  ])('%s disallows', async (_name, route) => {
    const site = await serve({ '/robots.txt': route, '/a': page('a') })

    expect(await get(`${site.origin}/a`)).toMatchObject({ status: 'skipped', reason: 'robots' })
    expect(site.paths()).not.toContain('/a')
  })
})

describe('blocklist', () => {
  test('blocklisted domain → skipped/blocklist', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const blocklist = ['example.com']

    for (const url of ['https://example.com/a', 'https://shop.Example.com./a']) {
      expect(await get(url, { blocklist })).toMatchObject({ status: 'skipped', reason: 'blocklist', url })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  test('an entry does not match a domain that only ends with the same letters', async () => {
    vi.stubGlobal('fetch', async () => new Response('<p>fine</p>', { headers: { 'content-type': 'text/html' } }))

    expect(await get('https://example.com/letters', { blocklist: ['ample.com'] })).toMatchObject({ status: 'ok' })
  })

  test('Google and Amazon are never fetched, whatever the list says', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    for (const url of ['https://play.google.com/store/apps', 'https://www.amazon.com/dp/B0']) {
      expect(await get(url)).toMatchObject({ status: 'skipped', reason: 'blocklist' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  test('without the option data/blocklist.json is read, and a missing file fails closed', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(fetchPage('https://listed.test/a')).rejects.toThrow(/blocklist\.json/)

    await mkdir('data', { recursive: true })
    await writeFile('data/blocklist.json', '["listed.test"]')
    expect(await fetchPage('https://listed.test/a')).toMatchObject({ status: 'skipped', reason: 'blocklist' })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('a redirect to a blocklisted domain is not followed', async () => {
    const target = await serve({ '/a': page('a') })
    const site = await serve({ '/go': { status: 302, headers: { location: `http://localhost:${target.port}/a` } } })

    const result = await get(`${site.origin}/go`, { blocklist: ['localhost'] })

    expect(result).toMatchObject({ status: 'skipped', reason: 'blocklist', url: `${site.origin}/go` })
    expect(target.hits).toEqual([])
  })

  test('a redirect is followed and checked against robots.txt', async () => {
    const site = await serve({
      '/robots.txt': robots('User-agent: *\nDisallow: /private'),
      '/go': { status: 301, headers: { location: '/a' } },
      '/sneaky': { status: 302, headers: { location: '/private/a' } },
      '/a': page('moved here'),
      '/private/a': page('secret'),
    })

    expect(ok(await get(`${site.origin}/go`))).toMatchObject({ url: `${site.origin}/a`, text: 'moved here' })
    expect(await get(`${site.origin}/sneaky`)).toMatchObject({ status: 'skipped', reason: 'robots' })
    expect(site.paths()).not.toContain('/private/a')
  })

  test('only http and https are fetched', async () => {
    expect(await get('file:///etc/hosts')).toMatchObject({ status: 'skipped', reason: 'http-error' })
  })
})

describe('results', () => {
  test('a page gives readable text, its html, a hash and a time', async () => {
    const html =
      '<!doctype html><title>t</title><style>p{}</style><h1>Specs</h1><script>var x = 1</script>' +
      '<table><tr><td>Weight</td><td>2.1&nbsp;g</td></tr></table><p>Rated IP68 &amp; more</p>'
    const site = await serve({ '/a': { body: html } })

    const result = ok(await get(`${site.origin}/a`))

    expect(result.text).toBe('Specs\nWeight 2.1 g\nRated IP68 & more')
    expect(result.html).toBe(html)
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(new Date(result.fetchedAt).toISOString()).toBe(result.fetchedAt)
  })

  test('200 captcha page → skipped/bot-protection', async () => {
    const site = await serve({ '/a': { body: await fixture('captcha-200.html') } })

    expect(await get(`${site.origin}/a`)).toMatchObject({ status: 'skipped', reason: 'bot-protection' })
  })

  test('a challenge page → skipped/bot-protection and is not cached', async () => {
    const site = await serve({ '/a': { status: 403, body: await fixture('cf-challenge.html') } })

    for (let i = 0; i < 2; i++) {
      expect(await get(`${site.origin}/a`)).toMatchObject({ status: 'skipped', reason: 'bot-protection' })
    }
    expect(site.paths().filter((path) => path === '/a')).toHaveLength(2)
  })

  test('other failures → skipped/http-error', async () => {
    const site = await serve({ '/down': 'hang-up' })

    expect(await get(`${site.origin}/missing`)).toMatchObject({ reason: 'http-error', detail: 'HTTP 404' })
    expect(await get(`${site.origin}/down`)).toMatchObject({ status: 'skipped', reason: 'http-error' })
  })

  test('a redirect to nonsense → skipped/http-error', async () => {
    const site = await serve({ '/go': { status: 302, headers: { location: 'http://[' } } })

    expect(await get(`${site.origin}/go`)).toMatchObject({ status: 'skipped', reason: 'http-error' })
  })

  test('a redirect loop ends', async () => {
    const site = await serve({ '/loop': { status: 302, headers: { location: '/loop' } } })

    expect(await get(`${site.origin}/loop`)).toMatchObject({ status: 'skipped', reason: 'http-error' })
    expect(site.paths().length).toBeLessThan(10)
  })

  test('pdf datasheet → extracted text contains "Weight"', async () => {
    const site = await serve({ '/d.pdf': { type: 'application/pdf', body: await fixture('datasheet.pdf') } })

    const result = ok(await get(`${site.origin}/d.pdf`))

    expect(result.text).toContain('Weight')
    expect(result.html).toBeUndefined()
  })

  test('a broken pdf → skipped/http-error', async () => {
    const site = await serve({ '/d.pdf': { type: 'application/pdf', body: 'not a pdf' } })

    expect(await get(`${site.origin}/d.pdf`)).toMatchObject({ status: 'skipped', reason: 'http-error' })
  })

  test('the cache answers until refresh, and never for a domain blocked since', async () => {
    const routes: Record<string, Route> = { '/a': page('first') }
    const site = await serve(routes)
    const url = `${site.origin}/a`
    const first = ok(await get(url))
    routes['/a'] = page('second')

    expect(await get(url)).toEqual(first)
    expect(site.paths()).toEqual(['/robots.txt', '/a'])
    expect(await get(url, { blocklist: ['127.0.0.1'] })).toMatchObject({ reason: 'blocklist' })
    expect(ok(await get(url, { refresh: true })).text).toBe('second')
    expect(ok(await get(url)).text).toBe('second')
  })
})

describe('rate limits', () => {
  test('a 429 is skipped as rate-limited and logged so', async () => {
    const site = await serve({ '/busy': { status: 429, body: 'slow down' } })
    expect(await get(`${site.origin}/busy`)).toMatchObject({ status: 'skipped', reason: 'rate-limited', detail: 'HTTP 429' })
    expect((await readLog()).at(-1)).toMatchObject({ status: 429, skipped: 'rate-limited' })
  })
})

describe('looksLikeBotWall', () => {
  const small = (body: string) => `<html><body>${body}</body></html>`
  const article = `<p>${'Hearing aid specifications. '.repeat(100)}</p>`

  test.each([403, 429, 503])('status %i', (status) => {
    expect(looksLikeBotWall(status, small(article))).toBe(true)
  })

  test.each(['captcha', 'cf-challenge', 'challenge-platform', 'px-captcha', 'Access Denied', 'Request unsuccessful. Incapsula'])(
    'marker "%s" in a small document',
    (marker) => {
      expect(looksLikeBotWall(200, small(`<div class="${marker}">${marker}</div>`))).toBe(true)
    },
  )

  const widget = '<div class="g-recaptcha" data-sitekey="k"></div>'
  const shell = '<div id="root"></div>'
  const loader = '<script src="https://www.google.com/recaptcha/api.js?render=k" async></script>'

  test('a marker on a full page is not a wall, and script text does not count as page text', () => {
    expect(looksLikeBotWall(200, small(article + widget))).toBe(false)
    expect(looksLikeBotWall(200, small(`${widget}<script>${'x();'.repeat(1000)}</script>`))).toBe(true)
  })

  test('a thin product page that only loads reCAPTCHA is not a wall', () => {
    expect(looksLikeBotWall(200, small(`<p>${'x'.repeat(1500)}</p>${loader}`))).toBe(false)
  })

  test.each([
    ['the reCAPTCHA loader', loader],
    ['the Enterprise loader', "<script data-sitekey='k' src='https://www.recaptcha.net/recaptcha/enterprise.js?onload=onRecaptcha'></script>"],
    ['Cloudflare JS detections', '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'],
    ['inline JS detections', "<script>a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';</script>"],
    ['a site key in config', '<script>window.env={"recaptchaSiteKey":"k"}</script>'],
    ['site keys in other spellings', '<script>var RECAPTCHA_SITE_KEY="k", reCaptchaEnterpriseSiteKey="k"</script>'],
  ])('an app shell with %s is not a wall', (_name, embed) => {
    expect(looksLikeBotWall(200, small(shell + embed))).toBe(false)
  })

  test.each([
    ['a reCAPTCHA widget', widget + loader],
    ['an hCaptcha widget', '<div class="h-captcha" data-sitekey="k"></div>'],
    ['visible captcha text', `<p>Complete the CAPTCHA</p>${loader}`],
    ['another challenge-platform script', '<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'],
  ])('an app shell with %s is a wall', (_name, content) => {
    expect(looksLikeBotWall(200, small(shell + content))).toBe(true)
  })

  test('long unbroken markup is checked quickly', () => {
    const pages = ['a'.repeat(100_000), 'captcha'.repeat(15_000), '<script '.repeat(20_000)]
    const started = performance.now()

    for (const blob of pages) looksLikeBotWall(200, small(`<p>${'x'.repeat(2000)}</p><script>${blob}</script>`))

    expect(performance.now() - started).toBeLessThan(2000)
  })

  test.each(['captcha-200.html', 'cf-challenge.html'])('%s is a wall at status 200', async (name) => {
    expect(looksLikeBotWall(200, (await fixture(name)).toString())).toBe(true)
  })

  test('an ordinary small page is not a wall', () => {
    expect(looksLikeBotWall(200, small('<p>Hello</p>'))).toBe(false)
    expect(looksLikeBotWall(404, small('<p>Not found</p>'))).toBe(false)
  })
})

describe('politeness', () => {
  /** A stubbed host on fake timers, with the real delays and the shortest random pause. */
  function fakeHost(robotsTxt?: string) {
    Object.assign(config, delays)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const requests: { path: string; at: number }[] = []
    vi.stubGlobal('fetch', async (input: URL) => {
      requests.push({ path: input.pathname, at: Date.now() })
      const isRobots = input.pathname === '/robots.txt'
      return new Response(isRobots ? (robotsTxt ?? '') : '<p>fine</p>', {
        status: isRobots && robotsTxt === undefined ? 404 : 200,
        headers: { 'content-type': 'text/html' },
      })
    })
    return requests
  }

  async function twoPages(host: string) {
    const both = Promise.all([
      get(`https://${host}/a`, { refresh: true }),
      get(`https://${host}/b`, { refresh: true }),
    ])
    // Storing the bodies is real file I/O, so the pauses are timed out one at a time as they are set.
    let settled = false
    void both.then(() => (settled = true))
    while (!settled) {
      if (vi.getTimerCount() > 0) await vi.advanceTimersToNextTimerAsync()
      await new Promise((resolve) => setImmediate(resolve))
    }
    await both
  }

  const gaps = (requests: { at: number }[]) => requests.slice(1).map((request, i) => request.at - requests[i].at)

  test('two requests to same host are ≥2000ms apart', async () => {
    const requests = fakeHost()

    await twoPages('polite.test')

    expect(requests.map((request) => request.path)).toEqual(['/robots.txt', '/a', '/b'])
    for (const gap of gaps(requests)) expect(gap).toBeGreaterThanOrEqual(2000)
  })

  test('requests to an archive host are at least archiveDelayMs apart', async () => {
    const requests = fakeHost()
    Object.assign(config, { archiveHosts: ['polite-archive.test'], archiveDelayMs: 4000 })

    await twoPages('polite-archive.test')

    expect(gaps(requests)).toEqual([4000, 4000])
  })

  test.each([
    ['longer than the pause wins', 10, 10_000],
    ['shorter than the pause does not shorten it', 1, 2000],
  ])('a Crawl-delay for us %s', async (_name, seconds, expected) => {
    const requests = fakeHost(
      `User-agent: HearingDBBot\nCrawl-delay: 25\n\nUser-agent: *\nCrawl-delay: ${seconds}`,
    )

    await twoPages(`crawl-${seconds}.test`)

    expect(gaps(requests)).toEqual([expected, expected])
  })

  test('an absurd Crawl-delay does not overflow into no pause', async () => {
    const requests = fakeHost('User-agent: *\nCrawl-delay: 1000000000')

    void get('https://never.test/a', { refresh: true })
    await vi.advanceTimersByTimeAsync(30_000)

    expect(requests.map((request) => request.path)).toEqual(['/robots.txt'])
  })

  test('our code sets no User-Agent header; nothing browser-like goes out', async () => {
    const site = await serve({ '/a': page('a') })

    await get(`${site.origin}/a`)

    const agents = site.hits.map((hit) => hit.userAgent)
    expect(agents).toHaveLength(2)
    for (const agent of agents) {
      expect(agent).not.toMatch(/mozilla|chrome|safari|hearingdbbot/i)
    }
    for (const file of ['fetcher.ts', 'render.ts', 'robots.ts']) {
      expect(await readFile(join(home, 'pipeline/fetch', file), 'utf8')).not.toMatch(/user-?agent|mozilla|chrome\//i)
    }
  })

  test('robots.txt applies the * group, not a product token', async () => {
    const site = await serve({
      '/robots.txt': robots('User-agent: HearingDBBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private'),
      '/ok': page('ok'),
      '/private/a': page('secret'),
    })

    expect(await get(`${site.origin}/ok`)).toMatchObject({ status: 'ok' })
    expect(await get(`${site.origin}/private/a`)).toMatchObject({ status: 'skipped', reason: 'robots' })
  })
})

describe('render', () => {
  type Document = { status?: number; type?: string; location?: string; body?: string }

  /**
   * Stands in for Chromium: asks the route handler about the document, then about each further request,
   * as the browser does while the page loads.
   */
  function stubBrowser(document: Document, rendered: string, further: { url: string; navigation?: boolean }[] = []) {
    const seen: { url: string; outcome: string }[] = []
    const ran = vi.fn()
    const close = vi.fn()
    const navigated = vi.fn()
    let handler: (route: unknown) => Promise<void>
    let contextOptions: unknown

    async function request(url: string, navigation: boolean) {
      let outcome = ''
      await handler({
        request: () => ({ url: () => url, isNavigationRequest: () => navigation }),
        abort: async () => void (outcome = 'abort'),
        continue: async () => void (outcome = 'continue'),
        fulfill: async () => void (outcome = 'fulfill'),
        fetch: async () => {
          const status = document.status ?? 200
          const headers: Record<string, string> = { 'content-type': document.type ?? 'text/html' }
          if (document.location) headers.location = document.location
          return {
            status: () => status,
            ok: () => status >= 200 && status < 300,
            headers: () => headers,
            body: async () => Buffer.from(document.body ?? '<html><body>as sent</body></html>'),
          }
        },
      })
      seen.push({ url, outcome })
      return outcome
    }

    launch.mockResolvedValue({
      close,
      newContext: async (options: unknown) => {
        contextOptions = options
        return {
          route: async (_pattern: string, given: typeof handler) => void (handler = given),
          newPage: async () => ({
            goto: async (url: string, options: unknown) => {
              navigated(options)
              if ((await request(url, true)) !== 'fulfill') throw new Error('net::ERR_ABORTED')
              ran()
              for (const next of further) await request(next.url, next.navigation ?? false)
            },
            waitForLoadState: async () => {},
            content: async () => rendered,
          }),
        }
      },
    })
    return { seen, ran, close, navigated, options: () => contextOptions }
  }

  test('returns the page as it stands after scripts ran', async () => {
    const site = await serve({})
    const browser = stubBrowser({}, '<html><body><p>Weight 2.1 g</p></body></html>')

    const result = ok(await get(`${site.origin}/app`, { render: true }))

    expect(result.text).toBe('Weight 2.1 g')
    expect(browser.options()).toMatchObject({ serviceWorkers: 'block' })
    expect(browser.options()).not.toHaveProperty('userAgent')
    expect(browser.close).toHaveBeenCalled()
    // Waiting for "load" hangs in Chromium when the refused navigation came from a script during it.
    expect(browser.navigated).toHaveBeenCalledWith({ waitUntil: 'commit' })
  })

  test('the page may not reach blocked or disallowed addresses, or navigate again', async () => {
    const site = await serve({ '/robots.txt': robots('User-agent: *\nDisallow: /private') })
    const browser = stubBrowser({}, '<p>done</p>', [
      { url: `${site.origin}/app.js` },
      { url: `${site.origin}/private/api` },
      { url: 'https://tracker.blocked.test/t.js' },
      { url: 'https://cdn.test/lib.js' },
      { url: `${site.origin}/app`, navigation: true },
    ])

    await get(`${site.origin}/app`, { render: true, blocklist: ['blocked.test'] })

    expect(browser.seen.map((request) => request.outcome)).toEqual([
      'fulfill', 'continue', 'abort', 'abort', 'continue', 'abort',
    ])
  })

  test('a challenge status is reported without running the page', async () => {
    const site = await serve({})
    const browser = stubBrowser({ status: 503 }, '<p>solved</p>')

    expect(await get(`${site.origin}/app`, { render: true })).toMatchObject({ reason: 'bot-protection' })
    expect(browser.ran).not.toHaveBeenCalled()
  })

  test('a bot wall as the first response is not run, even if it would clear by itself', async () => {
    const site = await serve({})
    const challenge = (await fixture('cf-challenge.html')).toString()
    const browser = stubBrowser({ body: challenge }, '<html><body><p>Weight 2.1 g</p></body></html>')

    expect(await get(`${site.origin}/app`, { render: true })).toMatchObject({
      status: 'skipped',
      reason: 'bot-protection',
    })
    expect(browser.ran).not.toHaveBeenCalled()
  })

  test('an app shell with passive anti-bot scripts is rendered', async () => {
    const site = await serve({})
    const shell =
      '<div id="root"></div><script src="https://www.google.com/recaptcha/api.js"></script>' +
      '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'
    stubBrowser({ body: shell }, '<html><body><p>Weight 2.1 g</p></body></html>')

    expect(ok(await get(`${site.origin}/app`, { render: true })).text).toBe('Weight 2.1 g')
  })

  test('a redirect goes through the same checks', async () => {
    const site = await serve({})
    stubBrowser({ status: 302, location: 'https://www.amazon.com/dp/B0' }, '<p>never</p>')

    expect(await get(`${site.origin}/app`, { render: true })).toMatchObject({ reason: 'blocklist' })
    expect(launch).toHaveBeenCalledTimes(1)
  })

  test('a browser that cannot start is an error, not a skipped source', async () => {
    const site = await serve({})
    launch.mockRejectedValue(new Error("Executable doesn't exist"))

    await expect(get(`${site.origin}/app`, { render: true })).rejects.toThrow(/playwright install chromium/)
  })

  test('a plain cached copy does not answer a render request', async () => {
    const site = await serve({ '/app': page('loading') })
    await get(`${site.origin}/app`)
    stubBrowser({}, '<p>rendered</p>')

    expect(ok(await get(`${site.origin}/app`, { render: true })).text).toBe('rendered')
    expect(ok(await get(`${site.origin}/app`)).text).toBe('rendered')
    expect(launch).toHaveBeenCalledTimes(1)
  })
})

describe('raw store and fetch log', () => {
  const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
  const logged = async (url: string) => (await readLog('.cache/raw')).filter((e) => e.url === url)

  test('two refreshed fetches of an unchanged page: two log lines, one body', async () => {
    const site = await serve({ '/same': page('same') })
    const url = `${site.origin}/same`

    await get(url, { refresh: true })
    await get(url, { refresh: true })

    const lines = await logged(url)
    expect(lines).toHaveLength(2)
    expect(new Set(lines.map((e) => e.bodyHash)).size).toBe(1)
  })

  test('a changed page keeps the earlier body', async () => {
    const routes: Record<string, Route> = { '/change': page('one') }
    const site = await serve(routes)
    const url = `${site.origin}/change`

    await get(url, { refresh: true })
    routes['/change'] = page('two')
    await get(url, { refresh: true })

    const hashes = (await logged(url)).map((e) => e.bodyHash!)
    expect(new Set(hashes).size).toBe(2)
    const files = await readdir('.cache/raw')
    for (const hash of hashes) expect(files).toContain(hash)
  })

  test('a redirect chain is one line; the 3xx body is not stored', async () => {
    const redirectBody = 'moved, see the new place'
    const site = await serve({
      '/old': { status: 301, headers: { location: '/new' }, body: redirectBody },
      '/new': page('new'),
    })

    await get(`${site.origin}/old`)

    const lines = await logged(`${site.origin}/old`)
    expect(lines).toHaveLength(1)
    expect(lines[0].redirects).toEqual([{ url: `${site.origin}/old`, status: 301 }])
    expect(lines[0].finalUrl).toBe(`${site.origin}/new`)
    expect(await readdir('.cache/raw')).not.toContain(sha256(redirectBody))
  })

  test('robots.txt requests and refusals are logged with their reason', async () => {
    const wall = await fixture('captcha-200.html')
    const site = await serve({
      '/robots.txt': robots('User-agent: *\nDisallow: /private'),
      '/private/a': page('secret'),
      '/wall': { body: wall },
    })
    const disallowed = `${site.origin}/private/a`
    const blocked = 'https://blocked.test/a'
    const walled = `${site.origin}/wall`

    await get(disallowed)
    await get(blocked, { blocklist: ['blocked.test'] })
    await get(walled)

    const log = await readLog('.cache/raw')
    expect(log.find((e) => e.url === `${site.origin}/robots.txt`)?.status).toBe(200)
    expect(log.find((e) => e.url === disallowed)).toMatchObject({ skipped: 'robots' })
    expect(log.find((e) => e.url === disallowed)?.status).toBeUndefined()
    expect(log.find((e) => e.url === blocked)).toMatchObject({ skipped: 'blocklist' })
    expect(log.find((e) => e.url === walled)).toMatchObject({ skipped: 'bot-protection', status: 200 })
  })

  test('an HTTP error is logged with its status', async () => {
    const site = await serve({})
    await get(`${site.origin}/gone`)
    expect((await logged(`${site.origin}/gone`))[0]).toMatchObject({ status: 404, skipped: 'http-error' })
  })

  test('a PDF is stored as its bytes', async () => {
    const site = await serve({ '/d.pdf': { type: 'application/pdf', body: await fixture('datasheet.pdf') } })

    const result = ok(await get(`${site.origin}/d.pdf`))

    expect(await readBody(result.bodyHash!)).toEqual(new Uint8Array(await fixture('datasheet.pdf')))
    expect(result.contentType).toBe('application/pdf')
  })

  test('the result carries the fetchedAt and bodyHash of its log line', async () => {
    const site = await serve({ '/line': page('line') })

    const result = ok(await get(`${site.origin}/line`))

    const [line] = await logged(`${site.origin}/line`)
    expect(line).toMatchObject({ fetchedAt: result.fetchedAt, bodyHash: result.bodyHash, via: 'live', rendered: false })
  })

  test('a cached copy from before the log is not used', async () => {
    const site = await serve({ '/old-cache': page('fresh') })
    const url = `${site.origin}/old-cache`
    const result = { status: 'ok', url, text: 'stale', contentHash: '0'.repeat(64), fetchedAt: '2020-01-01T00:00:00.000Z' }
    await mkdir('.cache/pages', { recursive: true })
    await writeFile(`.cache/pages/${sha256(url)}.json`, JSON.stringify({ rendered: false, result }))

    expect(ok(await get(url)).text).toBe('fresh')
    expect(site.paths().filter((path) => path === '/old-cache')).toHaveLength(1)
  })

  test('a rendered page is stored as rendered HTML with rendered: true', async () => {
    const site = await serve({})
    const rendered = '<html><body><p>Weight 2.1 g</p></body></html>'
    launch.mockResolvedValue({
      close: vi.fn(),
      newContext: async () => {
        let handler: (route: unknown) => Promise<void>
        return {
          route: async (_pattern: string, given: typeof handler) => void (handler = given),
          newPage: async () => ({
            goto: async () => {
              await handler({
                request: () => ({ url: () => `${site.origin}/spa`, isNavigationRequest: () => true }),
                abort: async () => {},
                fulfill: async () => {},
                fetch: async () => ({
                  status: () => 200,
                  ok: () => true,
                  headers: () => ({ 'content-type': 'text/html' }),
                  body: async () => Buffer.from('<html><body>shell</body></html>'),
                }),
              })
            },
            waitForLoadState: async () => {},
            content: async () => rendered,
          }),
        }
      },
    })

    const result = ok(await get(`${site.origin}/spa`, { render: true }))

    const [line] = await logged(`${site.origin}/spa`)
    expect(line).toMatchObject({ rendered: true, bodyHash: sha256(rendered) })
    expect(result.bodyHash).toBe(sha256(rendered))
    expect(new TextDecoder().decode(await readBody(result.bodyHash!))).toBe(rendered)
  })
})
