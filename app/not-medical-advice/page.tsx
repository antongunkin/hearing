import type { Metadata } from 'next'
import Link from 'next/link'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = {
  title: 'Medical disclaimer',
  description: 'This site is a reference to published information about hearing aids. It is not medical advice.',
  alternates: canonical('/not-medical-advice'),
}

export default function NotMedicalAdvicePage() {
  return (
    <main className="page prose">
      <h1>Not medical advice</h1>
      <p>
        This site collects published information about hearing aids. It does not diagnose hearing loss, recommend a
        treatment or tell you which device suits you, and it does not replace a visit to a doctor or a hearing care
        professional.
      </p>
      <p>
        Talk to a hearing care professional about your hearing. See a doctor promptly if your hearing changes suddenly,
        or if you have ear pain, discharge from an ear or dizziness.
      </p>
      <p>
        We do not test devices. Specifications, prices and review summaries come from the sources described in our{' '}
        <Link href="/methodology">methodology</Link> and may be incomplete or out of date: confirm anything that matters
        to you with the maker or the seller.
      </p>
    </main>
  )
}
