// A proposed new model: every field with its source and checks; the owner unticks what to leave out.
import type { PendingChange } from '@/src/lib/schema/pending'
import { approveChange, rejectChange } from './actions'
import { cell, Checks, failedStyle, isCited, isObject, Value } from './ChangeRow'

type Field = {
  path: string
  value: unknown
  /** The model can do without it, so it has a checkbox. */
  optional: boolean
}

/**
 * The fields of a model by path. Sourced values and hardware twins are optional; everything else
 * (names, type, form factor, …) is part of the model.
 */
function fieldsOf(node: unknown, path = ''): Field[] {
  if (isCited(node)) return [{ path, value: node, optional: true }]
  // A twin is kept or left out whole: its source is not optional on its own.
  if (/^sameHardwareAs\.\d+$/.test(path)) return [{ path, value: node, optional: true }]
  const nested = isObject(node) || (Array.isArray(node) && node.some(isObject))
  if (!nested) return [{ path, value: node, optional: false }]
  return Object.entries(node as object).flatMap(([key, child]) => fieldsOf(child, path === '' ? key : `${path}.${key}`))
}

export function ModelCard({ item }: { item: PendingChange }) {
  const { id } = item
  async function approve(form: FormData) {
    'use server'
    const keep = new Set(form.getAll('keep'))
    await approveChange(
      id,
      form
        .getAll('field')
        .map(String)
        .filter((path) => !keep.has(path)),
    )
  }
  async function reject() {
    'use server'
    await rejectChange(id)
  }

  const fields = fieldsOf(item.after)
  // A twin's checks may be recorded under its source.
  const checksOf = (path: string) => [...(item.checks[path] ?? []), ...(item.checks[`${path}.source`] ?? [])]
  const shown = new Set(fields.flatMap(({ path }) => [path, `${path}.source`]))
  // Checks of fields the model does not have, such as a release date that was not found.
  const missing = Object.keys(item.checks).filter((path) => !shown.has(path))

  return (
    <article style={{ marginBottom: 32 }}>
      <h3>New model: {item.modelSlug}</h3>
      <form action={approve}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Include', 'Field', 'Value, quote and source', 'Checks'].map((title) => (
                <th key={title} scope="col" style={cell}>
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map(({ path, value, optional }) => {
              const checks = checksOf(path)
              const passed = checks.length > 0 && checks.every((check) => check.ok)
              return (
                <tr key={path} style={checks.some((check) => !check.ok) ? failedStyle : undefined}>
                  <td style={cell}>
                    {optional ? (
                      <>
                        <input type="hidden" name="field" value={path} />
                        <input type="checkbox" name="keep" value={path} defaultChecked={passed} aria-label={`include ${path}`} />
                      </>
                    ) : (
                      <small>always</small>
                    )}
                  </td>
                  <th scope="row" style={cell}>
                    <code>{path}</code>
                  </th>
                  <td style={cell}>
                    <Value value={value} />
                  </td>
                  <td style={cell}>
                    {optional && checks.length === 0 && 'not checked'}
                    <Checks checks={checks} />
                  </td>
                </tr>
              )
            })}
            {missing.map((path) => (
              <tr key={path} style={item.checks[path].some((check) => !check.ok) ? failedStyle : undefined}>
                <td style={cell} />
                <th scope="row" style={cell}>
                  <code>{path}</code>
                </th>
                <td style={cell}>not found</td>
                <td style={cell}>
                  <Checks checks={item.checks[path]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <button>Approve model</button> <button formAction={reject}>Reject model</button>
        </p>
      </form>
    </article>
  )
}
