import type { Metadata } from 'next'
import Link from 'next/link'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What data is processed when you visit this site, including analytics and YouTube videos.',
  alternates: canonical('/privacy'),
}

export default function PrivacyPage() {
  return (
    <main className="page prose">
      <h1>Privacy</h1>
      <p>This site has no accounts and no sign-up, and it does not ask you for personal details.</p>

      <h2>Hosting</h2>
      <p>
        The site is hosted by Vercel. As with any web host, it receives your IP address and browser details when you
        request a page.
      </p>

      <h2>Analytics</h2>
      <p>
        Google Analytics 4 runs only when it has been configured for this site. When it runs, it may set cookies and
        sends Google information about your visit, such as the pages you view.
      </p>

      <h2>YouTube videos</h2>
      <p>
        On pages with video reviews, preview images load from i.ytimg.com before you click anything, so Google receives
        your IP address then. The video player loads from youtube-nocookie.com only when you click a preview.
      </p>

      <h2>Advertising</h2>
      <p>There is space reserved for ads. Ads may be added later, with their own notice.</p>

      <h2>Links and messages</h2>
      <p>
        Other sites we link to have their own privacy practices. If you write to us, we receive your address and what you
        send. Questions and requests go through <Link href="/corrections">Corrections</Link>.
      </p>
    </main>
  )
}
