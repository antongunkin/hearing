import { sortKeys } from '@/src/lib/data/write'

// The changed leaves between two JSON values, by dot path: what the brand-config card lists.
export type ConfigChange = { path: string; before?: unknown; after?: unknown }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Arrays are compared whole, so a changed list is one change. */
export function configDiff(before: unknown, after: unknown, path = ''): ConfigChange[] {
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    return keys.flatMap((key) => configDiff(before[key], after[key], path === '' ? key : `${path}.${key}`))
  }
  if (JSON.stringify(before, sortKeys) === JSON.stringify(after, sortKeys)) return []
  return [{ path, ...(before !== undefined && { before }), ...(after !== undefined && { after }) }]
}
