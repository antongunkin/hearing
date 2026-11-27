import type { Metadata } from 'next'
import Link from 'next/link'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = {
  title: 'Corrections and removals',
  description: 'How to report a mistake on this site, or ask for material to be removed or our bot to stay away.',
  alternates: canonical('/corrections'),
}

export default function CorrectionsPage() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim()
  return (
    <main className="page prose">
      <h1>Corrections and removals</h1>
      <p>
        If something here is wrong or out of date, we want to fix it. Makers, publishers, site owners and readers can
        also ask us to remove material, or to stop <Link href="/about-bot">our bot</Link> from reading their site.
      </p>

      <h2>What to include</h2>
      <ul>
        <li>The address of the page on this site, or of your own page that the request is about.</li>
        <li>What is wrong, or what you want removed.</li>
        <li>For a correction, a link to where the right information is published.</li>
      </ul>

      <h2>Where to send it</h2>
      {email ? (
        <p>
          Write to <a href={`mailto:${email}`}>{email}</a>.
        </p>
      ) : (
        <p>A contact address has not been published yet.</p>
      )}
    </main>
  )
}
