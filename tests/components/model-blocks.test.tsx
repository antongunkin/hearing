import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { AdSlot } from '@/src/components/AdSlot'
import { BuyBoxSlot } from '@/src/components/BuyBoxSlot'
import { CatalogFilters } from '@/src/components/CatalogFilters'
import { ProsCons } from '@/src/components/ProsCons'
import { ReviewSummary } from '@/src/components/ReviewSummary'
import { YouTubeEmbed } from '@/src/components/YouTubeEmbed'
import { Model } from '@/src/lib/schema/model'
import { buildCatalogIndex, type CatalogItem } from '@/src/lib/site/catalog-index'

const parse = (node: ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(node), 'text/html')

let root: Root | undefined
beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})
function mount(node: ReactElement) {
  const container = document.body.appendChild(document.createElement('div'))
  act(() => {
    root = createRoot(container)
    root.render(node)
  })
  return container
}

describe('reserved slots', () => {
  test('AdSlot holds a fixed height and shows nothing', () => {
    const slot = parse(<AdSlot id="model-top" minHeight={280} />).body.firstElementChild as HTMLElement

    expect(slot.style.height).toBe('280px')
    expect(slot.textContent).toBe('')
    expect(slot.getAttribute('data-ad-slot')).toBe('model-top')
  })

  test('BuyBoxSlot is reserved for every type but rx', () => {
    expect(renderToStaticMarkup(<BuyBoxSlot type="rx" />)).toBe('')
    for (const type of ['otc', 'consumer'] as const) {
      const slot = parse(<BuyBoxSlot type={type} />).body.firstElementChild
      expect(slot?.className).toBe('buy-box')
      expect(slot?.textContent).toBe('')
    }
  })
})

describe('ReviewSummary', () => {
  const customer = [
    { sourceUrl: 'https://shop-a.example/p', rating: 4.6, count: 1248, fetchedAt: '2026-11-20T00:00:00.000Z' },
    { sourceUrl: 'https://shop-b.example/p', rating: 3.2, count: 1, fetchedAt: '2026-11-21T00:00:00.000Z' },
  ]
  const complaintThemes = [{ theme: 'sound-quality', share: 0.234, n: 41, of: 175 }]

  test('lists each source with its own rating, and themes by share with how many reviews they come from', () => {
    const page = parse(<ReviewSummary customer={customer} complaintThemes={complaintThemes} />)
    const text = page.body.textContent!

    expect([...page.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('a')?.getAttribute('href'))).toEqual([
      'https://shop-a.example/p',
      'https://shop-b.example/p',
    ])
    expect(text).toContain('4.6 out of 5')
    expect(text).toContain('1,248')
    expect(text).toContain('Sound quality')
    expect(text).toContain('23%')
    expect(text).toContain('41 of 175 reviews')
    // No average across sources: 3.9 would be the mean of the two.
    expect(text).not.toContain('3.9')
    expect(page.body.innerHTML).not.toMatch(/itemprop|aggregate/i)
  })

  test('renders nothing without ratings or themes', () => {
    expect(renderToStaticMarkup(<ReviewSummary customer={[]} complaintThemes={[]} />)).toBe('')
  })
})

