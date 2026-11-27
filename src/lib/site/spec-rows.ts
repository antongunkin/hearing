// Specifications as table rows: one column per variant, every cell with its source.
import type { Sourced } from '@/src/lib/schema/field'
import type { Model, Variant } from '@/src/lib/schema/model'
import { formatDate, formatNumber, formatPrice, powerLabel } from './format'

export type SpecCell = { text: string; source: Sourced<unknown> } | null
export type SpecRow = { label: string; cells: SpecCell[] }

type Column = { model: Model; variant?: Variant; label: string }

/**
 * The columns of `specRows`, model by model: one per variant, labelled by form factor and tech level.
 * A model without variants keeps one column, for its model-wide values.
 */
export function specColumns(models: Model[]): Column[] {
  return models.flatMap((model): Column[] => {
    if (model.variants.length === 0) return [{ model, label: 'All versions' }]
    const labels = model.variants.map((v) => [v.formFactor, v.techLevel].filter(Boolean).join(' '))
    return model.variants.map((variant, i) => ({
      model,
      variant,
      label: labels.indexOf(labels[i]) === labels.lastIndexOf(labels[i]) ? labels[i] : `${labels[i]} (${variant.id})`,
    }))
  })
}

/** A cell from a sourced value; null when there is no value, or nothing to say about it. */
function cell<T>(source: Sourced<T> | undefined, text: (value: T) => string | undefined): SpecCell {
  const shown = source && text(source.value)
  return shown ? { text: shown, source } : null
}

const yesNo = (flag: boolean | undefined) => (flag === undefined ? undefined : flag ? 'Yes' : 'No')

type Connectivity = keyof NonNullable<Model['connectivity']>['value']
const connectivity = (flag: Connectivity) => (c: Column) => cell(c.model.connectivity, (value) => yesNo(value[flag]))

const ROWS: [label: string, of: (c: Column) => SpecCell][] = [
  ['Price', (c) => cell<number | { min: number; max: number; perPair: true }>(c.variant?.priceUsd, formatPrice)],
  ['Weight', (c) => cell(c.variant?.weightG, (g) => `${formatNumber(g)} g`)],
  ['Dimensions (L × W × H)', (c) => cell(c.variant?.dimensionsMm, ({ l, w, h }) => `${l} × ${w} × ${h} mm`)],
  ['Battery', (c) => cell(c.variant?.power, (p) => powerLabel(p.type))],
  ['Battery life', (c) => cell(c.variant?.power, (p) => (p.batteryHours === undefined ? undefined : `${p.batteryHours} hours`))],
  [
    'Charging case',
    (c) => cell(c.variant?.power, (p) => (p.chargingCase === undefined ? undefined : p.chargingCase ? 'Included' : 'Not included')),
  ],
  ['Water and dust rating', (c) => cell(c.variant?.ipRating, (rating) => rating)],
  ['Made for iPhone', connectivity('mfi')],
  ['Android streaming (ASHA)', connectivity('asha')],
  ['Bluetooth LE Audio', connectivity('leAudio')],
  ['Auracast', connectivity('auracast')],
  ['Tinnitus feature', (c) => cell(c.model.tinnitus, yesNo)],
  ['Platform', (c) => cell(c.model.platform, (platform) => platform)],
  ['Materials', (c) => cell(c.model.materials, (materials) => materials.join(', '))],
  ['Colors', (c) => cell(c.model.colors, (colors) => colors.join(', '))],
  ['Released', (c) => cell(c.model.releaseDate, formatDate)],
  ['FDA status', (c) => cell(c.model.fda, ({ status, k510 }) => (k510 ? `${status} (${k510})` : status))],
  [
    'iPhone app version',
    (c) => cell(c.model.app?.iosVersion, (version) => `${c.model.app!.name} ${version}`),
  ],
]

/** The rows that have a value in at least one column: a row of dashes says nothing. */
export function specRows(models: Model[]): SpecRow[] {
  const columns = specColumns(models)
  return ROWS.map(([label, of]) => ({ label, cells: columns.map(of) })).filter(({ cells }) => cells.some((cell) => cell !== null))
}
