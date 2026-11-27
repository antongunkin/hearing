// `npm run atlas:crawl|atlas:describe|atlas:relations`: the site atlas, one site at a time. A run stopped by a
// usage limit or by the Web Archive's refusal goes on with `--resume` (the message prints the command). A site
// that refuses stops only itself: the run goes on with the next site, and `--site <domain>` tries it again.
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { RAW_DIR, readLog } from '@/pipeline/fetch/raw-store'
import { Progress } from '@/pipeline/progress'
import { LlmLimitError } from '@/pipeline/llm'
import { loadDataset, readJson, type Dataset } from '@/src/lib/data/load'
import { slugify } from '@/src/lib/data/slug'
import { writeJson } from '@/src/lib/data/write'
import { Brand } from '@/src/lib/schema/brand'
import { ArchiveRefusedError, crawlSite, SiteRefusedError } from './crawl'
import { describeSite } from './describe'
import { readGraph, upsertEntity, writeGraph } from './graph-store'
import { writeAtlasIndex } from './index-file'
import { queueRelation, type ProposedRelation } from './relation'
import { appPublishers, fdaApplicants, RelationSourceError, searchClaims } from './relations'
import { SiteReport, Sites, type Site } from './schema'
import { saveDescription } from './site-files'

const COMMANDS = ['crawl', 'describe', 'relations'] as const

export type AtlasOptions = { dataDir?: string; progressDir?: string; rawDir?: string }

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

