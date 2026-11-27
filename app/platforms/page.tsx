import type { Metadata } from 'next'
import Link from 'next/link'
import { HardwareTwin } from '@/src/components/HardwareTwin'
import { SourceNote } from '@/src/components/SourceNote'
import { loadDataset } from '@/src/lib/data/load'
import type { Model } from '@/src/lib/schema/model'
import { productName } from '@/src/lib/site/product'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = {
  title: 'Platforms and shared hardware',
  description: 'Which hearing aids are built on the same platform, and which are reported to be the same hardware.',
  alternates: canonical('/platforms'),
}

export default async function PlatformsPage() {
  const { brands, models } = await loadDataset()
  const named = models
    .map((model) => ({ model, name: productName(model, brands) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const platforms = new Map<string, { model: Model; name: string }[]>()
  for (const entry of named) {
    const platform = entry.model.platform?.value
    if (platform !== undefined) platforms.set(platform, [...(platforms.get(platform) ?? []), entry])
  }
  const twins = named.flatMap(({ model, name }) => model.sameHardwareAs.map((twin) => ({ model, name, twin })))

  return (
    <main className="page">
      <h1>Platforms and shared hardware</h1>

      <section aria-labelledby="platforms-heading">
        <h2 id="platforms-heading">Platforms</h2>
        {platforms.size === 0 ? (
          <p>No platforms recorded yet.</p>
        ) : (
          [...platforms]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([platform, entries]) => (
              <section key={platform}>
                <h3>{platform}</h3>
                <ul>
                  {entries.map(({ model, name }) => (
                    <li key={model.slug}>
                      <Link href={`/hearing-aids/${model.slug}`}>{name}</Link>
                      <SourceNote source={model.platform!} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
        )}
      </section>

      <section aria-labelledby="twins-heading">
        <h2 id="twins-heading">Same hardware</h2>
        {twins.length === 0 ? (
          <p>No shared hardware recorded yet.</p>
        ) : (
          <ul>
            {twins.map(({ model, name, twin }) => (
              <li key={`${model.slug} ${twin.slug}`}>
                <Link href={`/hearing-aids/${model.slug}`}>{name}</Link>: same hardware as{' '}
                <HardwareTwin twin={twin} models={models} brands={brands} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
