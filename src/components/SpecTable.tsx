import type { SpecRow } from '@/src/lib/site/spec-rows'
import { SourceNote } from './SourceNote'

/** `columns` head the cells of each row, in order. An unknown value shows as a dash. */
export function SpecTable({ columns, rows }: { columns: string[]; rows: SpecRow[] }) {
  return (
    <div className="table-scroll" role="region" aria-label="Specification table" tabIndex={0}>
      <table className="data-table spec-table">
        <thead>
          <tr>
            <th scope="col">Specification</th>
            {columns.map((column, i) => (
              <th key={i} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, cells }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {cells.map((cell, i) => (
                <td key={i}>
                  {cell ? (
                    <>
                      {cell.text}
                      <SourceNote source={cell.source} />
                    </>
                  ) : (
                    <span className="unknown">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
