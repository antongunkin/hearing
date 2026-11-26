import { JSDOM, VirtualConsole } from 'jsdom'

/** A document that does not name its type is read as HTML. */
export const isHtml = (contentType: string) => contentType === '' || /html/i.test(contentType)

const LINES = 'address, article, aside, br, caption, dd, div, dl, dt, figure, figcaption, footer, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, tr, ul'

/** The text a reader sees, one block element per line, so that quotes can be looked up in it. */
export function visibleText(html: string): string {
  // The silent console keeps CSS parse complaints out of the pipeline's output.
  const { document } = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window
  for (const element of document.querySelectorAll('script, style, noscript, template')) element.remove()
  for (const element of document.querySelectorAll('td, th')) element.after(' ')
  for (const element of document.querySelectorAll(LINES)) {
    element.before('\n')
    element.after('\n')
  }
  return (document.body?.textContent ?? '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n[ \n]*/g, '\n')
    .trim()
}

/** The parsed JSON-LD blocks of the page; a block that is not valid JSON is left out. */
export function jsonLd(html: string): unknown[] {
  const { document } = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window
  return [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((script): unknown[] => {
    try {
      return [JSON.parse(script.textContent ?? '')]
    } catch {
      return []
    }
  })
}

/** Absolute http(s) targets of the page's links, without fragments, in document order, each once. */
export function linksIn(html: string, baseUrl: string): string[] {
  const { document } = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window
  const links = new Set<string>()
  for (const anchor of document.querySelectorAll('a[href]')) {
    const url = URL.parse(anchor.getAttribute('href') ?? '', baseUrl)
    if (!url || !/^https?:$/.test(url.protocol)) continue
    url.hash = ''
    links.add(url.href)
  }
  return [...links]
}
