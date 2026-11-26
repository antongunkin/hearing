// Video reviews: found through the official YouTube Data API, watched by Gemini. youtube.com is not scraped.
import { z } from 'zod'
import { config } from '@/pipeline/config'
import { visibleText } from '@/pipeline/fetch/html'
import { llm, type LlmDeps } from '@/pipeline/llm'
import { namesModel } from '@/src/lib/data/slug'
import type { Model } from '@/src/lib/schema/model'
import type { Reviews } from '@/src/lib/schema/reviews'
import { publishablePoints } from './pros-cons'
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
      snippet: z.object({ title: z.string(), channelTitle: z.string(), description: z.string().default('') }),
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

/**
 * Of the first ten search results for a review of the model, those whose title or description names it,
 * and of these the three most viewed.
 */
export async function searchVideos(model: Model, deps: { fetch?: typeof fetch } = {}): Promise<Reviews['videos']> {
  const send = deps.fetch ?? fetch
  const query = {
    part: 'snippet',
    q: `${productName(model)} review`,
    type: 'video',
    maxResults: String(RESULTS),
    relevanceLanguage: 'en',
  }
  const found = Search.parse(await get('search', query, send))
  // Search snippets come HTML-escaped ("&#39;"). Views say nothing about which model a video is about.
  const items = found.items
    .map(({ id, snippet }) => ({
      id: id.videoId,
      channel: visibleText(snippet.channelTitle),
      title: visibleText(snippet.title),
      description: visibleText(snippet.description),
    }))
    .filter((video) => namesModel(`${video.title}\n${video.description}`, model))
  if (items.length === 0) return []

  const ids = items.map((video) => video.id).join(',')
  const statistics = Statistics.parse(await get('videos', { part: 'statistics', id: ids }, send))
  const views = new Map(statistics.items.map((item) => [item.id, item.statistics.viewCount ?? 0]))

  return items
    .sort((a, b) => (views.get(b.id) ?? 0) - (views.get(a.id) ?? 0))
    .slice(0, KEPT)
    .map(({ id, channel, title }) => ({ id, channel, title }))
}

const VideoPoints = z.strictObject({ reviewsThisModel: z.boolean(), pros: z.array(z.string()), cons: z.array(z.string()) })

/** What Gemini hears the reviewer praise and criticize about this model; empty lists for any other video. */
export async function analyzeVideo(id: string, model: Model, deps: LlmDeps = {}): Promise<{ pros: string[]; cons: string[] }> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error(`not a YouTube video id: ${id}`)
  const prompt = `The video may be a review of the hearing aid "${productName(model)}".
- reviewsThisModel: true only if the video reviews this exact model, not only another model (such as its predecessor or a sibling) or a whole brand.
- pros, cons: what the reviewer says is good and bad about this model, not about models it is compared with. Each a short phrase in your own words, at most 15 words; do not quote the speaker.
Report only what the video says, in the third person (never "tested", "hands-on" or "we wore").`
  const out = await llm(
    { prompt, schema: VideoPoints, provider: 'gemini', youtubeUrl: `https://www.youtube.com/watch?v=${id}` },
    deps,
  )
  if (!out.reviewsThisModel) return { pros: [], cons: [] }
  // No transcript to compare with, so only the length and wording limits apply.
  return { pros: publishablePoints(out.pros), cons: publishablePoints(out.cons) }
}
