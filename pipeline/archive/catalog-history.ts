// Earlier copies of a brand's catalog pages, read back from the fetch log: what the maker listed in past runs.
import { createHash } from 'node:crypto'
import type { FetchResult } from '@/pipeline/fetch/fetcher'
import { visibleText } from '@/pipeline/fetch/html'
import { RAW_DIR, readBody, readLog } from '@/pipeline/fetch/raw-store'
import { parseArchiveUrl } from '@/src/lib/archive-url'

type OkPage = Extract<FetchResult, { status: 'ok' }>

/**
 * The log's answered fetches of `urls` (live pages, and Web Archive copies of them) made before `before`, newest
 * first, as pages: `visibleText` of the stored body, `url` the address that answered. An entry whose body is
 * no longer kept is left out.
 */
export async function priorCatalogCopies(urls: string[], before: string, dir = RAW_DIR): Promise<OkPage[]> {
  const wanted = new Set(urls)
  const entries = (await readLog(dir))
    .filter((e) => {
      if (e.skipped || e.bodyHash === undefined || e.status === undefined || e.status < 200 || e.status > 299) return false
      if (Date.parse(e.fetchedAt) >= Date.parse(before)) return false
      const answered = e.finalUrl ?? e.url
      return wanted.has(e.url) || wanted.has(answered) || wanted.has(parseArchiveUrl(answered)?.original ?? '')
    })
    .sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))

  const pages: OkPage[] = []
  for (const e of entries) {
    let body: Uint8Array
    try {
      body = await readBody(e.bodyHash!, dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const html = new TextDecoder().decode(body)
    const text = /html/i.test(e.contentType ?? 'text/html') ? visibleText(html) : html
    pages.push({
      status: 'ok',
      url: e.finalUrl ?? e.url,
      text,
      html,
      contentHash: createHash('sha256').update(text).digest('hex'),
      fetchedAt: e.fetchedAt,
      bodyHash: e.bodyHash,
      ...(e.contentType !== undefined && { contentType: e.contentType }),
    })
  }
  return pages
}
