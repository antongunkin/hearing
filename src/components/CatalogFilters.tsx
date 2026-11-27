'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { FormFactor, ModelType, PowerType } from '@/src/lib/schema/model'
import { filterCatalog, latestFirst, type CatalogFilter, type CatalogItem } from '@/src/lib/site/catalog-index'
import { formatDate, formatNumber, formatPrice, powerLabel, TYPE_LABELS } from '@/src/lib/site/format'
import { SourceNote } from './SourceNote'

type Option = [value: string, label: string]

function Group({ legend, name, options }: { legend: string; name: string; options: Option[] }) {
  if (options.length === 0) return null
  return (
    <fieldset>
      <legend>{legend}</legend>
      {options.map(([value, label]) => (
        <label key={value}>
          <input type="checkbox" name={name} value={value} />
          {label}
        </label>
      ))}
    </fieldset>
  )
}

function readFilter(form: HTMLFormElement): CatalogFilter {
  const data = new FormData(form)
  const all = <T extends string>(name: string) => data.getAll(name) as T[]
  const priceMax = String(data.get('priceMax') ?? '')
  return {
    type: all<ModelType>('type'),
    formFactor: all<FormFactor>('formFactor'),
    power: all<PowerType>('power'),
    brand: all('brand'),
    auracast: data.has('auracast'),
    includeDiscontinued: data.has('includeDiscontinued'),
    ...(priceMax !== '' && { priceMax: Number(priceMax) }),
  }
}

const dash = <span className="unknown">—</span>

export function CatalogFilters({ items, brandNames }: { items: CatalogItem[]; brandNames: Record<string, string> }) {
  const [filter, setFilter] = useState<CatalogFilter>({})
  const shown = filterCatalog(items, filter).sort(latestFirst)

  const brandName = (slug: string) => brandNames[slug] ?? slug
  /** The values some model has, as checkbox options sorted by label. */
  const options = (values: string[], label: (value: string) => string): Option[] =>
    [...new Set(values)].map((value): Option => [value, label(value)]).sort((a, b) => a[1].localeCompare(b[1]))

  return (
    <div className="catalog">
      {/* No autocomplete: a restored tick would not match the unfiltered list. */}
      <form
        className="filters"
        aria-label="Filter hearing aids"
        autoComplete="off"
        onChange={(event) => setFilter(readFilter(event.currentTarget))}
        onReset={() => setFilter({})}
        onSubmit={(event) => event.preventDefault()}
      >
        <Group
          legend="Type"
          name="type"
          options={options(items.map((item) => item.type), (type) => TYPE_LABELS[type as ModelType])}
        />
        <Group legend="Style" name="formFactor" options={options(items.flatMap((item) => item.formFactors), (f) => f)} />
        <Group legend="Battery" name="power" options={options(items.flatMap((item) => item.powerTypes), powerLabel)} />
        <Group legend="Brand" name="brand" options={options(items.map((item) => item.brand), brandName)} />
        <fieldset>
          <legend>Features and price</legend>
          <label>
            <input type="checkbox" name="auracast" />
            Auracast
          </label>
          <label>
            <input type="checkbox" name="includeDiscontinued" />
            Include discontinued
          </label>
          <label>
            Price up to, $
            <input type="number" name="priceMax" min="0" step="100" inputMode="numeric" />
          </label>
        </fieldset>
        <button type="reset">Clear filters</button>
      </form>

      <p role="status">
        {shown.length} of {items.length} {items.length === 1 ? 'model' : 'models'}
      </p>

      {shown.length === 0 ? (
        <p>No models match these filters.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Hearing aids" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                {['Model', 'Type', 'Style', 'Battery', 'Auracast', 'Weight from', 'Price from', 'Released'].map((title) => (
                  <th key={title} scope="col">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.slug}>
                  <th scope="row">
                    <Link href={`/hearing-aids/${item.slug}`} prefetch={false}>
                      {brandName(item.brand)} {item.name}
                    </Link>
                  </th>
                  <td>{TYPE_LABELS[item.type]}</td>
                  <td>{item.formFactors.join(', ') || dash}</td>
                  <td>{item.powerTypes.map(powerLabel).join(', ') || dash}</td>
                  <td>{item.connectivity.auracast === undefined ? dash : item.connectivity.auracast ? 'Yes' : 'No'}</td>
                  <td>{item.weightGMin === undefined ? dash : `${formatNumber(item.weightGMin)} g`}</td>
                  <td>
                    {item.discontinued ? (
                      <>
                        Discontinued
                        {item.lastListedPrice && (
                          <>
                            <br />
                            {formatPrice(item.lastListedPrice.min)} <small>last listed price, {formatDate(item.lastListedPrice.month)}</small>
                          </>
                        )}
                      </>
                    ) : item.priceMin === undefined ? (
                      dash
                    ) : (
                      formatPrice(item.priceMin)
                    )}
                    {item.priceSource?.sourceType === 'third-party' && <SourceNote source={item.priceSource} />}
                  </td>
                  <td>{item.releaseDate === undefined ? dash : formatDate(item.releaseDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        A dash means no source states the value. Models with unknown values stay in filtered results, except under the
        Auracast and price filters. Discontinued models are hidden unless included; their last listed price is not
        part of the price filter. Prices are the lowest listed for any version; a price from a third party says whose
        it is, and each model page links the source of every price.
      </p>
    </div>
  )
}
