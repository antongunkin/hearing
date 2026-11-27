import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { CompareTable } from '@/src/components/CompareTable'
import { CompareTool } from '@/src/components/CompareTool'
import { ProsCons } from '@/src/components/ProsCons'
import { ReviewSummary } from '@/src/components/ReviewSummary'
import { Brand } from '@/src/lib/schema/brand'
import { Model } from '@/src/lib/schema/model'
import { compareDataJson } from '@/src/lib/site/compare-data'
import { productName } from '@/src/lib/site/product'

const parse = (node: ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(node), 'text/html')

const model = (slug: string, name: string, fields: Record<string, unknown> = {}) =>
  Model.parse({
    slug,
    brand: 'acme',
    name,
    aliases: [],
    type: 'rx',
    sameHardwareAs: [],
    variants: [
      {
        id: 'v',
        formFactor: 'RIC',
        priceUsd: {
          value: 2000,
          sourceUrl: 'https://prices.example/list',
          quote: 'words of the third party',
          fetchedAt: '2026-11-26T00:00:00.000Z',
          sourceType: 'third-party',
        },
      },
    ],
    ...fields,
  })

const one = model('acme-one', 'One')
const two = model('acme-two', 'Two')
const three = model('acme-three', 'Three')

const brand = Brand.parse({
  slug: 'acme',
  name: 'Acme',
  group: 'Acme Group',
  website: 'https://maker.example',
  imageLicense: 'none',
  defaultType: 'rx',
  scraper: { catalogUrls: [], modelUrlPattern: '/x/', render: false },
})

const headings = (el: ParentNode) => [...el.querySelectorAll('thead th')].map((th) => th.textContent)

test('productName is the brand and the model name, and an unlisted brand is an error', () => {
  expect(productName(one, [brand])).toBe('Acme One')
  expect(() => productName(one, [])).toThrow('unknown brand: acme')
})

describe('CompareTable', () => {
  test('heads every variant with its product, and keeps third-party attribution', () => {
    const bare = model('acme-two', 'Two', { variants: [] })
    const page = parse(
      <CompareTable
        products={[
          { model: one, name: 'Acme One' },
          { model: bare, name: 'Acme Two' },
        ]}
      />,
    )

    expect(headings(page)).toEqual(['Specification', 'Acme One · RIC', 'Acme Two · All versions'])
    expect(page.body.textContent).toContain('$2,000According to prices.example')
  })
})

describe('compareDataJson', () => {
  test('carries the models without their quotes, and the curated pairs', () => {
    const json = compareDataJson([two, one], [])

    expect(json).not.toContain('words of the third party')
    const data = JSON.parse(json)
    expect(data.pairs).toEqual(['acme-one-vs-acme-two'])
    expect(data.models.map((m: Model) => m.slug)).toEqual(['acme-two', 'acme-one'])
    expect(data.models[0].variants[0].priceUsd).toMatchObject({ value: 2000, sourceType: 'third-party' })
  })

  test('lists a recorded pair that is no longer among the closest', () => {
    // Twelve alike: the last two are in nobody's top ten, each other's included.
    const twelve = Array.from({ length: 12 }, (_, i) => model(`m-${String(i).padStart(2, '0')}`, `M${i}`))
    const pairs = (stored: string[]) => JSON.parse(compareDataJson(twelve, stored)).pairs

    expect(pairs([])).not.toContain('m-10-vs-m-11')
    expect(pairs(['m-10-vs-m-11'])).toContain('m-10-vs-m-11')
  })
})

describe('two models on one page', () => {
  test('review and pros-and-cons headings name their product and keep ids apart', () => {
    const customer = [{ sourceUrl: 'https://shop.example/p', rating: 4, count: 3, fetchedAt: '2026-11-20T00:00:00.000Z' }]
    const prosCons = { pros: [{ text: 'Long battery', sources: ['https://review.example/a'] }], cons: [] }
    const page = parse(
      <>
        {['Acme One', 'Acme Two'].map((product) => (
          <div key={product}>
            <ReviewSummary customer={customer} complaintThemes={[]} product={product} />
            <ProsCons prosCons={prosCons} product={product} />
          </div>
        ))}
      </>,
    )
    const sections = [...page.querySelectorAll('section')]
    const labels = sections.map((section) => page.getElementById(section.getAttribute('aria-labelledby')!)?.textContent)

    expect(labels).toEqual([
      'Customer reviews: Acme One',
      'Pros and cons: Acme One',
      'Customer reviews: Acme Two',
      'Pros and cons: Acme Two',
    ])
    expect(new Set([...page.querySelectorAll('[id]')].map((el) => el.id)).size).toBe(4)
  })

  test('without a product the headings stay as on the model page', () => {
    const page = parse(<ProsCons prosCons={{ pros: [{ text: 'x', sources: [] }], cons: [] }} />)

    expect(page.querySelector('h2')?.textContent).toBe('Pros and cons')
  })
})

