// A proposal of the site atlas: a brand's config as a diff, or a relation between companies, brands and apps.
import { configDiff } from '@/src/lib/review/config-diff'
import { failed } from '@/src/lib/review/card'
import { z } from 'zod'
import { Edge, Entity } from '@/src/lib/schema/graph'
import type { PendingChange } from '@/src/lib/schema/pending'
import { approveChange, rejectChange } from './actions'
import { cell, Checks, failedStyle, Value } from './ChangeRow'

/** Web addresses are links, anything else (a repository path) is code. */
function Refs({ refs }: { refs: string[] | undefined }) {
  if (!refs || refs.length === 0) return null
  return (
    <ul aria-label="References">
      {refs.map((ref) => (
        <li key={ref}>
          {/^https?:\/\//.test(ref) ? (
            <a href={ref} target="_blank" rel="noreferrer">
              {ref}
            </a>
          ) : (
            <code>{ref}</code>
          )}
        </li>
      ))}
    </ul>
  )
}

function AllChecks({ checks }: { checks: PendingChange['checks'] }) {
  const entries = Object.entries(checks).filter(([, results]) => results.length > 0)
  if (entries.length === 0) return <p>not checked</p>
  return (
    <div>
      {entries.map(([path, results]) => (
        <div key={path} style={results.some(failed) ? failedStyle : undefined}>
          <code>{path}</code>
          <Checks checks={results} />
        </div>
      ))}
    </div>
  )
}

const Proposed = z.strictObject({ edge: Edge, entities: z.array(Entity) })

export function AtlasCard({ item }: { item: PendingChange }) {
  const { id } = item
  async function approve() {
    'use server'
    await approveChange(id)
  }
  async function reject() {
    'use server'
    await rejectChange(id)
  }

  const parsed = item.kind === 'relation' ? Proposed.safeParse(item.after) : null
  const relation = parsed?.success ? parsed.data : null
  const nameOf = (entityId: string) => relation?.entities.find((e) => e.id === entityId)?.name ?? entityId
  const anyFailed = Object.values(item.checks).some((results) => results.some(failed))

  return (
    <article style={{ marginBottom: 32, ...(anyFailed && { borderLeft: '4px solid #7a0000', paddingLeft: 8 }) }}>
      {parsed && !parsed.success ? (
        <>
          <h3>Relation: {item.path}</h3>
          <p style={failedStyle}>Malformed proposal, reject it: {parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}</p>
        </>
      ) : relation ? (
        <>
          <h3>
            {nameOf(relation.edge.from)} {relation.edge.kind} {nameOf(relation.edge.to)}
            {relation.edge.since && ` since ${relation.edge.since}`}
            {relation.edge.until && ` until ${relation.edge.until}`}
          </h3>
          <ul aria-label="Sources">
            {relation.edge.sources.map((source) => (
              <li key={source.url}>
                <Value value={source.url} /> <small>({source.kind})</small>
                {source.quote && (
                  <>
                    <br />
                    <q>{source.quote}</q>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h3>Brand config: {item.path.replace(/^brands\//, '')}</h3>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Field', 'Was', '→ Now'].map((title) => (
                  <th key={title} scope="col" style={cell}>
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {configDiff(item.before ?? {}, item.after).map((change) => (
                <tr key={change.path}>
                  <th scope="row" style={cell}>
                    <code>{change.path}</code>
                  </th>
                  <td style={cell}>
                    <Value value={change.before} />
                  </td>
                  <td style={cell}>
                    <Value value={change.after} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <Refs refs={item.refs} />
      <AllChecks checks={item.checks} />
      <form>
        <button formAction={approve}>Approve</button> <button formAction={reject}>Reject</button>
      </form>
    </article>
  )
}
