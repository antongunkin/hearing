import type { Metadata } from 'next'
import { CatalogFilters } from '@/src/components/CatalogFilters'
import { loadDataset } from '@/src/lib/data/load'
import { buildCatalogIndex } from '@/src/lib/site/catalog-index'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = {
  title: 'All hearing aids',
  description: 'Filter hearing aids sold in the United States by type, style, battery, brand, Auracast and price.',
  alternates: canonical('/hearing-aids'),
}

export default async function CatalogPage() {
  const { brands, models } = await loadDataset()
  return (
    <main className="page">
      <h1>All hearing aids</h1>
      {models.length === 0 ? (
        <p>No models in the database yet.</p>
      ) : (
        <CatalogFilters
          items={buildCatalogIndex(models)}
          brandNames={Object.fromEntries(brands.map((brand) => [brand.slug, brand.name]))}
        />
      )}
    </main>
  )
}
