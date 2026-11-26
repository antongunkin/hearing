// The current iOS version of a companion app, from Apple's public lookup API. (Google Play is not read.)
import { z } from 'zod'
import { config } from '@/pipeline/config'
import { fetchPage } from '@/pipeline/fetch/fetcher'
import { HttpUrl, type Sourced } from '@/src/lib/schema/field'

const Lookup = z.object({ results: z.array(z.object({ version: z.string().min(1), trackViewUrl: HttpUrl })) })

/** The version on the App Store, citing the app's store page; null when there is no such app or the lookup is skipped. */
export async function fetchIosVersion(iosId: string): Promise<Sourced<string> | null> {
  const page = await fetchPage(`${config.itunesLookupUrl}?id=${encodeURIComponent(iosId)}`, { refresh: true })
  if (page.status === 'skipped') {
    console.warn(`iTunes lookup ${iosId} skipped: ${page.reason}${page.detail ? ` (${page.detail})` : ''}`)
    return null
  }
  const [app] = Lookup.parse(JSON.parse(page.text)).results
  if (!app) return null
  return {
    value: app.version,
    quote: app.version,
    sourceUrl: app.trackViewUrl,
    fetchedAt: page.fetchedAt,
    sourceType: 'official',
  }
}
