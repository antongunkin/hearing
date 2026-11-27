import type { Metadata } from 'next'
import Link from 'next/link'
import { EventList } from '@/src/components/EventList'
import { ModelList } from '@/src/components/ModelList'
import { loadDataset } from '@/src/lib/data/load'
import { addedOn, latestFirst } from '@/src/lib/site/catalog-index'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = { alternates: canonical('/') }

export default async function Home() {
  const { brands, models, events } = await loadDataset()
  const latestModels = models
    .filter((model) => model.discontinued === undefined)
    .map((model) => ({ model, releaseDate: model.releaseDate?.value, addedOn: addedOn(model.slug, events) }))
    .sort(latestFirst)
    .slice(0, 12)
    .map(({ model }) => model)

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
            <ModelList models={latestModels} brands={brands} />
            <p>
              <Link href="/hearing-aids">Filter all models by style, battery and price</Link>
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="events-heading">
        <h2 id="events-heading">Recent changes</h2>
        {events.length === 0 ? (
          <p>No changes recorded yet.</p>
        ) : (
          <EventList events={events} models={models} brands={brands} limit={10} />
        )}
      </section>
    </main>
  )
}
