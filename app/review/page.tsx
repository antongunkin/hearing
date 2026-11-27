import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadDataset } from '@/src/lib/data/load'
import { AtlasCard } from './AtlasCard'
import { cell, ChangeRow } from './ChangeRow'
import { ModelCard } from './ModelCard'

export const metadata: Metadata = { title: 'Review pending changes', robots: { index: false, follow: false } }

/** The owner's approval queue (`data/pending/`). Only the dev server has it. */
export default async function ReviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound()

  const { pending } = await loadDataset('data')
  const models = pending.filter((item) => item.kind === 'new-model')
  const atlas = pending.filter((item) => item.kind === 'brand-config' || item.kind === 'relation' || item.kind === 'brand-history')
  const changes = pending.filter((item) => item.kind !== 'new-model' && item.kind !== 'brand-config' && item.kind !== 'relation' && item.kind !== 'brand-history')

  return (
    <main>
      <h1>Review pending changes</h1>
      <p>{pending.length === 0 ? 'Nothing to review.' : `${pending.length} pending.`}</p>
      {atlas.map((item) => (
        <AtlasCard key={item.id} item={item} />
      ))}
      {models.map((item) => (
        <ModelCard key={item.id} item={item} />
      ))}
      {changes.length > 0 && (
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Change', 'Was', '→ Now', 'Checks', 'Decision'].map((title) => (
                <th key={title} scope="col" style={cell}>
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {changes.map((item) => (
              <ChangeRow key={item.id} item={item} />
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
