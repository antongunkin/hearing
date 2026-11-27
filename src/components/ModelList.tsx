import Link from 'next/link'
import type { Brand } from '@/src/lib/schema/brand'
import type { Model } from '@/src/lib/schema/model'
import { formatDate, TYPE_LABELS } from '@/src/lib/site/format'
import { productName } from '@/src/lib/site/product'

/** Models by name, each with its type and release date, in the order given. */
export function ModelList({ models, brands }: { models: Model[]; brands: Brand[] }) {
  return (
    <ul className="model-list">
      {models.map((model) => (
        <li key={model.slug}>
          <Link href={`/hearing-aids/${model.slug}`}>{productName(model, brands)}</Link>
          <span className="note">{TYPE_LABELS[model.type]}</span>
          <span className="note">
            {model.releaseDate ? `Released ${formatDate(model.releaseDate.value)}` : 'Release date unknown'}
          </span>
        </li>
      ))}
    </ul>
  )
}
