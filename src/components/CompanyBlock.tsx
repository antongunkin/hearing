import Link from 'next/link'
import { archiveMonth, citableArchiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import type { Brand } from '@/src/lib/schema/brand'
import type { EdgeSource } from '@/src/lib/schema/graph'
import type { CompanyBlockData } from '@/src/lib/site/companies'
import { hostname } from '@/src/lib/site/format'
import { SourceNote } from './SourceNote'

const bare = (host: string) => host.replace(/^www\./, '')

/** Whether `host` is the gone host or one of its subdomains. */
const onGoneHost = (host: string, goneHost: string) => {
  const gone = bare(goneHost)
  return bare(host) === gone || host.endsWith(`.${gone}`)
}

/**
 * The sources of a relation. A Web Archive copy is labelled as one, with its month; a third party is named.
 * Only quoted sources other than the crawl are shown. `goneHost` is the host of a gone brand's own site: it may
 * be parked or taken over, so a live source on it (or on a subdomain of it) is named, not linked.
 */
export function EdgeSources({ sources, goneHost }: { sources: EdgeSource[]; goneHost?: string }) {
  return sources.filter((source) => source.quote !== undefined && source.kind !== 'crawl').map((source) => {
    const archived = parseArchiveUrl(source.url)
    const href = citableArchiveUrl(source.url)
    if (archived) {
      const host = hostname(archived.original)
      return (
        <a key={source.url} className={source.kind === 'third-party' ? 'source source-third' : 'source'} href={href}>
          {source.kind === 'third-party' ? `According to ${host}` : `Source: ${host}`} (archived copy, {archiveMonth(archived.timestamp)})
        </a>
      )
    }
    if (goneHost !== undefined && onGoneHost(hostname(source.url), goneHost)) {
      return <span key={source.url}>Source: {hostname(source.url)}</span>
    }
    return (
      <SourceNote
        key={source.url}
        source={{ sourceUrl: href, sourceType: source.kind === 'third-party' ? 'third-party' : 'official' }}
      />
    )
  })
}

const appStore = (id: string) => `https://apps.apple.com/app/id${id}`
const playStore = (id: string) => `https://play.google.com/store/apps/details?id=${id}`

export function CompanyBlock({ data, brands, goneHost }: { data: CompanyBlockData; brands: Brand[]; goneHost?: string }) {
  const { owner, siblings, makers, apps } = data
  const sibling = siblings.flatMap((slug) => brands.find((b) => b.slug === slug) ?? [])
  return (
    <section aria-labelledby="company-heading">
      <h2 id="company-heading">Company</h2>
      {owner && (
        <p>
          Owned by {owner.name}
          {owner.since && ` since ${owner.since}`} <EdgeSources sources={owner.sources} goneHost={goneHost} />
        </p>
      )}
      {sibling.length > 0 && (
        <p>
          Other brands of {owner?.name}:{' '}
          {sibling.map((b, i) => (
            <span key={b.slug}>
              {i > 0 && ', '}
              <Link href={`/brands/${b.slug}`}>{b.name}</Link>
            </span>
          ))}
        </p>
      )}
      {makers.length > 0 && (
        <ul aria-label="Makers">
          {makers.map((maker) => (
            <li key={maker.name}>
              Made by {maker.name} <EdgeSources sources={maker.sources} goneHost={goneHost} />
            </li>
          ))}
        </ul>
      )}
      {apps.length > 0 && (
        <ul aria-label="Apps">
          {apps.map((app) => (
            <li key={app.name}>
              {app.name}
              {app.iosId && (
                <>
                  {' '}
                  <a href={appStore(app.iosId)}>App Store</a>
                </>
              )}
              {app.androidId && (
                <>
                  {' '}
                  <a href={playStore(app.androidId)}>Google Play</a>
                </>
              )}{' '}
              <EdgeSources sources={app.sources} goneHost={goneHost} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
