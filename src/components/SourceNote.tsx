import type { Sourced } from '@/src/lib/schema/field'
import { hostname } from '@/src/lib/site/format'

function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6.5 3.5h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3M9.5 2.5h4v4M13.5 2.5 7 9" />
    </svg>
  )
}

/** Where a value comes from. A third party is named in words; the maker or the FDA is an icon. */
export function SourceNote({ source }: { source: Sourced<unknown> }) {
  const { sourceUrl, sourceType, derivation } = source
  const host = hostname(sourceUrl)
  if (sourceType === 'third-party') {
    return (
      <a className="source source-third" href={sourceUrl}>
        According to {host}
      </a>
    )
  }
  const label = derivation ? `Source: ${host} (converted from ${derivation.input})` : `Source: ${host}`
  return (
    <a className="source" href={sourceUrl} aria-label={label} title={label}>
      <LinkIcon />
    </a>
  )
}
