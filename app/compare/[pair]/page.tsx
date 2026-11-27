import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { AdSlot } from '@/src/components/AdSlot'
import { CompareTable } from '@/src/components/CompareTable'
import { ProsCons } from '@/src/components/ProsCons'
import { ReviewSummary } from '@/src/components/ReviewSummary'
import { loadDataset } from '@/src/lib/data/load'
import { buildCatalogIndex } from '@/src/lib/site/catalog-index'
import { pairSlug, parsePairSlug, selectCuratedPairs } from '@/src/lib/site/pairs'
import { productName } from '@/src/lib/site/product'
import { canonical } from '@/src/lib/site/url'

type Props = { params: Promise<{ pair: string }> }

/** Only the curated pairs have a page; the compare tool shows any other. */
export const dynamicParams = false

const dataset = cache(() => loadDataset())

export async function generateStaticParams() {
  const { models } = await dataset()
  return selectCuratedPairs(buildCatalogIndex(models)).map(([a, b]) => ({ pair: pairSlug(a, b) }))
}

async function find(pair: string) {
  const data = await dataset()
  const products = (parsePairSlug(pair) ?? []).flatMap((slug) => {
    const model = data.models.find((m) => m.slug === slug)
    if (!model) return []
    const reviews = data.reviews.find((r) => r.slug === slug)
    return [{ model, name: productName(model, data.brands), reviews }]
  })
  if (products.length !== 2) notFound()
  const [a, b] = products
  return { products, title: `${a.name} vs ${b.name}`, both: `${a.name} and ${b.name}` }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pair } = await params
  const { title, both } = await find(pair)
  return {
    title,
    description: `${both} side by side: specifications with their sources, and published review summaries where available.`,
    alternates: canonical(`/compare/${pair}`),
  }
}

export default async function ComparePage({ params }: Props) {
  const { pair } = await params
  const { products, title } = await find(pair)

  return (
    <main className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/hearing-aids">All hearing aids</Link>
      </nav>

      <h1>{title}</h1>
      <ul>
        {products.map(({ model, name }) => (
          <li key={model.slug}>
            <Link href={`/hearing-aids/${model.slug}`}>{name}: full details</Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="specs-heading">
        <h2 id="specs-heading">Specifications</h2>
        <CompareTable products={products} />
      </section>

      <AdSlot id="compare-after-specs" minHeight={280} />

      {products.map(
        ({ model, name, reviews }) =>
          reviews && (
            <ReviewSummary
              key={model.slug}
              customer={reviews.customer}
              complaintThemes={reviews.complaintThemes}
              product={name}
            />
          ),
      )}
      {products.map(
        ({ model, name, reviews }) => reviews && <ProsCons key={model.slug} prosCons={reviews.prosCons} product={name} />,
      )}

      <AdSlot id="compare-end" minHeight={280} />
    </main>
  )
}
