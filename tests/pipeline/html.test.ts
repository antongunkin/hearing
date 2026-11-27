// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { appStoreLinks, pageTitle } from '@/pipeline/fetch/html'

describe('pageTitle', () => {
  test('the document title, trimmed; none when the page has no title', () => {
    expect(pageTitle('<html><head><title>  Jabra   Enhance \n</title></head><body></body></html>')).toBe('Jabra Enhance')
    expect(pageTitle('<html><body><p>no title</p></body></html>')).toBeUndefined()
    expect(pageTitle('<html><head><title>   </title></head></html>')).toBeUndefined()
  })
})

describe('appStoreLinks', () => {
  test('appStoreLinks reads App Store ids and Play package ids once each', () => {
    const html = `<html><body>
      <a href="https://apps.apple.com/us/app/brand/id1000000000?uo=4">iOS</a>
      <a href="/us/app/brand/id1000000000">iOS again</a>
      <a href="https://itunes.apple.com/us/app/brand-pro/id2000000000#top">Pro</a>
      <a href="https://apps.apple.com/us/developer/brand/id3000000000">Developer page is not an app</a>
      <a href="https://play.google.com/store/apps/details?id=com.brand.app&hl=en">Android</a>
      <a href="https://play.google.com/store/apps/details?id=com.brand.app">Android again</a>
      <a href="https://brand.test/shop">Shop</a>
    </body></html>`
    expect(appStoreLinks(html, 'https://brand.test/')).toEqual({
      ios: ['1000000000', '2000000000'],
      android: ['com.brand.app'],
    })
  })
})
