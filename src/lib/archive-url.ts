// Web Archive URLs of archived copies. Client-safe: the site labels archived sources with these.

const ARCHIVE = 'https://web.archive.org'
/** The Web Archive's host: never a brand's own site. */
export const ARCHIVE_HOST = 'web.archive.org'
const ARCHIVE_URL = /^https?:\/\/web\.archive\.org\/web\/(\d{4,14})(id_|if_|im_)?\/(.+)$/

/** The copy of `original` taken at `timestamp`; `raw` asks for the page as it was served, without the archive's frame. */
export function archiveUrl(timestamp: string, original: string, opts: { raw?: boolean } = {}): string {
  return `${ARCHIVE}/web/${timestamp}${opts.raw ? 'id_' : ''}/${original}`
}

/** Reads a Web Archive copy URL; a missing scheme in the original is taken as http://. */
export function parseArchiveUrl(url: string): { timestamp: string; original: string; raw: boolean } | null {
  const match = ARCHIVE_URL.exec(url)
  if (!match) return null
  const [, timestamp, flag, rest] = match
  const original = /^https?:\/\//.test(rest) ? rest : `http://${rest}`
  return { timestamp, original, raw: flag !== undefined }
}

/** The same copy as `url` without the `id_` flag: the form a site links to. */
export function citableArchiveUrl(url: string): string {
  return url.replace(/(\/web\/\d{4,14})id_\//, '$1/')
}

/** `YYYY-MM` of a Web Archive timestamp; a year alone is read as January. */
export function archiveMonth(timestamp: string): string {
  return `${timestamp.slice(0, 4)}-${timestamp.length >= 6 ? timestamp.slice(4, 6) : '01'}`
}

/** The archive's calendar of every copy of `original`. */
export function archiveCalendarUrl(original: string): string {
  return `${ARCHIVE}/web/*/${original}`
}

/** `url` as the original it is a copy of; a URL that is not a Web Archive copy is returned as it is. */
export function originalUrl(url: string): string {
  return parseArchiveUrl(url)?.original ?? url
}

/** True for any URL on the Web Archive's host, a copy URL or not. */
export function isArchiveHostUrl(url: string): boolean {
  return URL.parse(url)?.hostname.toLowerCase() === ARCHIVE_HOST
}