/** The brand files of the site's brands; a slug without a file (a brand not yet created) is left out. */
async function brandsOf(site: Site, dataDir: string): Promise<Brand[]> {
  const found: Brand[] = []
  for (const slug of site.brands) {
    try {
      found.push(await readJson(join(dataDir, 'brands', `${slug}.json`), Brand))
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  return found
}

/** `describe` for one site; false when the site has no report yet (skipped with a message). */
async function describeOne(site: Site, ctx: { dataset: Dataset; dataDir: string; rawDir: string }): Promise<boolean> {
  const { dataset, dataDir, rawDir } = ctx
  let report: SiteReport
  try {
    report = await readJson(join(dataDir, 'atlas', 'sites', site.domain, 'report.json'), SiteReport)
  } catch (error) {
    if (!isMissing(error)) throw error
    console.warn(`${site.domain}: no report.json, skipped (run atlas:crawl first)`)
    return false
  }
  const result = await describeSite(site, report, { dataset, log: await readLog(rawDir), rawDir })
  const queued = await saveDescription(site, result, { dataset, dataDir })
  for (const line of result.dropped) console.warn(`${site.domain}: dropped ${line}`)
  const kept = Object.values(result.description.sections).flat().length
  console.log(
    `${site.domain}: ${kept} statements (${result.dropped.length} dropped), brand config ${queued.proposal}, ` +
      `relations ${queued.relations.queued} queued, ${queued.relations.dropped} dropped`,
  )
  return true
}

/** `relations` for the brands and group companies of the chosen sites, then (on a full run) the FDA applicants. */
async function relationsRun(chosen: Site[], ctx: { sites: Site[]; dataset: Dataset; dataDir: string; progress: Progress; rawDir: string; all: boolean; refresh: boolean }) {
  const { sites, dataset, dataDir, progress, rawDir, all, refresh } = ctx
  console.log('SEC skipped: the pipeline sends no contact header, so EDGAR is not asked')
  const queue = async (relations: ProposedRelation[]) => {
    let queued = 0
    for (const rel of relations) if ((await queueRelation(rel, dataset, dataDir)) === 'queued') queued++
    return queued
  }
  const search = { brands: dataset.brands, sites, refresh }

  const units = new Map<string, { name: string; kind: 'brand' | 'company'; brand?: Brand }>()
  for (const site of chosen) {
    for (const slug of site.brands) {
      const brand = dataset.brands.find((candidate) => candidate.slug === slug)
      if (brand) units.set(`brand:${slug}`, { name: brand.name, kind: 'brand', brand })
    }
    if (site.company) units.set(`company:${slugify(site.company)}`, { name: site.company, kind: 'company' })
  }
  for (const [key, { name, kind, brand }] of units) {
    if (progress.has(key)) continue
    const relations = await searchClaims({ name, kind }, search)
    for (const site of brand ? sites.filter((candidate) => candidate.brands.includes(brand.slug)) : []) {
      let report: SiteReport
      try {
        report = await readJson(join(dataDir, 'atlas', 'sites', site.domain, 'report.json'), SiteReport)
      } catch (error) {
        if (!isMissing(error)) throw error
        continue
      }
      relations.push(...(await appPublishers(report, brand!, rawDir)))
    }
    const queued = await queue(relations)
    console.log(`${key}: ${relations.length} relations found, ${queued} queued`)
    await progress.done(key)
  }
  if (all && !progress.has('fda-applicants')) {
    const { entities, relations } = await fdaApplicants(dataset.brands, rawDir)
    // The applicants are part of the graph even where no brand matches them.
    await writeGraph(entities.reduce(upsertEntity, await readGraph(dataDir)), dataDir)
    const queued = await queue(relations)
    console.log(`fda-applicants: ${entities.length} applicants, ${relations.length} relations found, ${queued} queued`)
    await progress.done('fda-applicants')
  }
}

/** The progress key of a site that refused: a later `--resume` skips it; `--site <domain>` tries it again. */
const refusedKey = (domain: string) => `refused:${domain}`

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Runs a command; resolves to the exit code: 0 done; 1 bad arguments, or a site could not be read or described
 * (no page read, no report yet, or a failed describe call); 2 a site refused, or the run was stopped by the usage
 * limit or the Web Archive's refusal.
 */
export async function atlasMain(argv: string[], opts: AtlasOptions = {}): Promise<number> {
  const { dataDir = 'data', progressDir = '.cache/progress', rawDir = RAW_DIR } = opts
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { site: { type: 'string' }, resume: { type: 'boolean', default: false }, refresh: { type: 'boolean', default: false } },
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
  const { positionals, values } = parsed
  const command = positionals[0] as (typeof COMMANDS)[number] | undefined
  if (!command || !COMMANDS.includes(command) || positionals.length > 1) {
    console.error(
      `Usage: cli.ts <${COMMANDS.join('|')}> [--site <domain>] [--resume] [--refresh]\n` +
        'Exit codes: 0 done; 1 bad arguments, or a site could not be read or described; ' +
        '2 a site refused (try it again with --site), or the run was stopped by the usage limit or the Web Archive (go on with --resume).',
    )
    return 1
  }
  const sites = await readJson(join(dataDir, 'atlas', 'sites.json'), Sites)
  const chosen = values.site === undefined ? sites : sites.filter((site) => site.domain === values.site)
  if (chosen.length === 0) {
    console.error(`Unknown site: ${values.site}`)
    return 1
  }

  // A run limited to one site keeps its own record: it must not clear the finished units of a stopped full run.
  const unit = values.site === undefined ? '' : `-${values.site}`
  const progress = await Progress.open(join(progressDir, `atlas-${command}${unit}.json`), values.resume)
  const failed: string[] = []
  const refused: string[] = []
  let dataset: Dataset | undefined
  const extra = values.refresh ? ' --refresh' : ''
  const refusedHint = () =>
    refused.length === 0
      ? ''
      : `. Refused: ${refused.join(', ')}; try each again later: ${refused.map((domain) => `npm run atlas:${command} -- --site ${domain}${extra}`).join('; ')}`
  /** A site refused: recorded, so that `--resume` skips it, and the run goes on. */
  const refuse = async (domain: string, error: SiteRefusedError) => {
    console.warn(`${domain}: ${error.message}; this site is stopped, the run goes on`)
    refused.push(domain)
    await progress.done(refusedKey(domain))
  }
  try {
    if (command === 'relations') {
      dataset ??= await loadDataset(dataDir)
      await relationsRun(chosen, { sites, dataset, dataDir, progress, rawDir, all: values.site === undefined, refresh: values.refresh })
    }
    for (const site of command === 'relations' ? [] : chosen) {
      if (progress.has(site.domain)) continue
      if (progress.has(refusedKey(site.domain))) {
        refused.push(site.domain)
        continue
      }
      if (command === 'describe') {
        dataset ??= await loadDataset(dataDir)
        try {
          if (await describeOne(site, { dataset, dataDir, rawDir })) await progress.done(site.domain)
          else failed.push(site.domain)
        } catch (error) {
          // The usage limit and the Web Archive stop the run; anything else stops only this site.
          if (error instanceof LlmLimitError || error instanceof ArchiveRefusedError) throw error
          if (error instanceof SiteRefusedError) await refuse(site.domain, error)
          else {
            console.error(`${site.domain}: describe failed: ${message(error)}`)
            failed.push(site.domain)
          }
        }
        continue
      }
      const { report, graph, refused: refusal } = await crawlSite(site, sites, { refresh: values.refresh, brands: await brandsOf(site, dataDir) })
      const reportFile = join(dataDir, 'atlas', 'sites', site.domain, 'report.json')
      if (refusal) {
        // What was read before the refusal is written, unless it is nothing and there is an older report.
        if (report.pages.length > 0 || !(await exists(reportFile))) {
          await writeJson(reportFile, report)
          await writeGraph(graph(await readGraph(dataDir)), dataDir)
        } else console.warn(`${site.domain}: no page was read before the refusal; report kept as it was`)
        await refuse(site.domain, refusal)
        continue
      }
      if (report.pages.length === 0) {
        // Nothing was read: the old report is better than an empty one, and the unit stays open.
        console.warn(`${site.domain}: no page could be read (${report.failures.length} failures); report kept as it was`)
        failed.push(site.domain)
        continue
      }
      // Only a finished crawl replaces the old report.
      await writeJson(reportFile, report)
      await writeGraph(graph(await readGraph(dataDir)), dataDir)
      await progress.done(site.domain)
      console.log(`${site.domain}: ${report.pages.length} pages, ${report.failures.length} failures`)
    }
  } catch (error) {
    if (!(error instanceof ArchiveRefusedError || error instanceof LlmLimitError || error instanceof RelationSourceError)) throw error
    const flags = ['--resume', ...(values.site ? ['--site', values.site] : []), ...(values.refresh ? ['--refresh'] : [])]
    console.error(`${error.message}. Resume later: npm run atlas:${command} -- ${flags.join(' ')}${refusedHint()}`)
    await writeAtlasIndex(dataDir)
    return 2
  }
  await writeAtlasIndex(dataDir)
  if (failed.length > 0) console.error(`Not done: ${failed.join(', ')}. Run again with --resume after fixing the cause.`)
  if (refused.length > 0) {
    console.error(`Stopped by refusals${refusedHint()}`)
    return 2
  }
  if (failed.length > 0) return 1
  await progress.clear()
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.loadEnvFile('.env.local')
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  process.exitCode = await atlasMain(process.argv.slice(2))
}
