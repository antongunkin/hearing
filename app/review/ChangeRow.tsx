// A queued change to a stored model or its reviews, as "was → now"; also how any proposed value is shown.
import type { ReactNode } from 'react'
import { notRun } from '@/src/lib/review/card'
import type { CheckResult, PendingChange } from '@/src/lib/schema/pending'
import { approveChange, rejectChange } from './actions'

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A value that carries its source (see `Sourced`). */
export const isCited = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && 'value' in value && 'quote' in value && 'sourceUrl' in value

export const cell = { border: '1px solid #ccc', padding: '4px 8px', verticalAlign: 'top', textAlign: 'left' } as const
export const failedStyle = { background: '#fde2e2', color: '#7a0000' } as const

/** Only web addresses become links: pending values come from scraped pages. */
function Link({ href, children }: { href: string; children?: ReactNode }) {
  if (!/^https?:\/\//.test(href)) return <>{children ?? href}</>
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children ?? href}
    </a>
  )
}

/** Any value of a change. A sourced value shows its source link and quote. */
export function Value({ value }: { value: unknown }): ReactNode {
  if (value === undefined) return '—'
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? <Link href={value} /> : value
  if (!isObject(value) && !Array.isArray(value)) return String(value)
  if (isCited(value)) {
    const derivation = value.derivation as { op: string; input: string } | undefined
    return (
      <>
        <strong>
          <Value value={value.value} /> {value.unit as string | undefined}
        </strong>
        <br />
        <q>{String(value.quote)}</q>
        <br />
        <small>
          <Link href={String(value.sourceUrl)}>source</Link> ({String(value.sourceType)})
          {derivation && `, ${derivation.op} from "${derivation.input}"`}
        </small>
      </>
    )
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return 'none'
  return (
    <ul style={{ margin: 0, paddingLeft: 16 }}>
      {entries.map(([key, child]) => (
        <li key={key}>
          {Array.isArray(value) ? null : `${key}: `}
          <Value value={child} />
        </li>
      ))}
      {/* A video is looked at before it is embedded. */}
      {isObject(value) && 'channel' in value && (
        <li>
          <Link href={`https://www.youtube.com/watch?v=${encodeURIComponent(String(value.id))}`}>watch</Link>
        </li>
      )}
    </ul>
  )
}

export function Checks({ checks }: { checks: CheckResult[] }) {
  return checks.map((check, i) =>
    notRun(check) ? (
      <div key={i}>– not checked: {check.name} (Ollama is not available)</div>
    ) : (
      <div key={i} style={check.ok ? undefined : failedStyle}>
        {check.ok ? '✓' : '✗ failed:'} {check.name}
        {check.detail && ` — ${check.detail}`}
      </div>
    ),
  )
}

export function ChangeRow({ item }: { item: PendingChange }) {
  const { id } = item
  async function approve() {
    'use server'
    await approveChange(id)
  }
  async function reject() {
    'use server'
    await rejectChange(id)
  }
  const checks = Object.entries(item.checks)
  return (
    <tr>
      <th scope="row" style={cell}>
        {item.modelSlug ?? 'industry'}
        <br />
        <code>{item.path}</code>
        <br />
        <small>{item.kind}</small>
      </th>
      <td style={cell}>
        <Value value={item.before} />
      </td>
      <td style={cell}>{item.after === null ? <strong>removed</strong> : <Value value={item.after} />}</td>
      <td style={cell}>
        {checks.every(([, results]) => results.length === 0) && 'not checked'}
        {checks.map(([path, results]) =>
          results.length === 0 ? null : (
            <div key={path}>
              <code>{path}</code>
              <Checks checks={results} />
            </div>
          ),
        )}
      </td>
      <td style={cell}>
        <form>
          <button formAction={approve}>Approve</button> <button formAction={reject}>Reject</button>
        </form>
      </td>
    </tr>
  )
}
