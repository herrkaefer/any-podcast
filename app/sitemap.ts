import type { MetadataRoute } from 'next'
import { keepDays } from '@/config'
import { resolveBaseUrlFromHeaders } from '@/lib/site-url'
import { getPastDays } from '@/lib/utils'

export const revalidate = 86400

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = await resolveBaseUrlFromHeaders()
  const posts = getPastDays(keepDays).map((day) => {
    return {
      date: day,
    }
  })

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...posts.map(post => ({
      url: `${baseUrl}/episode/${post.date}`,
      lastModified: new Date(post.date),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ]
}
