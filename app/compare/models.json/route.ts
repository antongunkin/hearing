// The data of the compare tool, written at build time and fetched when two models are chosen.
import { loadDataset } from '@/src/lib/data/load'
import { compareDataJson } from '@/src/lib/site/compare-data'

export const dynamic = 'force-static'

export async function GET() {
  const { models } = await loadDataset()
  return new Response(compareDataJson(models), { headers: { 'content-type': 'application/json' } })
}
