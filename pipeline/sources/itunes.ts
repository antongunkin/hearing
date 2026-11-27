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

export type AppRecord = { iosId: string; name: string; seller: string; url: string; lookupUrl: string; fetchedAt: string }

const AppLookup = z.object({
  resultCount: z.number(),
  results: z.array(z.object({ trackName: z.string().min(1), sellerName: z.string().min(1), trackViewUrl: HttpUrl })),
})

/** The App Store's record of an app; 'removed' when the store has no such app; null when the lookup is skipped. */
export async function lookupApp(iosId: string): Promise<AppRecord | 'removed' | null> {
  const lookupUrl = `${config.itunesLookupUrl}?id=${encodeURIComponent(iosId)}`
  const page = await fetchPage(lookupUrl, { refresh: true })
  if (page.status === 'skipped') {
    console.warn(`iTunes lookup ${iosId} skipped: ${page.reason}${page.detail ? ` (${page.detail})` : ''}`)
    return null
  }
  const reply = AppLookup.parse(JSON.parse(page.text))
  if (reply.resultCount === 0) return 'removed'
  const [app] = reply.results
  if (!app) return null
  return {
    iosId,
    name: app.trackName,
    seller: app.sellerName,
    url: app.trackViewUrl,
    lookupUrl,
    fetchedAt: page.fetchedAt,
  }
}
