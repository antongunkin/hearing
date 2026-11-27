// Official manuals and datasheets of a model: which PDFs are documents of it, and what replaces a dead link.
import { namesModel } from '@/pipeline/archive/lifecycle'
import { fetchPage } from '@/pipeline/fetch/fetcher'
import { latestCopy } from '@/pipeline/sources/wayback'
import { archiveUrl, citableArchiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import type { Brand } from '@/src/lib/schema/brand'
import type { Model, ModelDocument } from '@/src/lib/schema/model'
import type { CandidateChange, CheckResult } from '@/src/lib/schema/pending'

type Named = Pick<Model, 'brand' | 'name' | 'aliases'>

const TITLE_LIMIT = 120

/** The last path segment of the URL, decoded. */
function fileName(url: string): string {
  const path = new URL(url).pathname
  const last = path.slice(path.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/** A user guide or a datasheet by its file name or the start of its text; else `other`. */
export function documentKind(url: string, text: string): ModelDocument['kind'] {
  const name = fileName(url)
  const head = text.slice(0, 500)
  if ([name, head].some((s) => /user.?guide|manual|instructions/i.test(s))) return 'user-guide'
  if ([name, head].some((s) => /data.?sheet|spec(?:ification)?s?\b/i.test(s))) return 'datasheet'
  return 'other'
}

/** The first non-empty line of the text, else the file name without extension. */
export function documentTitle(url: string, text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '')
  if (line !== undefined) return line.slice(0, TITLE_LIMIT)
  return fileName(url).replace(/\.[^./]+$/, '').replace(/[-_]/g, ' ').trim()
}

/** Told of every fetch that was skipped (a refusal, a block, an error): the caller decides whether that stops anything. */
export type OnSkip = (url: string, reason: string, detail?: string) => void

type Checked = { document: ModelDocument; checks: CheckResult[] }

/** The URL to download: an archive copy is read raw, without the archive's frame. */
function downloadUrl(url: string): string {
  const archived = parseArchiveUrl(url)
  return archived ? archiveUrl(archived.timestamp, archived.original, { raw: true }) : url
}

/**
 * The three checks of a document of a model: the original URL matches the brand's pattern, the PDF downloads
 * and has text, the text names the model. Null when no readable PDF came back.
 */
async function verify(
  brand: Brand,
  model: Named,
  url: string,
  opts: { refresh?: boolean; onSkip?: OnSkip },
): Promise<Checked | null> {
  const download = downloadUrl(url)
  const page = await fetchPage(download, opts.refresh ? { refresh: true } : {})
  if (page.status === 'skipped') opts.onSkip?.(download, page.reason, page.detail)
  // A PDF that was logged as answered but gave no text is not a document.
  if (page.status !== 'ok' || page.text.trim() === '') return null

  const original = parseArchiveUrl(url)?.original ?? url
  const pattern = brand.scraper.documentUrlPattern
  const checks: CheckResult[] = [
    pattern !== undefined && new RegExp(pattern).test(original)
      ? { name: 'document', ok: true }
      : { name: 'document', ok: false, detail: 'the document URL does not match the brand pattern' },
  ]
  checks.push(
    /application\/pdf/i.test(page.contentType ?? '')
      ? { name: 'document', ok: true }
      : { name: 'document', ok: false, detail: 'the document is not a PDF' },
  )
  checks.push(
    namesModel(model, page.text)
      ? { name: 'document', ok: true }
      : { name: 'document', ok: false, detail: 'the document does not name the model' },
  )
  const document: ModelDocument = {
    kind: documentKind(url, page.text),
    title: documentTitle(url, page.text),
    url: citableArchiveUrl(url),
    fetchedAt: page.fetchedAt,
  }
  return { document, checks }
}

export function checkDocument(
  brand: Brand,
  model: Named,
  url: string,
  opts: { refresh?: boolean; onSkip?: OnSkip } = {},
): Promise<Checked | null> {
  return verify(brand, model, url, opts)
}

/**
 * Stored live documents whose link is dead (HTTP 404 or 410), each replaced by the latest Web Archive copy
 * when that copy passes `checkDocument` (brand pattern on its original, a PDF with text, the model's name). A gone brand's live links are not fetched; no copy means no change.
 */
export async function replaceDeadDocuments(
  model: Model,
  opts: { brand: Brand; refresh?: boolean; gone?: boolean; onSkip?: OnSkip },
): Promise<CandidateChange[]> {
  if (opts.gone) return []
  const changes: CandidateChange[] = []
  for (const [i, before] of model.documents.entries()) {
    if (parseArchiveUrl(before.url) !== null) continue
    const live = await fetchPage(before.url, { refresh: true })
    if (live.status !== 'skipped') continue
    // Only a plain "not found" says the link is dead; any other skip (a refusal, a timeout) is reported and the document left alone.
    if (live.detail !== 'HTTP 404' && live.detail !== 'HTTP 410') {
      opts.onSkip?.(before.url, live.reason, live.detail)
      continue
    }
    const copy = await latestCopy(before.url, opts.refresh ? { refresh: true } : {})
    if (copy === null) continue
    const checked = await verify(opts.brand, model, archiveUrl(copy.timestamp, copy.original), opts)
    if (checked === null || !checked.checks.every((c) => c.ok)) continue
    const path = `documents.${i}`
    changes.push({ kind: 'document', modelSlug: model.slug, path, before, after: checked.document, checks: { [path]: checked.checks } })
  }
  return changes
}
