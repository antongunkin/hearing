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
