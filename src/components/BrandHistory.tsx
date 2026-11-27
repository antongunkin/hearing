import { citableArchiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import type { Brand } from '@/src/lib/schema/brand'
import { formatDate, hostname } from '@/src/lib/site/format'

const bare = (host: string) => host.replace(/^www\./, '')

/** What happened to a brand: dated facts with their sources, and the status of its app. */
export function BrandHistory({ brand }: { brand: Pick<Brand, 'name' | 'website' | 'status' | 'history'> }) {
  const { history } = brand
  if (!history) return null
  const goneHost = brand.status === 'gone' ? bare(hostname(brand.website)) : undefined
  const app = history.app
  return (
    <section id="what-happened" aria-labelledby="what-happened-heading">
      <h2 id="what-happened-heading">What happened to {brand.name}</h2>
      <ul>
        {history.facts.map((fact) => {
          const archived = parseArchiveUrl(fact.sourceUrl) !== null
          const host = hostname(archived ? parseArchiveUrl(fact.sourceUrl)!.original : fact.sourceUrl)
          // A live page on a gone brand's domain may be parked or taken over: it is named, not linked.
          const onGone = goneHost !== undefined && (bare(host) === goneHost || host.endsWith(`.${goneHost}`))
          return (
            <li key={`${fact.date}-${fact.sourceUrl}`}>
              <strong>{formatDate(fact.date)}.</strong> {fact.text}{' '}
              {onGone && !archived ? (
                <span className="source">Source: {host}</span>
              ) : (
                <a className="source" href={citableArchiveUrl(fact.sourceUrl)}>
                  Source: {host}
                  {archived && ' (archived copy)'}
                </a>
              )}
            </li>
          )
        })}
      </ul>
      {app && (
        <p>
          {app.available
            ? `${app.name} is on the App Store (checked ${formatDate(app.checkedAt)}).`
            : `${app.name} is no longer on the App Store (checked ${formatDate(app.checkedAt)}).`}
        </p>
      )}
    </section>
  )
}
