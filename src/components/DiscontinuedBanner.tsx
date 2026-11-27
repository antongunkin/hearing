import { formatDate } from '@/src/lib/site/format'

/** Says a model is no longer sold, and when its maker last listed it if that is known. */
export function DiscontinuedBanner({ brand, lastListed }: { brand: string; lastListed?: string }) {
  return (
    <p className="discontinued" role="note">
      {lastListed === undefined ? 'Discontinued' : `Discontinued — last listed by ${brand} in ${formatDate(lastListed)}`}
    </p>
  )
}
