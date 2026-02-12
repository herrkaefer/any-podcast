import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'

const CACHE_TTL = 60 * 60 * 24 * 30 // 30 days
const DEFAULT_THEME_MUSIC_PATH = 'theme.mp3'
const DEFAULT_THEME_PUBLIC_PATH = '/theme.mp3'

/**
 * Redirect legacy .wav URLs to .mp3 equivalents.
 * Returns a 301 redirect Response if applicable, or null to continue normal handling.
 */
function tryWavToMp3Redirect(request: Request, objectPath: string): Response | null {
  if (!objectPath.toLowerCase().endsWith('.wav')) {
    return null
  }
  const url = new URL(request.url)
  url.pathname = url.pathname.replace(/\.wav$/i, '.mp3')
  return NextResponse.redirect(url.toString(), 301)
}

function getMimeTypeFromPath(path: string) {
  const normalized = path.toLowerCase()
  if (normalized.endsWith('.wav')) {
    return 'audio/wav'
  }
  if (normalized.endsWith('.mp3')) {
    return 'audio/mpeg'
  }
  if (normalized.endsWith('.m4a')) {
    return 'audio/mp4'
  }
  if (normalized.endsWith('.ogg')) {
    return 'audio/ogg'
  }
  if (normalized.endsWith('.webm')) {
    return 'audio/webm'
  }
  return 'application/octet-stream'
}

function applyHttpMetadataHeaders(headers: Headers, metadata: R2HTTPMetadata | undefined) {
  if (!metadata) {
    return
  }
  if (metadata.contentType) {
    headers.set('Content-Type', metadata.contentType)
  }
  if (metadata.contentLanguage) {
    headers.set('Content-Language', metadata.contentLanguage)
  }
  if (metadata.contentDisposition) {
    headers.set('Content-Disposition', metadata.contentDisposition)
  }
  if (metadata.contentEncoding) {
    headers.set('Content-Encoding', metadata.contentEncoding)
  }
  if (metadata.cacheControl) {
    headers.set('Cache-Control', metadata.cacheControl)
  }
  if (metadata.cacheExpiry instanceof Date) {
    headers.set('Expires', metadata.cacheExpiry.toUTCString())
  }
}

function getRangeHeader(request: Request) {
  return request.headers.get('range')
}

type ParsedRangeResult = { offset: number, length?: number } | 'unsatisfiable' | null

function parseRangeHeader(rangeHeader: string, fileSize: number): ParsedRangeResult {
  const normalized = rangeHeader.trim().toLowerCase()
  if (!normalized.startsWith('bytes=')) {
    return null
  }
  const spec = normalized.slice('bytes='.length).trim()
  if (!spec || spec.includes(',')) {
    return null
  }

  const normalMatch = /^(\d+)-(\d*)$/.exec(spec)
  if (normalMatch) {
    const start = Number.parseInt(normalMatch[1], 10)
    if (!Number.isFinite(start) || start < 0) {
      return null
    }
    if (start >= fileSize) {
      return 'unsatisfiable'
    }

    const rawEnd = normalMatch[2]
    if (!rawEnd) {
      return { offset: start }
    }

    const end = Number.parseInt(rawEnd, 10)
    if (!Number.isFinite(end) || end < start) {
      return null
    }
    const boundedEnd = Math.min(end, fileSize - 1)
    return {
      offset: start,
      length: boundedEnd - start + 1,
    }
  }

  const suffixMatch = /^-(\d+)$/.exec(spec)
  if (suffixMatch) {
    const suffixLength = Number.parseInt(suffixMatch[1], 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null
    }
    if (fileSize <= 0) {
      return 'unsatisfiable'
    }
    const length = Math.min(suffixLength, fileSize)
    return {
      offset: Math.max(fileSize - length, 0),
      length,
    }
  }

  return null
}

