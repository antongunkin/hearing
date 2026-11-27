import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { SpecTable } from '@/src/components/SpecTable'

const cited = {
  value: 1,
  quote: 'quoted words',
  fetchedAt: '2026-11-26T00:00:00.000Z',
}
const official = { ...cited, sourceUrl: 'https://maker.example/spec', sourceType: 'official' as const }
const thirdParty = { ...cited, sourceUrl: 'https://example.com/prices', sourceType: 'third-party' as const }

const render = (node: React.ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(node), 'text/html')

test('SpecTable shows "—" for null and "According to example.com" for third-party', () => {
  const page = render(
    <SpecTable
      columns={['RIC', 'BTE', 'CIC']}
      rows={[{ label: 'Price', cells: [null, { text: '$3,000', source: thirdParty }, { text: '$900', source: official }] }]}
    />,
  )
  const [unknown, third, made] = page.querySelectorAll('tbody td')

  expect(unknown.textContent).toBe('—')
  expect(third.textContent).toContain('$3,000')
  expect(third.querySelector('a')?.textContent).toBe('According to example.com')
  expect(third.querySelector('a')?.getAttribute('href')).toBe('https://example.com/prices')

  // An official value has an icon link named by its host, and no "According to".
  expect(made.textContent).toBe('$900')
  expect(made.querySelector('a')?.getAttribute('href')).toBe('https://maker.example/spec')
  expect(made.querySelector('a')?.getAttribute('aria-label')).toBe('Source: maker.example')

  // Quotes are evidence for review, not page copy.
  expect(page.body.innerHTML).not.toContain('quoted words')
})

test('SpecTable heads each variant column and each row', () => {
  const page = render(<SpecTable columns={['RIC', 'BTE']} rows={[{ label: 'Weight', cells: [null, null] }]} />)

  expect([...page.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Specification', 'RIC', 'BTE'])
  expect(page.querySelector('tbody th')?.getAttribute('scope')).toBe('row')
})
