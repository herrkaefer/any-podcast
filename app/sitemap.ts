import type { MetadataRoute } from 'next'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { buildContentPrefix } from '@/config'
import { resolveBaseUrlFromHeaders } from '@/lib/site-url'
import { listContentDays } from '@/lib/utils'

export const revalidate = 86400
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { env } = await getCloudflareContext({ async: true })
  const sitemapEnv = env as CloudflareEnv & { PODCAST_KV: KVNamespace }
  const runEnv = env.NODE_ENV || 'production'
  const baseUrl = await resolveBaseUrlFromHeaders()
  const posts = (await listContentDays(sitemapEnv.PODCAST_KV, buildContentPrefix(runEnv))).map((day) => {
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
