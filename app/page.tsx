import type { PodcastInfo } from '@/types/podcast'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { Podcast } from '@/components/podcast'
import { buildContentPrefix, podcast } from '@/config'
import { buildEpisodesFromArticles } from '@/lib/episodes'
import { getActiveRuntimeConfig } from '@/lib/runtime-config'
import { getPastDays } from '@/lib/utils'

export const revalidate = 600

interface HomeEnv extends CloudflareEnv {
  PODCAST_KV: KVNamespace
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { env } = await getCloudflareContext({ async: true })
  const homeEnv = env as HomeEnv
  const runEnv = env.NODE_ENV || 'production'
  const runtimeConfig = await getActiveRuntimeConfig(homeEnv)
  const runtimeSite = runtimeConfig.config.site
  const query = await searchParams
  const requestedPage = Number.parseInt(query.page ?? '1', 10)
  const currentPage = Number.isNaN(requestedPage) ? 1 : Math.max(1, requestedPage)
  const pastDays = getPastDays(runtimeSite.keepDays)
  const kvPrefix = buildContentPrefix(runEnv)
  const totalEpisodes = pastDays.length
  const totalPages = Math.max(1, Math.ceil(totalEpisodes / runtimeSite.pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const startIndex = (safePage - 1) * runtimeSite.pageSize
  const pageDays = pastDays.slice(startIndex, startIndex + runtimeSite.pageSize)

  const posts = (
    await Promise.all(
      pageDays.map(async (day) => {
        const post = await env.PODCAST_KV.get(`${kvPrefix}${day}`, 'json')
        return post as unknown as Article
      }),
    )
  ).filter(Boolean)

  const episodes = buildEpisodesFromArticles(posts, env.NEXT_STATIC_HOST)

  const podcastInfo: PodcastInfo = {
    title: runtimeSite.title,
    description: runtimeSite.description,
    link: podcast.base.link,
    cover: runtimeSite.coverLogoUrl,
  }

  return (
    <Podcast
      episodes={episodes}
      currentPage={safePage}
      totalEpisodes={totalEpisodes}
      podcastInfo={podcastInfo}
    />
  )
}
