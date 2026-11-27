import type { Metadata } from 'next'
import Link from 'next/link'
import { CompareTool } from '@/src/components/CompareTool'
import { loadDataset } from '@/src/lib/data/load'
import { productName } from '@/src/lib/site/product'

export const metadata: Metadata = {
  title: 'Compare hearing aids',
  description: 'The specifications of any two hearing aids side by side, with their sources.',
  // Any pair at all: only the pair pages are for search engines.
  robots: { index: false, follow: true },
}

export default async function CompareToolPage() {
  const { brands, models } = await loadDataset()
  const options = models
    .map((model): [string, string] => [model.slug, productName(model, brands)])
    .sort((a, b) => a[1].localeCompare(b[1]))

  return (
    <main className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/hearing-aids">All hearing aids</Link>
      </nav>
      <h1>Compare hearing aids</h1>
      {options.length < 2 ? <p>There are not yet two models to compare.</p> : <CompareTool options={options} />}
    </main>
  )
}
