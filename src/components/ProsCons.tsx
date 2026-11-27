import type { Reviews } from '@/src/lib/schema/reviews'
import { hostname } from '@/src/lib/site/format'

type Points = NonNullable<Reviews['prosCons']>['pros']

function PointList({ title, points }: { title: string; points: Points }) {
  if (points.length === 0) return null
  return (
    <div>
      <h3>{title}</h3>
      <ul>
        {points.map(({ text, sources }) => (
          <li key={text}>
            {text}
            <span className="point-sources">
              {sources.map((url) => (
                <a key={url} href={url}>
                  {hostname(url)}
                </a>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ProsCons({ prosCons }: { prosCons: Reviews['prosCons'] }) {
  if (!prosCons || prosCons.pros.length + prosCons.cons.length === 0) return null
  return (
    <section aria-labelledby="pros-cons-heading">
      <h2 id="pros-cons-heading">Pros and cons</h2>
      <p className="note">Based on published reviews and customer feedback</p>
      <div className="pros-cons">
        <PointList title="Pros" points={prosCons.pros} />
        <PointList title="Cons" points={prosCons.cons} />
      </div>
    </section>
  )
}