describe('CompareTool', () => {
  const options: [string, string][] = [
    ['acme-one', 'Acme One'],
    ['acme-three', 'Acme Three'],
    ['acme-two', 'Acme Two'],
  ]
  // Only one of the three pairs is curated here.
  const data = JSON.stringify({ models: [one, two, three], pairs: ['acme-one-vs-acme-two'] })
  const fetched = vi.fn<typeof fetch>()

  let root: Root | undefined
  beforeAll(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', fetched)
  })
  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    document.body.innerHTML = ''
    fetched.mockReset()
  })

  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

  async function open(query = '') {
    window.history.replaceState(null, '', `/compare${query}`)
    fetched.mockImplementation(async () => new Response(data))
    const container = document.body.appendChild(document.createElement('div'))
    act(() => {
      root = createRoot(container)
      root.render(<CompareTool options={options} />)
    })
    await settle()
    return container
  }

  const selects = (container: Element) => [...container.querySelectorAll('select')]
  async function choose(select: HTMLSelectElement, value: string) {
    act(() => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
  }
  const canonicalLink = (container: Element) => container.querySelector('a[href^="/compare/"]')

  test('fetches nothing until two models are chosen', async () => {
    const container = await open()

    await choose(selects(container)[0], 'acme-one')

    expect(fetched).not.toHaveBeenCalled()
    expect(container.querySelector('table')).toBeNull()
    expect(window.location.search).toBe('?a=acme-one')
  })

  test('shows the pair of the URL and links the page of a curated pair, in either order', async () => {
    const container = await open('?a=acme-two&b=acme-one')

    expect(fetched).toHaveBeenCalledExactlyOnceWith('/compare/models.json')
    expect(selects(container).map((s) => s.value)).toEqual(['acme-two', 'acme-one'])
    expect(headings(container)).toEqual(['Specification', 'Acme Two · RIC', 'Acme One · RIC'])
    expect(canonicalLink(container)?.getAttribute('href')).toBe('/compare/acme-one-vs-acme-two')
  })

  test('follows the choice, links no page for an uncurated pair, and fetches once', async () => {
    const container = await open('?a=acme-one&b=acme-two')

    await choose(selects(container)[1], 'acme-three')

    expect(window.location.search).toBe('?a=acme-one&b=acme-three')
    expect(headings(container)).toEqual(['Specification', 'Acme One · RIC', 'Acme Three · RIC'])
    expect(canonicalLink(container)).toBeNull()
    expect(fetched).toHaveBeenCalledTimes(1)
  })

  test('ignores an unknown model in the URL and refuses a model against itself', async () => {
    const container = await open('?a=nope&b=acme-one')

    expect(selects(container).map((s) => s.value)).toEqual(['', 'acme-one'])
    await choose(selects(container)[0], 'acme-one')

    expect(container.textContent).toContain('Choose two different models.')
    expect(container.querySelector('table')).toBeNull()
    expect(fetched).not.toHaveBeenCalled()
  })

  test('says when the data does not load, and can try again', async () => {
    window.history.replaceState(null, '', '/compare?a=acme-one&b=acme-two')
    fetched.mockResolvedValueOnce(new Response('gone', { status: 404 })).mockResolvedValueOnce(new Response(data))
    const container = document.body.appendChild(document.createElement('div'))
    act(() => {
      root = createRoot(container)
      root.render(<CompareTool options={options} />)
    })
    await settle()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded')
    act(() => container.querySelector('button')!.click())
    await settle()

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('table')).not.toBeNull()
  })
})
