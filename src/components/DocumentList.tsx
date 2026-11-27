import { archiveMonth, citableArchiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import type { ModelDocument } from '@/src/lib/schema/model'
import { formatDate, hostname } from '@/src/lib/site/format'

const KIND_LABELS = { 'user-guide': 'User guide', datasheet: 'Datasheet', other: 'Document' } as const

const bare = (host: string) => host.replace(/^www\./, '')

/**
 * Manuals and datasheets the maker published, linked and never stored. An archive copy says so with its month.
 * `goneHost` is the site of a gone brand: it may be parked or taken over, so a live address on it (or on a
 * subdomain) is named, not linked.
 */
export function DocumentList({ documents, goneHost }: { documents: ModelDocument[]; goneHost?: string }) {
  if (documents.length === 0) return null
  return (
    <ul>
      {documents.map((doc) => {
        const copy = parseArchiveUrl(doc.url)
        const host = hostname(doc.url)
        const gone = goneHost !== undefined && (bare(host) === bare(goneHost) || host.endsWith(`.${bare(goneHost)}`))
        return (
          <li key={doc.url}>
            {copy || !gone ? <a href={citableArchiveUrl(doc.url)}>{doc.title}</a> : doc.title}{' '}
            <small>
              ({KIND_LABELS[doc.kind]}
              {copy && `, archived copy, ${formatDate(archiveMonth(copy.timestamp))}, via Internet Archive`})
            </small>
          </li>
        )
      })}
    </ul>
  )
}
