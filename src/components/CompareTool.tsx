'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { CompareData } from '@/src/lib/site/compare-data'
import { pairSlug } from '@/src/lib/site/pairs'
import { CompareTable } from './CompareTable'

type Option = [slug: string, name: string]
type Side = 'a' | 'b'

const SIDES: [Side, string][] = [
  ['a', 'First model'],
  ['b', 'Second model'],
]

/** Any two models side by side. The choice lives in the query (`?a=&b=`), so that it can be shared. */
export function CompareTool({ options }: { options: Option[] }) {
  const [chosen, setChosen] = useState<Record<Side, string>>({ a: '', b: '' })
  const [data, setData] = useState<CompareData>()
  const [failed, setFailed] = useState(false)

  // Read after the first render: the page is built ahead, so its HTML knows no query.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const known = (side: Side) => options.find(([slug]) => slug === query.get(side))?.[0] ?? ''
    setChosen({ a: known('a'), b: known('b') })
  }, [options])

  const { a, b } = chosen
  const ready = a !== '' && b !== '' && a !== b

  useEffect(() => {
    if (!ready || data || failed) return
    let wanted = true
    fetch('/compare/models.json')
      .then((response) => {
        if (!response.ok) throw new Error(`models.json: ${response.status}`)
        return response.json() as Promise<CompareData>
      })
      .then(
        (loaded) => wanted && setData(loaded),
        () => wanted && setFailed(true),
      )
    return () => {
      wanted = false
    }
  }, [ready, data, failed])

  function choose(side: Side, slug: string) {
    const next = { ...chosen, [side]: slug }
    setChosen(next)
    const query = new URLSearchParams(Object.entries(next).filter(([, value]) => value !== ''))
    window.history.replaceState(null, '', query.size ? `?${query}` : window.location.pathname)
  }

  function result() {
    if (a !== '' && a === b) return <p role="status">Choose two different models.</p>
    if (!ready) return <p role="status">Choose two models to compare.</p>
    if (failed) {
      return (
        <p role="alert">
          The comparison data could not be loaded.{' '}
          <button type="button" onClick={() => setFailed(false)}>
            Try again
          </button>
        </p>
      )
    }
    if (!data) return <p role="status">Loading…</p>

    const products = [a, b].flatMap((slug) => {
      const model = data.models.find((m) => m.slug === slug)
      const name = options.find(([option]) => option === slug)?.[1]
      return model && name ? [{ model, name }] : []
    })
    // The page and the data come from different builds, as after a deploy.
    if (products.length < 2) return <p role="alert">This page is out of date. Reload it to compare these models.</p>

    const pair = pairSlug(a, b)
    return (
      <>
        {data.pairs.includes(pair) && (
          <p>
            <Link href={`/compare/${pair}`} prefetch={false}>
              {products[0].name} vs {products[1].name}: full comparison with reviews, pros and cons
            </Link>
          </p>
        )}
        <CompareTable products={products} />
      </>
    )
  }

  return (
    <>
      <form className="filters" aria-label="Models to compare" onSubmit={(event) => event.preventDefault()}>
        {SIDES.map(([side, label]) => (
          <label key={side} className="pick">
            {label}
            <select value={chosen[side]} onChange={(event) => choose(side, event.target.value)}>
              <option value="">Choose a model</option>
              {options.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </form>
      {result()}
    </>
  )
}
