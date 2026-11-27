import type { Metadata } from 'next'
import { EventList } from '@/src/components/EventList'
import { loadDataset } from '@/src/lib/data/load'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = {
  title: 'News',
  description: 'New models, price changes, FDA clearances and recalls, and app updates for hearing aids.',
  alternates: canonical('/news'),
}

export default async function NewsPage() {
  const { brands, models, events } = await loadDataset()
  return (
    <main className="page">
      <h1>News</h1>
      {events.length === 0 ? (
        <p>No changes recorded yet.</p>
      ) : (
        <EventList events={events} models={models} brands={brands} />
      )}
    </main>
  )
}
