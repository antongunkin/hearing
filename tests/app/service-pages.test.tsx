import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import AboutBot from '@/app/about-bot/page'
import Corrections from '@/app/corrections/page'
import Methodology from '@/app/methodology/page'
import NotMedicalAdvice from '@/app/not-medical-advice/page'
import Privacy from '@/app/privacy/page'
import { forbiddenCheck } from '@/pipeline/checks/forbidden'
import { config } from '@/pipeline/config'

afterEach(() => {
  vi.unstubAllEnvs()
})

const parse = (node: ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(node), 'text/html')

const PAGES = { Methodology, NotMedicalAdvice, Corrections, Privacy, AboutBot }

describe('service pages', () => {
  test.each(Object.entries(PAGES))('%s claims no first-hand testing or expert voice', (_name, Page) => {
    expect(forbiddenCheck(parse(<Page />).body.textContent!)).toEqual({ name: 'forbidden', ok: true })
  })

  test('corrections gives the contact email only when one is set, and no placeholder otherwise', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', '')
    const unset = parse(<Corrections />)
    expect(unset.querySelector('a[href^="mailto:"]')).toBeNull()
    expect(unset.body.textContent).not.toContain('@')

    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', 'contact@site.example')
    const link = parse(<Corrections />).querySelector('a[href^="mailto:"]')
    expect(link?.getAttribute('href')).toBe('mailto:contact@site.example')
    expect(link?.textContent).toBe('contact@site.example')
  })

  test.each([AboutBot, Privacy])('sends removal and privacy requests to the corrections page', (Page) => {
    expect(parse(<Page />).querySelector('a[href="/corrections"]')).not.toBeNull()
  })

  test('methodology states when prices and complaint themes are published without a person', () => {
    const text = parse(<Methodology />).body.textContent!.replace(/\s+/g, ' ')
    expect(text).toContain(`official prices whose quote states one regular price and that move by at most ${config.maxAutoPriceChange * 100}%`)
    expect(text).toContain(`complaint-theme shares from at least ${config.minThemeReviews} reviews`)
  })

  test('about-bot shows the User-Agent the bot really sends', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example')
    const shown = config.userAgent.replace('https://site.example', '<site address>')

    expect(parse(<AboutBot />).querySelector('code')?.textContent).toBe(shown)
  })
})
