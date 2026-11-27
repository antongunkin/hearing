import type { Model } from '@/src/lib/schema/model'
import { specColumns, specRows } from '@/src/lib/site/spec-rows'
import { SpecTable } from './SpecTable'

/** The specifications of several models side by side, one column per variant, headed by its product. */
export function CompareTable({ products }: { products: { model: Model; name: string }[] }) {
  const models = products.map((product) => product.model)
  const names = new Map(products.map((product) => [product.model, product.name]))
  return (
    <div className="compare-table">
      <p className="note">
        Each figure links to where it is stated: the maker or the FDA, unless it says “According to” a third party. A dash
        means no source states the value.
      </p>
      <SpecTable
        columns={specColumns(models).map(({ model, label }) => `${names.get(model)} · ${label}`)}
        rows={specRows(models)}
      />
    </div>
  )
}