function buildStaticHeaders(file: R2ObjectBody, objectPath: string, isRangeResponse: boolean) {
  const headers = new Headers()
  applyHttpMetadataHeaders(headers, file.httpMetadata)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('ETag', file.httpEtag)
  headers.set('Content-Type', headers.get('Content-Type') || getMimeTypeFromPath(objectPath))
  headers.set('Cache-Control', `public, max-age=${CACHE_TTL}, immutable`)

  if (isRangeResponse && file.range && 'offset' in file.range && typeof file.range.offset === 'number') {
    const start = file.range.offset
    const length = typeof file.range.length === 'number' ? file.range.length : file.size - start
    const end = start + Math.max(length - 1, 0)
    headers.set('Content-Length', String(length))
    headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`)
    return { headers, status: 206 }
  }

  headers.set('Content-Length', String(file.size))
  return { headers, status: 200 }
}

function isDefaultThemeMusicPath(objectPath: string) {
  return objectPath.replace(/^\/+/, '') === DEFAULT_THEME_MUSIC_PATH
}

async function fetchFromR2(request: Request, objectPath: string) {
  const { env } = await getCloudflareContext({ async: true })
  const rangeHeader = getRangeHeader(request)
  let file: R2ObjectBody | null
  let isRangeResponse = false
  if (!rangeHeader) {
    file = await env.PODCAST_R2.get(objectPath)
  }
  else {
    const head = await env.PODCAST_R2.head(objectPath)
    if (!head) {
      if (isDefaultThemeMusicPath(objectPath)) {
        const fallbackUrl = new URL(DEFAULT_THEME_PUBLIC_PATH, request.url)
        return NextResponse.redirect(fallbackUrl, 307)
      }
      return new Response('Not Found', { status: 404 })
    }

    const parsedRange = parseRangeHeader(rangeHeader, head.size)
    if (parsedRange === 'unsatisfiable') {
      const headers = new Headers()
      applyHttpMetadataHeaders(headers, head.httpMetadata)
      headers.set('Content-Type', headers.get('Content-Type') || getMimeTypeFromPath(objectPath))
      headers.set('Accept-Ranges', 'bytes')
      headers.set('ETag', head.httpEtag)
      headers.set('Cache-Control', `public, max-age=${CACHE_TTL}, immutable`)
      headers.set('Content-Range', `bytes */${head.size}`)
      return new Response(null, { status: 416, headers })
    }

    if (!parsedRange) {
      file = await env.PODCAST_R2.get(objectPath)
    }
    else {
      file = await env.PODCAST_R2.get(objectPath, { range: parsedRange })
      isRangeResponse = true
    }
  }
  if (!file) {
    if (isDefaultThemeMusicPath(objectPath)) {
      const fallbackUrl = new URL(DEFAULT_THEME_PUBLIC_PATH, request.url)
      return NextResponse.redirect(fallbackUrl, 307)
    }
    return new Response('Not Found', { status: 404 })
  }

  const { headers, status } = buildStaticHeaders(file, objectPath, isRangeResponse)
  return new Response(file.body, { status, headers })
}

function buildCacheKey(request: Request): Request {
  const url = new URL(request.url)
  url.searchParams.delete('t')
  return new Request(url.toString(), {
    method: 'GET',
    headers: request.headers,
  })
}

async function handleWithCache(request: Request, objectPath: string) {
  // Range requests bypass the edge cache and are resolved directly from R2.
  if (getRangeHeader(request)) {
    return fetchFromR2(request, objectPath)
  }

  const cacheApi = (globalThis as { caches?: CacheStorage }).caches
  const cache = cacheApi?.default
  if (!cache) {
    return fetchFromR2(request, objectPath)
  }
  const cacheKey = buildCacheKey(request)
  const cached = await cache.match(cacheKey)
  if (cached) {
    return cached
  }

  const response = await fetchFromR2(request, objectPath)
  if (response.status === 200) {
    await cache.put(cacheKey, response.clone())
  }
  return response
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const objectPath = path.join('/')
  const redirect = tryWavToMp3Redirect(request, objectPath)
  if (redirect) {
    return redirect
  }
  return handleWithCache(request, objectPath)
}

export async function HEAD(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const objectPath = path.join('/')
  const redirect = tryWavToMp3Redirect(request, objectPath)
  if (redirect) {
    return redirect
  }
  const { env } = await getCloudflareContext({ async: true })
  const file = await env.PODCAST_R2.head(objectPath)
  if (!file) {
    if (isDefaultThemeMusicPath(objectPath)) {
      const fallbackUrl = new URL(DEFAULT_THEME_PUBLIC_PATH, request.url)
      return NextResponse.redirect(fallbackUrl, 307)
    }
    return new Response('Not Found', { status: 404 })
  }
  const headers = new Headers()
  applyHttpMetadataHeaders(headers, file.httpMetadata)
  headers.set('Content-Type', headers.get('Content-Type') || getMimeTypeFromPath(objectPath))
  headers.set('Content-Length', String(file.size))
  headers.set('Accept-Ranges', 'bytes')
  headers.set('ETag', file.httpEtag)
  headers.set('Cache-Control', `public, max-age=${CACHE_TTL}, immutable`)
  return new Response(null, { status: 200, headers })
}
