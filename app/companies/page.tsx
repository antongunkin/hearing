import type { Metadata } from 'next'
import Link from 'next/link'
import { EdgeSources } from '@/src/components/CompanyBlock'
import { loadDataset } from '@/src/lib/data/load'
import { ownershipTable } from '@/src/lib/site/companies'
import { canonical } from '@/src/lib/site/url'

const TITLE = 'Who owns which hearing aid brand'

export async function generateMetadata(): Promise<Metadata> {
  const { graph, brands } = await loadDataset()
  const empty = ownershipTable(graph, brands).length === 0
  return {
    title: TITLE,
    description: 'Hearing aid brands and the companies that own them, each with the page that says so.',
    alternates: canonical('/companies'),
    ...(empty && { robots: { index: false, follow: true } }),
  }
}

export default async function CompaniesPage() {
  const { graph, brands } = await loadDataset()
  const rows = ownershipTable(graph, brands)
  return (
    <main className="page">
      <h1>{TITLE}</h1>
      {rows.length === 0 ? (
        <p>No verified ownership records yet.</p>
      ) : (
        rows.map((row) => (
          <section key={row.company}>
            <h2>{row.company}</h2>
            <ul>
              {row.brands.map((brand) => (
                <li key={brand.slug}>
                  <Link href={`/brands/${brand.slug}`}>{brand.name}</Link>
                  {brand.since && ` since ${brand.since}`} <EdgeSources sources={brand.sources} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  )
}
