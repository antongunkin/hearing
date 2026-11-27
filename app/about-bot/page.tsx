import type { Metadata } from 'next'
import Link from 'next/link'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = {
  title: 'About our bot',
  description: 'How HearingDBBot identifies itself, what it reads, the rules it follows and how to keep it away.',
  alternates: canonical('/about-bot'),
}

// What these lines say is what pipeline/config.ts and pipeline/fetch/ do: change them together.
export default function AboutBotPage() {
  return (
    <main className="page prose">
      <h1>About our bot</h1>
      <p>
        HearingDBBot reads public web pages to collect the facts in this database. It identifies itself with this
        User-Agent, where the address is that of this site (before the site had an address it sent only HearingDBBot/0.1):
      </p>
      <pre>
        <code>{'HearingDBBot/0.1 (+<site address>/about-bot)'}</code>
      </pre>

      <h2>Rules it follows</h2>
      <ul>
        <li>It reads public pages only and never logs in.</li>
        <li>
          It follows robots.txt, including Crawl-delay. If a site has a robots.txt that cannot be read, it stays away.
        </li>
        <li>
          It makes one request at a time to a host and waits 2 to 5 seconds between requests, or longer if Crawl-delay
          asks for it.
        </li>
        <li>
          A captcha, bot protection, a 403, a 429 or any other refusal means the page is skipped. Nothing is bypassed.
        </li>
        <li>It does not scrape Google (including Shopping and Play) or Amazon.</li>
      </ul>
      <p>
        Some pages are built by scripts. Those are opened in a headless browser with the same User-Agent, which loads the
        files such a page asks for as a browser would, without a pause between them.
      </p>
      <p>
        Pages about reviews and prices are found by a web search; the bot then reads them under the rules above. Video
        details come from the official YouTube Data API rather than from the bot.
      </p>

      <h2>Keeping it away</h2>
      <p>To keep the bot off your site, add this to your robots.txt:</p>
      <pre>{'User-agent: HearingDBBot\nDisallow: /'}</pre>
      <p>
        To have material removed or corrected, or to ask us to stop reading your site, see{' '}
        <Link href="/corrections">Corrections</Link>.
      </p>
    </main>
  )
}
