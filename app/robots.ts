import type { MetadataRoute } from 'next'
import { resolveBaseUrlFromHeaders } from '@/lib/site-url'

export const revalidate = 86400

export default async function robots(): Promise<MetadataRoute.Robots> {
  const baseUrl = await resolveBaseUrlFromHeaders()

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
