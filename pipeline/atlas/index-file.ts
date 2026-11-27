// `data/atlas/README.md`: the atlas index, rewritten after every atlas command from the site files on disk.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { readJson } from '@/src/lib/data/load'
import { Brand, type BrandStatus } from '@/src/lib/schema/brand'
import { Description, Sites, SiteReport, type Site } from './schema'

export type IndexEntry = {
  domain: string
  reportAt?: string
  describedAt?: string
  status?: BrandStatus
  summary?: string
  openQuestions: string[]
}

const CANDIDATE_LIMIT = 30
const MIN_LINKS = 3

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

/** A table cell: one line, pipes escaped; a missing value is a dash. */
const cell = (value: string | undefined) => {
  const text = value?.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()
  return text ? text : '-'
}

const day = (iso: string | undefined) => (iso === undefined ? undefined : iso.slice(0, 10))

/** The index text: the rule, one row per site, the candidate domains and how to update the atlas. */
export function renderAtlasIndex(entries: IndexEntry[], candidates: { domain: string; count: number }[]): string {
  const rows = entries.map(
    (entry) =>
      `| [${entry.domain}](sites/${entry.domain}/) | ${cell(day(entry.reportAt))} | ${cell(day(entry.describedAt))} | ` +
      `${cell(entry.status)} | ${cell(entry.summary)} | ${cell(entry.openQuestions.join('; '))} |`,
  )
  return [
    '# Site atlas',
    '',
    'Written by the pipeline after every `atlas:*` command. Do not edit it by hand.',
    '',
    '## How to use the atlas',
    '',
    "Read README.md and notes.md before working with a site in `sites/<domain>/`. Afterwards, append what you learned, dated, to that site's `notes.md`.",
    '',
    '## Sites',
    '',
    '| Site | Report | Described | Brand status | Summary | Open questions |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Candidate domains',
    '',
    "Linked from the reports but not crawled. Add one to `sites.json` only on the owner's word.",
    '',
    ...(candidates.length === 0 ? ['None.'] : candidates.map((candidate) => `- ${candidate.domain} (${candidate.count} links)`)),
    '',
    '## How to update the atlas',
    '',
    '1. `npm run atlas:crawl -- --site <domain>`',
    '2. `npm run atlas:describe`',
    '3. `npm run atlas:relations`',
    '4. Decide the cards on `/review`.',
    '',
  ].join('\n')
}

/** A file that may not exist yet; any other read error is a real problem and is thrown. */
async function readOptional<T>(file: string, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    return await readJson(file, schema)
  } catch (error) {
    if (!isMissing(error)) throw error
    return undefined
  }
}

/** The status of the site's first brand that has a file; a group site or a brand not yet created has none. */
async function statusOf(site: Site, dataDir: string): Promise<BrandStatus | undefined> {
  for (const slug of site.brands) {
    const brand = await readOptional(join(dataDir, 'brands', `${slug}.json`), Brand)
    if (brand) return brand.status
  }
  return undefined
}

const isBlocked = (domain: string, blocklist: string[]) =>
  blocklist.some((blocked) => domain === blocked.toLowerCase() || domain.endsWith(`.${blocked.toLowerCase()}`))

/** Reads the sites, their report and description files and brands, and writes `data/atlas/README.md`. */
export async function writeAtlasIndex(dataDir = 'data'): Promise<void> {
  const sites = await readJson(join(dataDir, 'atlas', 'sites.json'), Sites)
  const blocklist = (await readOptional(join(dataDir, 'blocklist.json'), z.array(z.string()))) ?? []

  const entries: IndexEntry[] = []
  const links = new Map<string, number>()
  for (const site of sites) {
    const dir = join(dataDir, 'atlas', 'sites', site.domain)
    const report = await readOptional(join(dir, 'report.json'), SiteReport)
    const description = await readOptional(join(dir, 'describe.json'), Description)
    for (const link of report?.outbound ?? []) links.set(link.domain, (links.get(link.domain) ?? 0) + link.count)
    entries.push({
      domain: site.domain,
      reportAt: report?.generatedAt,
      describedAt: description?.generatedAt,
      status: await statusOf(site, dataDir),
      summary: description?.summary?.text,
      openQuestions: description?.openQuestions ?? [],
    })
  }

  const known = new Set(sites.map((site) => site.domain))
  const candidates = [...links]
    .filter(([domain, count]) => count >= MIN_LINKS && !known.has(domain) && !isBlocked(domain, blocklist))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, CANDIDATE_LIMIT)
    .map(([domain, count]) => ({ domain, count }))

  await mkdir(join(dataDir, 'atlas'), { recursive: true })
  await writeFile(join(dataDir, 'atlas', 'README.md'), renderAtlasIndex(entries, candidates), 'utf8')
}