describe('ProsCons', () => {
  test('is captioned and links the sources of every point', () => {
    const page = parse(
      <ProsCons prosCons={{ pros: [{ text: 'Long battery', sources: ['https://review.example/a'] }], cons: [] }} />,
    )

    expect(page.body.textContent).toContain('Based on published reviews and customer feedback')
    expect(page.querySelector('li')?.textContent).toContain('Long battery')
    expect(page.querySelector('li a')?.getAttribute('href')).toBe('https://review.example/a')
    // No heading over an empty list.
    expect([...page.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Pros'])
  })

  test('renders nothing without points', () => {
    expect(renderToStaticMarkup(<ProsCons prosCons={null} />)).toBe('')
    expect(renderToStaticMarkup(<ProsCons prosCons={{ pros: [], cons: [] }} />)).toBe('')
  })
})

describe('YouTubeEmbed', () => {
  test('loads the player from youtube-nocookie.com only on click', () => {
    const container = mount(<YouTubeEmbed video={{ id: 'abc123', title: 'A review', channel: 'A channel' }} />)

    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('A channel')
    act(() => container.querySelector('button')!.click())

    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc123?autoplay=1')
    expect(container.querySelector('iframe')?.getAttribute('title')).toBe('A review')
  })
})

describe('CatalogFilters', () => {
  const item = (fields: Partial<CatalogItem> & { slug: string; name: string }): CatalogItem => ({
    brand: 'acme',
    type: 'otc',
    formFactors: [],
    powerTypes: [],
    connectivity: {},
    ...fields,
  })
  const items = [
    item({ slug: 'acme-a', name: 'Alpha', formFactors: ['RIC'], priceMin: 900, releaseDate: '2024-05' }),
    item({ slug: 'acme-b', name: 'Beta', type: 'rx', formFactors: ['BTE'], releaseDate: '2025-05' }),
  ]
  const links = (container: Element) => [...container.querySelectorAll('tbody a')].map((a) => a.getAttribute('href'))
  const box = (container: Element, label: string) =>
    [...container.querySelectorAll('label')].find((l) => l.textContent === label)!.querySelector('input')!

  test('lists every model newest first and narrows as boxes are ticked', () => {
    const container = mount(<CatalogFilters items={items} brandNames={{ acme: 'Acme' }} />)

    expect(links(container)).toEqual(['/hearing-aids/acme-b', '/hearing-aids/acme-a'])
    expect(container.textContent).toContain('2 of 2 models')

    act(() => box(container, 'RIC').click())
    expect(links(container)).toEqual(['/hearing-aids/acme-a'])
    expect(container.textContent).toContain('1 of 2 models')

    act(() => box(container, 'Prescription').click())
    expect(links(container)).toEqual([])
    expect(container.textContent).toContain('No models match these filters.')

    act(() => container.querySelector<HTMLButtonElement>('button[type="reset"]')!.click())
    expect(links(container)).toHaveLength(2)
    expect(box(container, 'RIC').checked).toBe(false)
  })

  test('names the third party beside its price, and only there', () => {
    const priced = (slug: string, type: 'rx' | 'otc', sourceType: 'official' | 'third-party', value: unknown) =>
      Model.parse({
        slug,
        brand: 'acme',
        name: slug,
        aliases: [],
        type,
        sameHardwareAs: [],
        variants: [
          {
            id: 'v',
            formFactor: 'RIC',
            priceUsd: {
              value,
              sourceUrl: 'https://prices.example/list',
              quote: 'words of the third party',
              fetchedAt: '2026-11-26T00:00:00.000Z',
              sourceType,
            },
          },
        ],
      })
    const index = buildCatalogIndex([
      priced('acme-rx', 'rx', 'third-party', { min: 3000, max: 5000, perPair: true }),
      priced('acme-otc', 'otc', 'official', 900),
    ])
    const container = mount(<CatalogFilters items={index} brandNames={{ acme: 'Acme' }} />)
    const priceCell = (slug: string) => container.querySelector(`a[href="/hearing-aids/${slug}"]`)!.closest('tr')!.cells[6]

    expect(priceCell('acme-rx').textContent).toBe('$3,000According to prices.example')
    expect(priceCell('acme-rx').querySelector('a')?.getAttribute('href')).toBe('https://prices.example/list')
    expect(priceCell('acme-otc').textContent).toBe('$900')
    expect(priceCell('acme-otc').querySelector('a')).toBeNull()
    // The index is sent to the browser: the quote stays behind.
    expect(JSON.stringify(index)).not.toContain('words of the third party')
  })

  test('offers only the values the catalog has', () => {
    const container = mount(<CatalogFilters items={items} brandNames={{ acme: 'Acme' }} />)
    const labels = [...container.querySelectorAll('label')].map((l) => l.textContent)

    expect(labels).toContain('BTE')
    expect(labels).not.toContain('CIC')
    expect(labels).toContain('Acme')
  })
})
