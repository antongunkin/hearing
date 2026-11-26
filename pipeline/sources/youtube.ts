// Video reviews: found through the official YouTube Data API, watched by Gemini. youtube.com is not scraped.
import { z } from 'zod'
import { config } from '@/pipeline/config'
import { visibleText } from '@/pipeline/fetch/html'
import { llm, type LlmDeps } from '@/pipeline/llm'
import type { Model } from '@/src/lib/schema/model'
import type { Reviews } from '@/src/lib/schema/reviews'
import { productName } from './reviews'

/** The Data API cannot be used: no key, quota spent or request refused. */
export class YouTubeError extends Error {
  override name = 'YouTubeError'
}

const TIMEOUT_MS = 30_000
const RESULTS = 10
const KEPT = 3

const Search = z.object({
  items: z.array(
    z.object({
      id: z.object({ videoId: z.string() }),
      snippet: z.object({ title: z.string(), channelTitle: z.string() }),
    }),
  ),
})
const Statistics = z.object({
  items: z.array(z.object({ id: z.string(), statistics: z.object({ viewCount: z.coerce.number().optional() }) })),
})

async function get(resource: 'search' | 'videos', params: Record<string, string>, send: typeof fetch): Promise<unknown> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new YouTubeError('YOUTUBE_API_KEY is not set')
  const response = await send(`${config.youtubeApiUrl}/${resource}?${new URLSearchParams(params)}`, {
    // In a header, so that the key never appears in a URL.
    headers: { 'x-goog-api-key': key },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new YouTubeError(`YouTube ${resource}: HTTP ${response.status} ${(await response.text()).slice(0, 500)}`)
  }
  return response.json()
}

/** The three most viewed of the first ten search results for a review of the model. */
export async function searchVideos(model: Model, deps: { fetch?: typeof fetch } = {}): Promise<Reviews['videos']> {
  const send = deps.fetch ?? fetch
  const query = {
    part: 'snippet',
    q: `${productName(model)} review`,
    type: 'video',
    maxResults: String(RESULTS),
    relevanceLanguage: 'en',
  }
  const { items } = Search.parse(await get('search', query, send))
  if (items.length === 0) return []

  const ids = items.map((item) => item.id.videoId).join(',')
  const statistics = Statistics.parse(await get('videos', { part: 'statistics', id: ids }, send))
  const views = new Map(statistics.items.map((item) => [item.id, item.statistics.viewCount ?? 0]))

  return items
    .map(({ id: { videoId }, snippet }) => ({
      id: videoId,
      // Search snippets come HTML-escaped ("&#39;").
      channel: visibleText(snippet.channelTitle),
      title: visibleText(snippet.title),
    }))
    .sort((a, b) => (views.get(b.id) ?? 0) - (views.get(a.id) ?? 0))
    .slice(0, KEPT)
}

const VideoPoints = z.strictObject({ pros: z.array(z.string()), cons: z.array(z.string()) })

const PROMPT = `List the pros and cons of the hearing aid that the reviewer states in this video.
Each point is a short phrase in your own words, at most 15 words; do not quote the speaker. Report only what the video says, in the third person (never "tested", "hands-on" or "we wore"). Give empty lists if the video is not a review of a hearing aid.`

/** What Gemini hears the reviewer praise and criticize. */
export async function analyzeVideo(id: string, deps: LlmDeps = {}): Promise<{ pros: string[]; cons: string[] }> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error(`not a YouTube video id: ${id}`)
  return llm(
    { prompt: PROMPT, schema: VideoPoints, provider: 'gemini', youtubeUrl: `https://www.youtube.com/watch?v=${id}` },
    deps,
  )
}
