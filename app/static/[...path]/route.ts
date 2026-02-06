import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'

const CACHE_TTL = 60 * 60 * 24 * 30 // 30 days

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

function buildStaticHeaders(file: R2ObjectBody, objectPath: string) {
  const headers = new Headers()
  file.writeHttpMetadata(headers)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('ETag', file.httpEtag)
  headers.set('Content-Type', headers.get('Content-Type') || getMimeTypeFromPath(objectPath))
  headers.set('Cache-Control', `public, max-age=${CACHE_TTL}, immutable`)

  if (file.range && 'offset' in file.range && typeof file.range.offset === 'number') {
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

async function fetchFromR2(request: Request, objectPath: string) {
  const { env } = await getCloudflareContext({ async: true })
  const file = await env.PODCAST_R2.get(objectPath, { range: request.headers })
  if (!file) {
    return new Response('Not Found', { status: 404 })
  }

  const { headers, status } = buildStaticHeaders(file, objectPath)
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
  // Range requests bypass the cache — they are only triggered after
  // the browser already has a full response cached locally
  if (request.headers.has('Range')) {
    return fetchFromR2(request, objectPath)
  }

  const cache = caches.default
  const cacheKey = buildCacheKey(request)
  const cached = await cache.match(cacheKey)
  if (cached) {
    return cached
  }

  const response = await fetchFromR2(request, objectPath)
  if (response.status === 200) {
    cache.put(cacheKey, response.clone())
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
    return new Response('Not Found', { status: 404 })
  }
  const headers = new Headers()
  file.writeHttpMetadata(headers)
  headers.set('Content-Type', headers.get('Content-Type') || getMimeTypeFromPath(objectPath))
  headers.set('Content-Length', String(file.size))
  headers.set('Accept-Ranges', 'bytes')
  headers.set('ETag', file.httpEtag)
  headers.set('Cache-Control', `public, max-age=${CACHE_TTL}, immutable`)
  return new Response(null, { status: 200, headers })
}
