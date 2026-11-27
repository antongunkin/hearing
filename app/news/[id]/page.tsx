import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { loadDataset } from '@/src/lib/data/load'
import { EVENT_LABELS, formatDate } from '@/src/lib/site/format'
import { productName } from '@/src/lib/site/product'
import { canonical } from '@/src/lib/site/url'

type Props = { params: Promise<{ id: string }> }

export const dynamicParams = false

const dataset = cache(() => loadDataset())

export async function generateStaticParams() {
  const { events } = await dataset()
  return events.map(({ id }) => ({ id }))
}

async function find(id: string) {
  const data = await dataset()
  const event = data.events.find((e) => e.id === id)
  if (!event) notFound()
  return { data, event }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const { event } = await find(id)
  return {
    title: event.text,
    description: `${EVENT_LABELS[event.type]}, ${formatDate(event.date)}: ${event.text}`,
    alternates: canonical(`/news/${id}`),
  }
}

export default async function EventPage({ params }: Props) {
  const { id } = await params
  const { data, event } = await find(id)
  const model = data.models.find((m) => m.slug === event.modelSlug)

  return (
    <main className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/news">News</Link>
      </nav>
      <h1>{event.text}</h1>
      <dl className="facts">
        <div>
          <dt>Date</dt>
          <dd>
            <time dateTime={event.date}>{formatDate(event.date)}</time>
          </dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{EVENT_LABELS[event.type]}</dd>
        </div>
        {model && (
          <div>
            <dt>Model</dt>
            <dd>
              <Link href={`/hearing-aids/${model.slug}`}>{productName(model, data.brands)}</Link>
            </dd>
          </div>
        )}
      </dl>
      {event.sources.length > 0 && (
        <section aria-labelledby="sources-heading">
          <h2 id="sources-heading">Sources</h2>
          <ul className="urls">
            {event.sources.map((url) => (
              <li key={url}>
                <a href={url}>{url}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
