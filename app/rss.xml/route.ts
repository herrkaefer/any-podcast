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

function parseDurationSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  const asNumber = Number.parseFloat(normalized)
  if (Number.isFinite(asNumber) && asNumber > 0 && /^\d+(?:\.\d+)?$/.test(normalized)) {
    return Math.round(asNumber)
  }

  const segments = normalized.split(':')
  if (segments.length < 2 || segments.length > 3) {
    return undefined
  }

  const numbers = segments.map(part => Number.parseInt(part, 10))
  if (numbers.some(part => !Number.isFinite(part) || part < 0)) {
    return undefined
  }

  if (segments.length === 2) {
    const [minutes, seconds] = numbers
    return minutes * 60 + seconds
  }

  const [hours, minutes, seconds] = numbers
  return hours * 3600 + minutes * 60 + seconds
}

function getItunesDurationFromAudioInfo(audioInfo: R2Object | null): number | undefined {
  if (!audioInfo?.customMetadata) {
    return undefined
  }

  const customMetadata = audioInfo.customMetadata
  const candidates: Array<unknown> = [
    customMetadata.durationSeconds,
    customMetadata.duration,
    customMetadata['x-duration-seconds'],
    customMetadata['x-duration'],
  ]

  for (const candidate of candidates) {
    const parsed = parseDurationSeconds(candidate)
    if (parsed) {
      return parsed
    }
  }

  return undefined
}

function parseDateMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  if (/^\d+$/.test(normalized)) {
    const numeric = Number.parseInt(normalized, 10)
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric
    }
  }

  const parsed = Date.parse(normalized)
  if (Number.isFinite(parsed)) {
    return parsed
  }
  return undefined
}

function getFeedLastModified(posts: Article[]): Date {
  let latest = Date.now()

  for (const post of posts) {
    const candidates: Array<unknown> = [post.updatedAt, post.publishedAt, post.date]
    for (const candidate of candidates) {
      const ms = parseDateMs(candidate)
      if (typeof ms === 'number') {
        latest = Math.max(latest, ms)
      }
    }
  }

  return new Date(Math.floor(latest / 1000) * 1000)
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(part => part.toString(16).padStart(2, '0'))
    .join('')
}

