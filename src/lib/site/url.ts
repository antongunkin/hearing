/**
 * The absolute URL of a site path, from `NEXT_PUBLIC_SITE_URL`. Undefined when it is unset: no canonical
 * is better than one pointing at the wrong host.
 */
export function absoluteUrl(path: string): string | undefined {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  return site ? `${site}${path}` : undefined
}

/** Metadata `alternates` naming the canonical URL of a page. */
export function canonical(path: string) {
  const url = absoluteUrl(path)
  return url ? { canonical: url } : undefined
}
