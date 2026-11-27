import Link from 'next/link'
import type { Brand } from '@/src/lib/schema/brand'
import type { Event } from '@/src/lib/schema/event'
import type { Model } from '@/src/lib/schema/model'
import { formatDate, hostname } from '@/src/lib/site/format'
import { productName } from '@/src/lib/site/product'

type Props = { events: Event[]; models: Model[]; brands: Brand[]; limit?: number }

/** The feed, newest first, `limit` of it at most. Each sentence links to its own page. */
export function EventList({ events, models, brands, limit }: Props) {
  return (
    <ul className="event-list">
      {[...events]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map((event) => {
          // An event may belong to no model, or to one that is no longer listed.
          const model = models.find((m) => m.slug === event.modelSlug)
          return (
            <li key={event.id}>
              <time dateTime={event.date}>{formatDate(event.date)}</time>
              <div>
                <p>
                  <Link href={`/news/${event.id}`} prefetch={false}>
                    {event.text}
                  </Link>
                </p>
                <p className="event-links">
                  {model && <Link href={`/hearing-aids/${model.slug}`}>{productName(model, brands)}</Link>}
                  {event.sources.map((url) => (
                    <a key={url} href={url}>
                      {hostname(url)}
                    </a>
                  ))}
                </p>
              </div>
            </li>
          )
        })}
    </ul>
  )
}
