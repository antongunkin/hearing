import type { MetadataRoute } from 'next'
import { absoluteUrl } from '@/src/lib/site/url'

export default function robots(): MetadataRoute.Robots {
  const sitemap = absoluteUrl('/sitemap.xml')
  return {
    // "/compare?" is the compare tool with any two models chosen.
    rules: { userAgent: '*', allow: '/', disallow: ['/review', '/compare?', '/compare/models.json'] },
    ...(sitemap && { sitemap }),
  }
}
