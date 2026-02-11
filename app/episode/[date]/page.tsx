import type { Metadata } from 'next'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { notFound } from 'next/navigation'
import { EpisodeDetail } from '@/components/episodes/detail'
import { PodcastScaffold } from '@/components/podcast/scaffold'
import { buildContentKey, podcast } from '@/config'
import { buildEpisodeFromArticle } from '@/lib/episodes'
import { getActiveRuntimeConfig } from '@/lib/runtime-config'

export const revalidate = 7200

interface EpisodeEnv extends CloudflareEnv {
  PODCAST_KV: KVNamespace
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>
}): Promise<Metadata> {
  const { env } = await getCloudflareContext({ async: true })
  const episodeEnv = env as EpisodeEnv
  const runEnv = env.NODE_ENV || 'production'
  const runtimeConfig = await getActiveRuntimeConfig(episodeEnv)
  const runtimeSite = runtimeConfig.config.site
  const { date } = await params
  const post = (await env.PODCAST_KV.get(buildContentKey(runEnv, date), 'json')) as unknown as Article | null

  if (!post) {
    return notFound()
  }

  const episode = buildEpisodeFromArticle(post, env.NEXT_STATIC_HOST, runtimeConfig.config.locale.language)
  const title = episode.title || runtimeSite.title
  const description = episode.description || runtimeSite.description
  const url = `${podcast.base.link}/episode/${episode.id}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      publishedTime: new Date(episode.published).toISOString(),
      images: [
        {
          url: runtimeSite.seo.defaultImage,
          alt: episode.title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [runtimeSite.seo.defaultImage],
    },
  }
}

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { env } = await getCloudflareContext({ async: true })
  const episodeEnv = env as EpisodeEnv
  const runEnv = env.NODE_ENV || 'production'
  const runtimeConfig = await getActiveRuntimeConfig(episodeEnv)
  const runtimeSite = runtimeConfig.config.site
  const { date } = await params
  const pageQuery = await searchParams
  const fallbackPage = Number.parseInt(pageQuery.page ?? '1', 10)

  const post = (await env.PODCAST_KV.get(buildContentKey(runEnv, date), 'json')) as unknown as Article | null

  if (!post) {
    return notFound()
  }

  const episode = buildEpisodeFromArticle(post, env.NEXT_STATIC_HOST, runtimeConfig.config.locale.language)
  const podcastInfo = {
    title: runtimeSite.title,
    description: runtimeSite.description,
    link: podcast.base.link,
    cover: runtimeSite.coverLogoUrl,
  }

  const safePage = Number.isNaN(fallbackPage) ? 1 : Math.max(1, fallbackPage)
  return (
    <PodcastScaffold podcastInfo={podcastInfo}>
      <EpisodeDetail episode={episode} initialPage={safePage} />
    </PodcastScaffold>
  )
}
