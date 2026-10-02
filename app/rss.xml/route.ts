import { getCloudflareContext } from '@opennextjs/cloudflare'
import markdownit from 'markdown-it'
import { NextResponse } from 'next/server'
import { Podcast } from 'podcast'
import { buildContentKey, buildContentPrefix, podcastContactEmail } from '@/config'
import { matchesConditionalRequest, readEdgeCache, writeEdgeCache } from '@/lib/edge-cache'
import { getRssCacheTag, RSS_EDGE_CACHE_TTL_SECONDS } from '@/lib/rss-cache'
import { getActiveRuntimeConfig } from '@/lib/runtime-config'
import { resolveBaseUrlFromRequest } from '@/lib/site-url'
import { getContentDays } from '@/lib/utils'

const md = markdownit()

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const revalidate = 3600

// Finished feed responses are stored in Cloudflare's edge cache (see
// RSS_EDGE_CACHE_TTL_SECONDS). Without it every RSS poll re-runs the handler
// (KV list + one KV get per episode + one R2 head per episode), which drains
// the Workers KV quota.

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
  // Never seed with Date.now(): a shifting timestamp would bust the ETag and
  // force clients to re-download the feed on every poll.
  let latest = 0

  for (const post of posts) {
    const candidates: Array<unknown> = [post.updatedAt, post.publishedAt, post.date]
    for (const candidate of candidates) {
      const ms = parseDateMs(candidate)
      if (typeof ms === 'number') {
        latest = Math.max(latest, ms)
      }
    }
  }

  if (latest === 0) {
    return new Date(Math.floor(Date.now() / 1000) * 1000)
  }

  return new Date(Math.floor(latest / 1000) * 1000)
}

// The podcast library stamps <lastBuildDate> with the current time, which would
// make the body (and therefore the ETag) change on every request. Rewrite it to
// the feed's real last-modified time so identical feeds hash identically.
function normalizeLastBuildDate(xml: string, lastModified: Date): string {
  const value = lastModified.toUTCString()
  if (/<lastBuildDate>[^<]*<\/lastBuildDate>/.test(xml)) {
    return xml.replace(/<lastBuildDate>[^<]*<\/lastBuildDate>/, `<lastBuildDate>${value}</lastBuildDate>`)
  }
  return xml
}

function buildFeedHeaders(etag: string, lastModified: Date, xmlBytesLength?: number): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': `public, max-age=${RSS_EDGE_CACHE_TTL_SECONDS}, s-maxage=${RSS_EDGE_CACHE_TTL_SECONDS}, stale-while-revalidate=${RSS_EDGE_CACHE_TTL_SECONDS}`,
    'ETag': etag,
    'Last-Modified': lastModified.toUTCString(),
  }
  if (typeof xmlBytesLength === 'number') {
    headers['Content-Length'] = String(xmlBytesLength)
  }
  return headers
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(part => part.toString(16).padStart(2, '0'))
    .join('')
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const requestBaseUrl = requestUrl.origin
  const baseUrl = resolveBaseUrlFromRequest(request)
  const selfFeedUrl = `${requestBaseUrl}${requestUrl.pathname}`
  const { env, ctx } = await getCloudflareContext({ async: true })
  const rssEnv = env as RssEnv
  const runEnv = rssEnv.NODE_ENV || 'production'
  const cacheTag = getRssCacheTag(runEnv)

  // Hot path: podcast platforms poll the feed frequently. If the finished
  // response is already at the edge we return it without touching KV/R2.
  const cached = await readEdgeCache(request, cacheTag)
  if (cached.response) {
    const cachedEtag = cached.response.headers.get('etag')
    const cachedLastModified = cached.response.headers.get('last-modified')
    if (cachedEtag && cachedLastModified && matchesConditionalRequest(request, cachedEtag, cachedLastModified)) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': cached.response.headers.get('cache-control') ?? `public, max-age=${RSS_EDGE_CACHE_TTL_SECONDS}`,
          'ETag': cachedEtag,
          'Last-Modified': cachedLastModified,
        },
      })
    }
    return cached.response
  }

  const runtimeConfig = await getActiveRuntimeConfig(rssEnv)
  const runtimeSite = runtimeConfig.config.site
  const contactEmail = runtimeSite.contactEmail || podcastContactEmail
  const editorContact = contactEmail
    ? `${contactEmail} (${runtimeSite.title})`
    : runtimeSite.title

  const pastDays = await getContentDays(rssEnv.PODCAST_KV, buildContentPrefix(runEnv), runtimeSite.rss.feedDays)
  const posts = (await Promise.all(
    pastDays.map(async (day) => {
      const post = await rssEnv.PODCAST_KV.get(buildContentKey(runEnv, day), 'json')
      return post as unknown as Article
    }),
  )).filter(Boolean)

  const audioInfos = await Promise.all(
    posts.map(post => rssEnv.PODCAST_R2.head(post.audio)),
  )

  const lastModified = getFeedLastModified(posts)
  const lastModifiedString = lastModified.toUTCString()

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
    // Derive the channel timestamp from the content so the feed body is stable
    // across requests (a changing body would invalidate the ETag every time).
    pubDate: lastModified,
    ttl: 60,
    generator: runtimeSite.title,
    copyright: `Copyright ${lastModified.getUTCFullYear()} ${runtimeSite.title}`,
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

  const xml = normalizeLastBuildDate(feed.buildXml(), lastModified)
  const xmlBytes = new TextEncoder().encode(xml)
  const etag = `"${await sha256Hex(xml)}"`

  if (matchesConditionalRequest(request, etag, lastModifiedString)) {
    return new NextResponse(null, {
      status: 304,
      headers: buildFeedHeaders(etag, lastModified),
    })
  }

  const response = new NextResponse(xml, {
    status: 200,
    headers: buildFeedHeaders(etag, lastModified, xmlBytes.byteLength),
  })

  const cacheWrite = writeEdgeCache(cached.cache, cached.cacheKey, response)
  if (cacheWrite) {
    ctx.waitUntil(cacheWrite)
  }

  return response
}
