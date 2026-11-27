// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { renderAtlasIndex, writeAtlasIndex, type IndexEntry } from '@/pipeline/atlas/index-file'

const entry: IndexEntry = {
  domain: 'phonak.com',
  reportAt: '2026-11-27T10:00:00.000Z',
  describedAt: '2026-11-27T11:00:00.000Z',
  status: 'active',
  summary: 'Phonak makes hearing aids.',
  openQuestions: ['Which models are discontinued?'],
}

test('the index has one row per site, the rule, candidates and the update section', () => {
  const text = renderAtlasIndex([entry], [{ domain: 'cdn.example', count: 4 }])
  expect(text).toContain('Read README.md and notes.md')
  expect(text).toContain('| [phonak.com](sites/phonak.com/) |')
  expect(text).toContain('| 2026-11-27 | 2026-11-27 | active | Phonak makes hearing aids. | Which models are discontinued? |')
  expect(text).toContain('cdn.example (4 links)')
  expect(text).toContain('## How to update the atlas')
})

test('a site without a report or description shows dashes', () => {
  const text = renderAtlasIndex([{ domain: 'new.example', openQuestions: [] }], [])
  expect(text).toContain('| [new.example](sites/new.example/) | - | - | - | - | - |')
})

test('table cells escape pipes and line breaks', () => {
  const text = renderAtlasIndex([{ ...entry, summary: 'a | b\nc', openQuestions: [] }], [])
  expect(text).toContain('a \\| b c')
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atlas-index-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const reportWith = (domain: string, generatedAt: string, outbound: { domain: string; count: number; examples: string[] }[]) => ({
  domain,
  generatedAt,
  mode: 'live',
  start: `https://${domain}/`,
  budget: 60,
  robots: { ref: null, status: null, sitemaps: [], groups: [] },
  sitemap: { refs: [], urlCount: 0, sections: [] },
  pages: [],
  templates: [],
  outbound,
  redirects: [],
  pdfHosts: [],
  archive: { sections: [] },
  failures: [],
  urls: [],
})

async function put(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

test('writeAtlasIndex reads the sites, reports, descriptions and brands and skips listed and blocked candidates', async () => {
  const data = join(dir, 'data')
  const siteDir = (domain: string) => join(data, 'atlas', 'sites', domain)
  await put(join(data, 'atlas', 'sites.json'), [
    { domain: 'phonak.com', start: 'https://www.phonak.com/', kind: 'brand', mode: 'live', brands: ['phonak'] },
    { domain: 'gn.com', start: 'https://www.gn.com/', kind: 'group', mode: 'live', brands: [], company: 'GN' },
  ])
  await put(join(data, 'brands', 'phonak.json'), {
    slug: 'phonak',
    name: 'Phonak',
    group: 'Sonova',
    website: 'https://www.phonak.com/en-us',
    defaultType: 'rx',
    imageLicense: 'none',
    status: 'active',
    scraper: { catalogUrls: [], modelUrlPattern: '^https://www\\.phonak\\.com/x$', render: false },
  })
  await put(join(siteDir('phonak.com'), 'report.json'), reportWith('phonak.com', '2026-11-27T10:00:00.000Z', [
      { domain: 'cdn.example', count: 2, examples: [] },
      { domain: 'shop.example', count: 5, examples: [] },
      { domain: 'low.example', count: 2, examples: [] },
  ]))
  await put(join(siteDir('gn.com'), 'report.json'), reportWith('gn.com', '2026-11-27T09:00:00.000Z', [
      { domain: 'cdn.example', count: 2, examples: [] },
      { domain: 'shop.example', count: 1, examples: [] },
  ]))
  await put(join(siteDir('phonak.com'), 'describe.json'), {
    domain: 'phonak.com',
    generatedAt: '2026-11-27T11:00:00.000Z',
    model: 'sonnet',
    summary: { text: 'Phonak makes hearing aids.', sources: [{ url: 'https://www.phonak.com/', fetchedAt: '2026-11-27T10:00:00.000Z' }] },
    sections: { what: [], structure: [], where: [], render: [], links: [], archive: [], next: [] },
    openQuestions: ['Which models are discontinued?'],
  })
  await put(join(data, 'blocklist.json'), ['shop.example'])

  await writeAtlasIndex(data)

  const text = await readFile(join(data, 'atlas', 'README.md'), 'utf8')
  expect(text).toContain('| [gn.com](sites/gn.com/) | 2026-11-27 | - | - | - | - |')
  expect(text).toContain('| [phonak.com](sites/phonak.com/) | 2026-11-27 | 2026-11-27 | active | Phonak makes hearing aids. | Which models are discontinued? |')
  expect(text).toContain('cdn.example (4 links)')
  expect(text).not.toContain('shop.example (')
  expect(text).not.toContain('low.example')
})
