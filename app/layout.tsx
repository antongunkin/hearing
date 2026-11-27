import { GoogleAnalytics } from '@next/third-parties/google'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Hearing Aid Database', template: '%s | Hearing Aid Database' },
  description: 'Specifications, FDA records and review summaries of hearing aids sold in the United States, with sources.',
}

// The service pages. The owner's /review page is not one of them.
const SERVICE_PAGES = [
  ['/methodology', 'Methodology'],
  ['/not-medical-advice', 'Medical disclaimer'],
  ['/corrections', 'Corrections'],
  ['/privacy', 'Privacy'],
  ['/about-bot', 'About our bot'],
]

export default function RootLayout({ children }: { children: ReactNode }) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <header className="site-header">
          <div className="wrap">
            <Link className="wordmark" href="/">
              Hearing Aid Database
            </Link>
            <nav aria-label="Main">
              <Link href="/hearing-aids">All hearing aids</Link>
            </nav>
          </div>
        </header>
        {/* Pages bring their own <main>. */}
        <div id="content" tabIndex={-1}>
          {children}
        </div>
        <footer className="site-footer">
          <div className="wrap">
            <nav aria-label="Footer">
              {SERVICE_PAGES.map(([href, label]) => (
                <Link key={href} href={href} prefetch={false}>
                  {label}
                </Link>
              ))}
            </nav>
            <p>Not medical advice. Talk to a hearing care professional about your hearing.</p>
          </div>
        </footer>
        {gaId && <GoogleAnalytics gaId={gaId} />}
      </body>
    </html>
  )
}
