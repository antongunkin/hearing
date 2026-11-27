import type { Metadata } from 'next'
import Link from 'next/link'
import { loadDataset } from '@/src/lib/data/load'
import { latestFirst } from '@/src/lib/site/catalog-index'
import { formatDate, hostname, TYPE_LABELS } from '@/src/lib/site/format'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = { alternates: canonical('/') }

export default async function Home() {
  const { brands, models, events } = await loadDataset()
  const brandNames = new Map(brands.map((brand) => [brand.slug, brand.name]))
  const products = new Map(models.map((model) => [model.slug, `${brandNames.get(model.brand) ?? model.brand} ${model.name}`]))

  const latestModels = models
    .map((model) => ({ model, releaseDate: model.releaseDate?.value }))
    .sort(latestFirst)
    .slice(0, 12)
  const latestEvents = [...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)

  return (
    <main className="page">
      <h1>Hearing aid specifications, with their sources</h1>
      <p className="lead">
        A reference to hearing aids sold in the United States: specifications, prices, FDA records and summaries of
        published reviews.
      </p>

      <section aria-labelledby="models-heading">
        <h2 id="models-heading">Latest models</h2>
        {latestModels.length === 0 ? (
          <p>No models in the database yet.</p>
        ) : (
          <>
            <ul className="model-list">
              {latestModels.map(({ model, releaseDate }) => (
                <li key={model.slug}>
                  <Link href={`/hearing-aids/${model.slug}`}>{products.get(model.slug)}</Link>
                  <span className="note">{TYPE_LABELS[model.type]}</span>
                  <span className="note">{releaseDate ? `Released ${formatDate(releaseDate)}` : 'Release date unknown'}</span>
                </li>
              ))}
            </ul>
            <p>
              <Link href="/hearing-aids">Filter all models by style, battery and price</Link>
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="events-heading">
        <h2 id="events-heading">Recent changes</h2>
        {latestEvents.length === 0 ? (
          <p>No changes recorded yet.</p>
        ) : (
          <ul className="event-list">
            {latestEvents.map((event) => (
              <li key={event.id}>
                <time dateTime={event.date}>{formatDate(event.date)}</time>
                <div>
                  <p>{event.text}</p>
                  <p className="event-links">
                    {event.modelSlug && products.has(event.modelSlug) && (
                      <Link href={`/hearing-aids/${event.modelSlug}`}>{products.get(event.modelSlug)}</Link>
                    )}
                    {event.sources.map((url) => (
                      <a key={url} href={url}>
                        {hostname(url)}
                      </a>
                    ))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
