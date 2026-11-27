import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { CompanyBlock } from '@/src/components/CompanyBlock'
import { ModelList } from '@/src/components/ModelList'
import { loadDataset } from '@/src/lib/data/load'
import { citableArchiveUrl, parseArchiveUrl } from '@/src/lib/archive-url'
import { companyBlock } from '@/src/lib/site/companies'
import { addedOn, latestFirst } from '@/src/lib/site/catalog-index'
import { hostname } from '@/src/lib/site/format'
import { canonical } from '@/src/lib/site/url'

type Props = { params: Promise<{ brand: string }> }

export const dynamicParams = false

const dataset = cache(() => loadDataset())

export async function generateStaticParams() {
  const { brands } = await dataset()
  return brands.map(({ slug }) => ({ brand: slug }))
}

async function find(slug: string) {
  const data = await dataset()
  const brand = data.brands.find((b) => b.slug === slug)
  if (!brand) notFound()
  return { data, brand }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { brand: slug } = await params
  const { data, brand } = await find(slug)
  // A page that lists no models has nothing of its own for search engines.
  const empty = !data.models.some((model) => model.brand === slug)
  return {
    title: `${brand.name} hearing aids`,
    description: `${brand.name} hearing aids in the database, with type and release date.`,
    alternates: canonical(`/brands/${slug}`),
    ...(empty && { robots: { index: false, follow: true } }),
  }
}

export default async function BrandPage({ params }: Props) {
  const { brand: slug } = await params
  const { data, brand } = await find(slug)
  const models = data.models
    .filter((model) => model.brand === slug)
    .map((model) => ({ model, releaseDate: model.releaseDate?.value, addedOn: addedOn(model.slug, data.events) }))
    .sort(latestFirst)
    .map(({ model }) => model)
  const company = companyBlock(slug, data.graph)
  const archivedCatalog = brand.archive?.catalogUrls.find((url) => parseArchiveUrl(url) !== null)
  const archived = archivedCatalog && citableArchiveUrl(archivedCatalog)

  return (
    <main className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/hearing-aids">All hearing aids</Link>
      </nav>
      <h1>{brand.name} hearing aids</h1>
      {brand.status === 'active' ? (
        <p>
          Maker’s website: <a href={brand.website}>{hostname(brand.website)}</a>
        </p>
      ) : (
        // The domain of a gone brand may be parked or taken over: only archived copies are linked.
        <p>
          This brand’s website is gone.
          {archived && (
            <>
              {' '}
              <a href={archived}>Archived copy</a>
            </>
          )}
        </p>
      )}
      {company && <CompanyBlock data={company} brands={data.brands} goneHost={brand.status === 'gone' ? hostname(brand.website) : undefined} />}
      {models.length === 0 ? (
        <p>No {brand.name} models in the database yet.</p>
      ) : (
        <ModelList models={models} brands={data.brands} />
      )}
    </main>
  )
}
