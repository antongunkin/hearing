import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { AdSlot } from '@/src/components/AdSlot'
import { BuyBoxSlot } from '@/src/components/BuyBoxSlot'
import { FormFactorIcon } from '@/src/components/FormFactorIcon'
import { ProsCons } from '@/src/components/ProsCons'
import { ReviewSummary } from '@/src/components/ReviewSummary'
import { SourceNote } from '@/src/components/SourceNote'
import { SpecTable } from '@/src/components/SpecTable'
import { YouTubeEmbed } from '@/src/components/YouTubeEmbed'
import { loadDataset } from '@/src/lib/data/load'
import type { Model } from '@/src/lib/schema/model'
import { TYPE_LABELS } from '@/src/lib/site/format'
import { productJsonLd } from '@/src/lib/site/jsonld'
import { pressImage } from '@/src/lib/site/press-image'
import { specColumns, specRows } from '@/src/lib/site/spec-rows'
import { canonical } from '@/src/lib/site/url'

type Props = { params: Promise<{ slug: string }> }

/** Every model has a page built ahead; there are no others. */
export const dynamicParams = false

const dataset = cache(() => loadDataset())

export async function generateStaticParams() {
  const { models } = await dataset()
  return models.map(({ slug }) => ({ slug }))
}

async function find(slug: string) {
  const data = await dataset()
  const model = data.models.find((m) => m.slug === slug)
  if (!model) notFound()
  const brandOf = (of: Model) => {
    const brand = data.brands.find((b) => b.slug === of.brand)
    if (!brand) throw new Error(`model ${of.slug} names an unknown brand: ${of.brand}`)
    return brand
  }
  const brand = brandOf(model)
  return { data, model, brand, brandOf, product: `${brand.name} ${model.name}` }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const { product } = await find(slug)
  return {
    title: `${product} specifications`,
    description: `${product}: specifications, price, battery and published review summaries, with sources.`,
    alternates: canonical(`/hearing-aids/${slug}`),
  }
}

export default async function ModelPage({ params }: Props) {
  const { slug } = await params
  const { data, model, brand, brandOf, product } = await find(slug)
  const reviews = data.reviews.find((r) => r.slug === slug)
  const image = await pressImage(slug, brand)
  const styles = [...new Set(model.variants.map((variant) => variant.formFactor))]
  // The closest competitors are chosen by the comparison pages, which are not built yet.
  const competitors: Model[] = []

  return (
    <main className="page">
      {/* "<" is escaped so that no value can close the script. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd(model, brand)).replace(/</g, '\\u003c') }}
      />

      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/hearing-aids">All hearing aids</Link>
      </nav>

      <div className="model-header">
        <div>
          <h1>{product}</h1>
          <dl className="facts">
            <div>
              <dt>Type</dt>
              <dd>{TYPE_LABELS[model.type]}</dd>
            </div>
            {styles.length > 0 && (
              <div>
                <dt>Style</dt>
                <dd>{styles.join(', ')}</dd>
              </div>
            )}
          </dl>
          <BuyBoxSlot type={model.type} />
        </div>
        <figure className="product-image">
          <div>
            {image ? (
              <Image src={image} alt={`${product} hearing aid`} fill sizes="(min-width: 48rem) 18rem, 100vw" />
            ) : (
              <FormFactorIcon formFactor={styles[0]} />
            )}
          </div>
          <figcaption className="note">{image ? `Photo: ${brand.name}` : 'Style illustration, not the product'}</figcaption>
        </figure>
      </div>

      <section aria-labelledby="specs-heading">
        <h2 id="specs-heading">Specifications</h2>
        <p className="note">
          Each figure links to where it is stated: the maker or the FDA, unless it says “According to” a third party.
        </p>
        <SpecTable columns={specColumns([model]).map((column) => column.label)} rows={specRows([model])} />
      </section>

      <AdSlot id="model-after-specs" minHeight={280} />

      {reviews && (
        <>
          <ReviewSummary customer={reviews.customer} complaintThemes={reviews.complaintThemes} />
          <ProsCons prosCons={reviews.prosCons} />
          {reviews.videos.length > 0 && (
            <section aria-labelledby="videos-heading">
              <h2 id="videos-heading">Video reviews</h2>
              <div className="videos">
                {reviews.videos.map((video) => (
                  <YouTubeEmbed key={video.id} video={video} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {model.sameHardwareAs.length > 0 && (
        <section aria-labelledby="twins-heading">
          <h2 id="twins-heading">Same hardware as</h2>
          <ul>
            {model.sameHardwareAs.map((twin) => {
              // A twin may not be in the database: then only the name its source gives is known.
              const other = data.models.find((m) => m.slug === twin.slug)
              return (
                <li key={twin.slug}>
                  {other ? (
                    <Link href={`/hearing-aids/${other.slug}`}>
                      {brandOf(other).name} {other.name}
                    </Link>
                  ) : (
                    twin.source.value
                  )}{' '}
                  <SourceNote source={twin.source} />
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {competitors.length > 0 && (
        <section aria-labelledby="competitors-heading">
          <h2 id="competitors-heading">Closest competitors</h2>
          <ul>
            {competitors.map((other) => (
              <li key={other.slug}>
                <Link href={`/hearing-aids/${other.slug}`}>
                  {brandOf(other).name} {other.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AdSlot id="model-end" minHeight={280} />
    </main>
  )
}
