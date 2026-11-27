import type { Metadata } from 'next'
import Link from 'next/link'
import { canonical } from '@/src/lib/site/url'

export const metadata: Metadata = {
  title: 'About our bot',
  description: 'How this site collects its data: what is read, the rules followed and how to ask us to stay away.',
  alternates: canonical('/about-bot'),
}

// What these lines say is what pipeline/config.ts and pipeline/fetch/ do: change them together.
export default function AboutBotPage() {
  return (
    <main className="page prose">
      <h1>About our bot</h1>
      <p>
        An automated collector reads public web pages to gather the facts in this database. It does not announce itself
        under a name of its own.
      </p>

      <h2>Rules it follows</h2>
      <ul>
        <li>It reads public pages only and never logs in.</li>
        <li>
          It follows the rules that robots.txt gives to all visitors (the <code>*</code> rules), including Crawl-delay. If a site has a robots.txt that cannot be read, it stays away.
        </li>
        <li>
          It makes one request at a time to a host and waits 2 to 5 seconds between requests, or longer if Crawl-delay
          asks for it. For copies kept by the Web Archive it waits at least 5 seconds.
        </li>
        <li>
          A captcha, bot protection, a 403, a 429 or any other refusal means the page is skipped. Nothing is bypassed.
        </li>
        <li>It does not scrape Google (including Shopping and Play) or Amazon.</li>
      </ul>
      <p>
        Some pages are built by scripts. Those are opened in a headless browser, which loads the
        files such a page asks for as a browser would, without a pause between them.
      </p>
      <p>
        Pages about reviews and prices are found by a web search; the collector then reads them under the rules above. Video
        details come from the official YouTube Data API rather than from the collector.
      </p>

      <h2>Keeping it away</h2>
      <p>
        Because the collector uses no name of its own, only rules for all visitors can hold it back. Add them to your
        robots.txt:
      </p>
      <pre>{'User-agent: *\nDisallow: /'}</pre>
      <p>
        To have material removed or corrected, or to ask us to stop reading your site, see{' '}
        <Link href="/corrections">Corrections</Link>.
      </p>
    </main>
  )
}
