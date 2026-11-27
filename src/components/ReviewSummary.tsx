// Ratings per shop and complaint themes with their shares. Never review text, never an average across shops.
import type { Reviews } from '@/src/lib/schema/reviews'
import { formatDate, formatNumber, hostname } from '@/src/lib/site/format'

/** `sound-quality` → `Sound quality`. */
const themeLabel = (theme: string) => (theme.charAt(0).toUpperCase() + theme.slice(1)).replaceAll('-', ' ')

export function ReviewSummary({ customer, complaintThemes }: Pick<Reviews, 'customer' | 'complaintThemes'>) {
  if (customer.length === 0 && complaintThemes.length === 0) return null
  return (
    <section aria-labelledby="reviews-heading">
      <h2 id="reviews-heading">Customer reviews</h2>
      {customer.length > 0 && (
        <div className="table-scroll" role="region" aria-label="Ratings by source" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Rating</th>
                <th scope="col">Ratings</th>
                <th scope="col">Checked</th>
              </tr>
            </thead>
            <tbody>
              {customer.map(({ sourceUrl, rating, count, fetchedAt }) => (
                <tr key={sourceUrl}>
                  <th scope="row">
                    <a href={sourceUrl}>
                      {hostname(sourceUrl)}
                    </a>
                  </th>
                  <td>{rating} out of 5</td>
                  <td>{formatNumber(count)}</td>
                  <td>{formatDate(fetchedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {complaintThemes.length > 0 && (
        <>
          <h3>Common complaints</h3>
          <p className="note">Share of the collected reviews that complain about each point.</p>
          <ul className="themes">
            {complaintThemes.map(({ theme, share }) => (
              <li key={theme}>
                <span>{themeLabel(theme)}</span>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(share * 100)}%` }} />
                </span>
                <span>{Math.round(share * 100)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
