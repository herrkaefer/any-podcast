import { getCloudflareContext } from '@opennextjs/cloudflare'
import markdownit from 'markdown-it'
import { NextResponse } from 'next/server'
import { Podcast } from 'podcast'
import { buildContentKey, podcast, podcastContactEmail } from '@/config'
import { getActiveRuntimeConfig } from '@/lib/runtime-config'
import { getPastDays } from '@/lib/utils'

const md = markdownit()

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const revalidate = 3600

interface RssEnv extends CloudflareEnv {
  PODCAST_KV: KVNamespace
  PODCAST_R2: R2Bucket
  NEXT_TRACKING_IMAGE?: string
}

function getAudioMimeType(audioPath: string): string {
  const normalized = (audioPath || '').split('?')[0].toLowerCase()
  if (normalized.endsWith('.wav')) {
    return 'audio/wav'
  }
  if (normalized.endsWith('.ogg')) {
    return 'audio/ogg'
  }
  if (normalized.endsWith('.webm')) {
    return 'audio/webm'
  }
  return 'audio/mpeg'
}

export async function GET(request: Request) {
  const configuredBaseUrl = (podcast.base.link || '').replace(/\/$/, '')
  const requestBaseUrl = new URL(request.url).origin
  const baseUrl = /^https?:\/\//.test(configuredBaseUrl) ? configuredBaseUrl : requestBaseUrl
  const { env } = await getCloudflareContext({ async: true })
  const rssEnv = env as RssEnv
  const runtimeConfig = await getActiveRuntimeConfig(rssEnv)
  const runtimeSite = runtimeConfig.config.site
  const contactEmail = runtimeSite.contactEmail || podcastContactEmail

  // 如果没有缓存，生成新的响应
  const feed = new Podcast({
    title: runtimeSite.title,
    description: runtimeSite.description,
    feedUrl: `${baseUrl}/rss.xml`,
    siteUrl: baseUrl,
    imageUrl: runtimeSite.coverLogoUrl.startsWith('http')
      ? runtimeSite.coverLogoUrl
      : `${baseUrl}${runtimeSite.coverLogoUrl.startsWith('/') ? '' : '/'}${runtimeSite.coverLogoUrl}`,
    language: runtimeSite.rss.language,
    pubDate: new Date(),
    ttl: 60,
    generator: runtimeSite.title,
    author: runtimeSite.title,
    categories: runtimeSite.rss.categories,
    itunesExplicit: false,
    itunesImage: runtimeSite.coverLogoUrl.startsWith('http')
      ? runtimeSite.coverLogoUrl
      : `${baseUrl}${runtimeSite.coverLogoUrl.startsWith('/') ? '' : '/'}${runtimeSite.coverLogoUrl}`,
    itunesType: 'episodic',
    itunesAuthor: runtimeSite.title,
    itunesCategory: runtimeSite.rss.itunesCategories.map(category => ({ text: category.text })),
    itunesOwner: {
      name: runtimeSite.title,
      email: contactEmail,
    },
    managingEditor: contactEmail,
    webMaster: contactEmail,
  })

  const runEnv = rssEnv.NODE_ENV || 'production'
  const pastDays = getPastDays(runtimeSite.rss.feedDays)
  const posts = (await Promise.all(
    pastDays.map(async (day) => {
      const post = await rssEnv.PODCAST_KV.get(buildContentKey(runEnv, day), 'json')
      return post as unknown as Article
    }),
  )).filter(Boolean)

  const audioInfos = await Promise.all(
    posts.map(post => rssEnv.PODCAST_R2.head(post.audio)),
  )

  posts.forEach((post, index) => {
    const audioInfo = audioInfos[index]
    if (!post.audio || !audioInfo) {
      return
    }

    const links = post.stories
      .map(s => `<li><a href="${escapeHtml(s.url || '')}" title="${escapeHtml(s.title || '')}">${escapeHtml(s.title || '')}</a></li>`)
      .join('')
    const linkContent = `<p><b>${runtimeSite.rss.relatedLinksLabel}</b></p><ul>${links}</ul>`
    const blogContentHtml = md.render(post.blogContent || '')
    const finalContent = `
      <div>${blogContentHtml}<hr/>${linkContent}</div>
      ${rssEnv.NEXT_TRACKING_IMAGE ? `<img src="${rssEnv.NEXT_TRACKING_IMAGE}/${post.date}" alt="${post.title}" width="1" height="1" loading="lazy" aria-hidden="true" style="opacity: 0;pointer-events: none;" />` : ''}
    `

    // Apple Podcasts limits itunes:summary to 4000 characters
    const summary = (post.introContent || post.podcastContent || '').slice(0, 3999)

    feed.addItem({
      title: post.title || '',
      description: summary,
      content: finalContent,
      url: `${baseUrl}/episode/${post.date}`,
      guid: `${baseUrl}/episode/${post.date}`,
      date: new Date(post.publishedAt || post.date),
      itunesExplicit: false,
      enclosure: {
        url: `${rssEnv.NEXT_STATIC_HOST}/${post.audio}?t=${post.updatedAt}`,
        type: getAudioMimeType(post.audio),
        size: audioInfo.size,
      },
    })
  })

  const response = new NextResponse(feed.buildXml(), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': `public, max-age=${revalidate}, s-maxage=${revalidate}`,
    },
  })

  return response
}
