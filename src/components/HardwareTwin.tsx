import Link from 'next/link'
import type { Brand } from '@/src/lib/schema/brand'
import type { Model } from '@/src/lib/schema/model'
import { productName } from '@/src/lib/site/product'
import { SourceNote } from './SourceNote'

type Props = { twin: Model['sameHardwareAs'][number]; models: Model[]; brands: Brand[] }

/** A model said to be the same hardware as another, and who says so. */
export function HardwareTwin({ twin, models, brands }: Props) {
  // A twin may not be in the database: then only the name its source gives is known.
  const other = models.find((m) => m.slug === twin.slug)
  return (
    <>
      {other ? <Link href={`/hearing-aids/${other.slug}`}>{productName(other, brands)}</Link> : twin.source.value}{' '}
      <SourceNote source={twin.source} />
    </>
  )
}
