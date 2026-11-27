// The files `atlas:describe` keeps for a site under `data/atlas/sites/<domain>/`, and the brand config and
// relations it queues for /review.
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { enqueue, route } from '@/pipeline/apply'
import { citableArchiveUrl } from '@/src/lib/archive-url'
import { readJson, type Dataset } from '@/src/lib/data/load'
import { writeJson } from '@/src/lib/data/write'
import { Brand } from '@/src/lib/schema/brand'
import type { CandidateChange } from '@/src/lib/schema/pending'
import type { DescribeResult } from './describe'
import { queueRelation } from './relation'
import { SECTION_HEADINGS, SECTION_KEYS, type Description, type LogRef, type Site, type Statement } from './schema'

/** The new brand a site with `newBrand` stands for, before any proposal. */
export function newBrandOf(site: Site): Brand | undefined {
  if (!site.newBrand) return undefined
  return {
    ...site.newBrand,
    website: site.start,
    imageLicense: 'none',
    status: 'active',
    scraper: { catalogUrls: [], modelUrlPattern: '', render: false },
  }
}

/**
 * The site README: the summary (when verified), one section per key in order, each statement with numbered links to its
 * sources, and the sources as footnotes. A Web Archive copy is linked in the form a reader opens.
 */
export function renderSiteReadme(site: Site, description: Description): string {
  const notes: LogRef[] = []
  const number = (ref: LogRef) => {
    let index = notes.findIndex((note) => note.url === ref.url && note.fetchedAt === ref.fetchedAt)
    if (index === -1) index = notes.push(ref) - 1
    return index + 1
  }
  const cited = (statement: Statement) => `${statement.text} ${statement.sources.map((ref) => `[${number(ref)}]`).join(' ')}`
  // A summary none of whose sources passed is left out, not printed unverified.
  const lines = [`# ${site.domain}`, ...(description.summary ? ['', cited(description.summary)] : [])]
  for (const key of SECTION_KEYS) {
    lines.push('', `## ${SECTION_HEADINGS[key]}`, '')
    const statements = description.sections[key]
    if (statements.length === 0) lines.push('Nothing verified yet.')
    for (const statement of statements) lines.push(`- ${cited(statement)}`)
  }
  if (notes.length > 0) {
    lines.push('', ...notes.map((ref, i) => `[${i + 1}]: ${citableArchiveUrl(ref.url)} (fetched ${ref.fetchedAt})`))
  }
  return `${lines.join('\n')}\n`
}

/** Writes through a temp file and rename, so readers never see a partial file. */
async function writeText(path: string, text: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/** The notes file agents keep for the site; created once, never written again by the pipeline. */
async function createNotes(dir: string, site: Site): Promise<void> {
  const text = `# ${site.domain}: notes

Read README.md and notes.md before working with this site; append what you learn, with the date.

## Log

Started ${new Date().toISOString().slice(0, 10)}. Add entries below as \`- YYYY-MM-DD: what was tried and what came of it\`.
`
  try {
    await writeFile(join(dir, 'notes.md'), text, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * The `brand-config` change for the site's one brand: the stored brand (or the new brand of `newBrand`)
 * with the proposal's scraper, archive and status. Null for a site of several brands or none.
 */
export function brandConfigChange(
  site: Site,
  result: Pick<DescribeResult, 'proposal' | 'checks' | 'keyPages'>,
  dataset: Dataset,
): CandidateChange | null {
  const { proposal, checks, keyPages } = result
  if (!proposal) return null
  const slug = site.brands.length === 1 ? site.brands[0] : site.brands.length === 0 ? site.newBrand?.slug : undefined
  const stored = dataset.brands.find((brand) => brand.slug === slug)
  const base = stored ?? (site.newBrand?.slug === slug ? newBrandOf(site) : undefined)
  if (slug === undefined || base === undefined) return null

  const { archive: _archive, ...rest } = base
  const after = Brand.parse({
    ...rest,
    status: proposal.status,
    scraper: {
      catalogUrls: proposal.catalogUrls,
      supportUrls: proposal.supportUrls,
      modelUrlPattern: proposal.modelUrlPattern,
      ...(proposal.documentUrlPattern !== undefined && { documentUrlPattern: proposal.documentUrlPattern }),
      render: proposal.render,
    },
    ...(proposal.archive && { archive: proposal.archive }),
  })
  return {
    kind: 'brand-config',
    modelSlug: null,
    path: `brands/${slug}`,
    ...(stored && { before: stored }),
    after,
    checks,
    refs: [`data/atlas/sites/${site.domain}/report.json`, ...keyPages.map(citableArchiveUrl)],
  }
}

/**
 * Writes the site's `describe.json`, `README.md`, `config-proposal.json` and (when missing) `notes.md`, and
 * queues the brand config and the relations for /review. Returns what was queued and what was not.
 */
export async function saveDescription(
  site: Site,
  result: DescribeResult,
  { dataset, dataDir }: { dataset: Dataset; dataDir: string },
): Promise<{ proposal: 'queued' | 'dropped' | 'none'; relations: { queued: number; dropped: number } }> {
  const dir = join(dataDir, 'atlas', 'sites', site.domain)
  await mkdir(dir, { recursive: true })
  await writeJson(join(dir, 'describe.json'), result.description)
  await writeText(join(dir, 'README.md'), renderSiteReadme(site, result.description))
  await writeJson(join(dir, 'config-proposal.json'), {
    generatedAt: result.description.generatedAt,
    proposal: result.proposal,
    checks: result.checks,
  })
  await createNotes(dir, site)

  let proposal: 'queued' | 'dropped' | 'none' = 'none'
  // /review may have rejected something since the run loaded `dataset`.
  dataset.rejections = await readJson(join(dataDir, 'rejections.json'), z.array(z.string()))
  const change = brandConfigChange(site, result, dataset)
  if (change) {
    proposal = route(change, dataset.rejections) === 'drop' ? 'dropped' : 'queued'
    if (proposal === 'queued') await enqueue(change, dataDir)
  }
  const relations = { queued: 0, dropped: 0 }
  for (const rel of result.relations) relations[await queueRelation(rel, dataset, dataDir)]++
  return { proposal, relations }
}