function hasMatchingEtag(ifNoneMatch: string, etag: string): boolean {
  const candidates = ifNoneMatch
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

  if (candidates.includes('*')) {
    return true
  }

  for (const candidate of candidates) {
    if (candidate === etag) {
      return true
    }
    if (candidate.startsWith('W/') && candidate.slice(2) === etag) {
      return true
    }
  }
  return false
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const configuredBaseUrl = (podcast.base.link || '').replace(/\/$/, '')
  const requestBaseUrl = requestUrl.origin
  const baseUrl = /^https?:\/\//.test(configuredBaseUrl) ? configuredBaseUrl : requestBaseUrl
  const selfFeedUrl = `${requestBaseUrl}${requestUrl.pathname}`
  const { env } = await getCloudflareContext({ async: true })
  const rssEnv = env as RssEnv
  const runtimeConfig = await getActiveRuntimeConfig(rssEnv)
  const runtimeSite = runtimeConfig.config.site
  const contactEmail = runtimeSite.contactEmail || podcastContactEmail
  const editorContact = contactEmail
    ? `${contactEmail} (${runtimeSite.title})`
    : runtimeSite.title

  // 如果没有缓存，生成新的响应
  const feed = new Podcast({
    namespaces: {
      iTunes: true,
      simpleChapters: false,
      podcast: true,
    },
    title: runtimeSite.title,
    description: runtimeSite.description,
    feedUrl: selfFeedUrl,
    siteUrl: baseUrl,
    imageUrl: runtimeSite.coverLogoUrl.startsWith('http')
      ? runtimeSite.coverLogoUrl
      : `${baseUrl}${runtimeSite.coverLogoUrl.startsWith('/') ? '' : '/'}${runtimeSite.coverLogoUrl}`,
    language: runtimeSite.rss.language,
    pubDate: new Date(),
    ttl: 60,
    generator: runtimeSite.title,
    copyright: `Copyright ${new Date().getUTCFullYear()} ${runtimeSite.title}`,
    categories: runtimeSite.rss.categories,
    itunesExplicit: false,
    itunesImage: runtimeSite.coverLogoUrl.startsWith('http')
      ? runtimeSite.coverLogoUrl
      : `${baseUrl}${runtimeSite.coverLogoUrl.startsWith('/') ? '' : '/'}${runtimeSite.coverLogoUrl}`,
    itunesType: 'episodic',
    itunesAuthor: runtimeSite.title,
    itunesCategory: runtimeSite.rss.itunesCategories.map((category) => {
      const subcategory = category.subcategory?.trim()
      if (!subcategory) {
        return { text: category.text }
      }
      return {
        text: category.text,
        subcats: [{ text: subcategory }],
      }
    }),
    itunesOwner: {
      name: runtimeSite.title,
      email: contactEmail,
    },
    managingEditor: editorContact,
    webMaster: editorContact,
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
    const introText = (post.introContent || '').trim()
    const introContentHtml = introText
      ? md.render(introText)
      : ''
    const blogContentHtml = md.render(post.blogContent || '')
    const finalContent = `
      <div>${introContentHtml}${introContentHtml ? '<hr/>' : ''}${blogContentHtml}<hr/>${linkContent}</div>
      ${rssEnv.NEXT_TRACKING_IMAGE ? `<img src="${rssEnv.NEXT_TRACKING_IMAGE}/${post.date}" alt="${post.title}" width="1" height="1" loading="lazy" aria-hidden="true" style="opacity: 0;pointer-events: none;" />` : ''}
    `

    // Apple Podcasts limits itunes:summary to 4000 characters
    const summary = (post.introContent || post.podcastContent || '').slice(0, 3999)

    const itunesDuration = getItunesDurationFromAudioInfo(audioInfo)
    feed.addItem({
      title: post.title || '',
      author: runtimeSite.title,
      description: summary,
      content: finalContent,
      url: `${baseUrl}/episode/${post.date}`,
      guid: `${baseUrl}/episode/${post.date}`,
      date: new Date(post.publishedAt || post.date),
      itunesAuthor: runtimeSite.title,
      itunesExplicit: false,
      itunesDuration,
      enclosure: {
        url: `${rssEnv.NEXT_STATIC_HOST}/${post.audio}?t=${post.updatedAt}`,
        type: getAudioMimeType(post.audio),
        size: audioInfo.size,
      },
    })
  })

  const xml = feed.buildXml()
  const xmlBytes = new TextEncoder().encode(xml)
  const etag = `"${await sha256Hex(xml)}"`
  const lastModified = getFeedLastModified(posts).toUTCString()

  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && hasMatchingEtag(ifNoneMatch, etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        'Cache-Control': `public, max-age=${revalidate}, s-maxage=${revalidate}`,
        'ETag': etag,
        'Last-Modified': lastModified,
      },
    })
  }

  const ifModifiedSince = request.headers.get('if-modified-since')
  if (ifModifiedSince) {
    const ifModifiedSinceMs = Date.parse(ifModifiedSince)
    const lastModifiedMs = Date.parse(lastModified)
    if (Number.isFinite(ifModifiedSinceMs) && Number.isFinite(lastModifiedMs) && ifModifiedSinceMs >= lastModifiedMs) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': `public, max-age=${revalidate}, s-maxage=${revalidate}`,
          'ETag': etag,
          'Last-Modified': lastModified,
        },
      })
    }
  }

  const response = new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${revalidate}, s-maxage=${revalidate}`,
      'Content-Length': String(xmlBytes.byteLength),
      'ETag': etag,
      'Last-Modified': lastModified,
    },
  })

  return response
}
