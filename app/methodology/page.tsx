import type { Metadata } from 'next'
import Link from 'next/link'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = {
  title: 'Methodology',
  description: 'Where the data on this site comes from, how it is checked, and what the source labels mean.',
  alternates: canonical('/methodology'),
}

export default function MethodologyPage() {
  return (
    <main className="page prose">
      <h1>Methodology</h1>
      <p>
        This site is a reference to hearing aids sold in the United States, mainly models released since November 2023.
        It is compiled from published material. We do not test devices, and nothing here is{' '}
        <Link href="/not-medical-advice">medical advice</Link>.
      </p>

      <h2>Where the data comes from</h2>
      <ul>
        <li>Makers’ product pages, datasheets and user guides.</li>
        <li>FDA records of clearances and recalls.</li>
        <li>Apple’s App Store, for the versions of the makers’ iPhone apps.</li>
        <li>Online shops that publish customer ratings.</li>
        <li>Published written and video reviews.</li>
        <li>
          Third-party price studies, clinic price lists and pages that report two products to be the same hardware.
        </li>
      </ul>
      <p>
        Pages are read by <Link href="/about-bot">our bot</Link>. A specification links to the page that states it. A
        value for which we have no source is left out and shown as unknown.
      </p>

      <h2>What the source labels mean</h2>
      <dl>
        <dt>official</dt>
        <dd>
          Stated by the maker, including its App Store listing, or by the FDA. The link icon beside a value opens that
          page.
        </dd>
        <dt>third-party</dt>
        <dd>
          Stated by someone else, and marked “According to” with their address. We accept third parties for two things
          only: reports that products share the same hardware, and prices of prescription hearing aids.
        </dd>
        <dt>derived</dt>
        <dd>
          Calculated from a stated figure, such as ounces converted to grams or the weight of one aid taken from the
          weight of a pair. The label of the source link names the figure it was converted from.
        </dd>
      </dl>

      <h2>How values are extracted and checked</h2>
      <p>
        Values are extracted from pages and documents with AI assistance and then run through automated checks, for
        example against the quoted text and expected ranges.
      </p>
      <p>
        A person approves new models, changes to specifications, everything labelled third-party, pros and cons, and
        video reviews before they are published. Routine updates that pass the automated checks are published without that
        step: official prices, app versions, FDA clearance and recall records, customer ratings and complaint-theme
        shares. News items are single sentences written with AI from those facts.
      </p>

      <h2>Customer reviews</h2>
      <p>
        We never publish the text of customer reviews. We show only each source’s rating and number of ratings, and the
        share of the collected reviews that complain about each theme.
      </p>

      <h2>Pros and cons</h2>
      <p>
        Pros and cons are short summaries, written with AI, of published reviews, each with links to its sources. They
        are not our own findings.
      </p>

      <h2>Mistakes</h2>
      <p>
        If something is wrong or out of date, see <Link href="/corrections">Corrections</Link>.
      </p>
    </main>
  )
}
