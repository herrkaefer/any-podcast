/**
 * Helpers for using the Cloudflare Cache API from Next.js route handlers.
 *
 * Workers responses are not cached by the CDN automatically, so a dynamic
 * route handler re-runs on every request. For read-only, expensive handlers
 * (like the RSS feed) that means repeated Workers KV / R2 calls per hit. The
 * Cache API lets us store the finished response at the edge so subsequent
 * requests in the same data center skip the backend work entirely.
 */

const EDGE_CACHE_VERSION = 'v1'
const EDGE_CACHE_QUERY_PARAM = '__edge_cache'

/**
 * Minimal structural type for the subset of the Cloudflare Cache API we use.
 * Declaring it locally avoids clashing with the DOM `CacheStorage` type that
 * TypeScript pulls in via the `dom` lib.
 */
export interface EdgeCacheStore {
  match: (request: Request) => Promise<Response | undefined>
  put: (request: Request, response: Response) => Promise<void>
  delete: (request: Request) => Promise<boolean>
}

export function getEdgeCache(): EdgeCacheStore | undefined {
  const cacheStorage = (globalThis as { caches?: { default?: EdgeCacheStore } }).caches
  return cacheStorage?.default
}

/**
 * Builds a canonical, query-string-free cache key for the given request so that
 * unrelated query params (tracking, cache busting) do not fragment the cache.
 */
export function buildEdgeCacheKey(request: Request, tag: string): Request {
  const url = new URL(request.url)
  url.search = ''
  url.searchParams.set(EDGE_CACHE_QUERY_PARAM, `${tag}:${EDGE_CACHE_VERSION}`)
  return new Request(url.toString(), { method: 'GET' })
}

function parseEtagCandidates(ifNoneMatch: string): string[] {
  return ifNoneMatch
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
}

export function matchesEtag(ifNoneMatch: string, etag: string | null | undefined): boolean {
  if (!etag) {
    return false
  }
  for (const candidate of parseEtagCandidates(ifNoneMatch)) {
    if (candidate === '*' || candidate === etag) {
      return true
    }
    if (candidate.startsWith('W/') && candidate.slice(2) === etag) {
      return true
    }
  }
  return false
}

/**
 * Returns true when the client's conditional headers match the stored
 * validators, meaning a 304 Not Modified response is appropriate.
 */
export function matchesConditionalRequest(
  request: Request,
  etag: string | null | undefined,
  lastModified: string | null | undefined,
): boolean {
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
    return true
  }

  const ifModifiedSince = request.headers.get('if-modified-since')
  if (ifModifiedSince && lastModified) {
    const requestedMs = Date.parse(ifModifiedSince)
    const lastModifiedMs = Date.parse(lastModified)
    if (Number.isFinite(requestedMs) && Number.isFinite(lastModifiedMs) && requestedMs >= lastModifiedMs) {
      return true
    }
  }

  return false
}

/**
 * Strips headers that should not be replayed from the edge cache. `Vary` is
 * removed because the Cache API does not reliably honor per-header variants and
 * a feed response is identical regardless of the incoming request headers.
 */
function toCacheableResponse(response: Response): Response {
  const cacheable = response.clone()
  cacheable.headers.delete('Vary')
  return cacheable
}

export interface EdgeCacheResult {
  response: Response | null
  cacheKey: Request | null
  cache: EdgeCacheStore | undefined
}

export async function readEdgeCache(request: Request, tag: string): Promise<EdgeCacheResult> {
  const cache = getEdgeCache()
  if (!cache) {
    return { response: null, cacheKey: null, cache }
  }

  let cacheKey: Request
  try {
    cacheKey = buildEdgeCacheKey(request, tag)
  }
  catch (error) {
    console.warn('edge cache key build failed', {
      tag,
      error: error instanceof Error ? error.message : String(error),
    })
    return { response: null, cacheKey: null, cache }
  }

  try {
    const response = await cache.match(cacheKey)
    return { response: response ?? null, cacheKey, cache }
  }
  catch (error) {
    console.warn('edge cache lookup failed', {
      tag,
      error: error instanceof Error ? error.message : String(error),
    })
    return { response: null, cacheKey, cache }
  }
}

/**
 * Removes a cached entry so the next request rebuilds it. Safe to call from a
 * worker that shares the same zone/host as the cached route.
 */
export async function purgeEdgeCache(request: Request, tag: string): Promise<void> {
  const cache = getEdgeCache()
  if (!cache) {
    return
  }

  try {
    const cacheKey = buildEdgeCacheKey(request, tag)
    await cache.delete(cacheKey)
  }
  catch (error) {
    console.warn('edge cache purge failed', {
      tag,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function writeEdgeCache(cache: EdgeCacheStore | undefined, cacheKey: Request | null, response: Response): Promise<void> | undefined {
  if (!cache || !cacheKey || response.status !== 200) {
    return undefined
  }

  return cache.put(cacheKey, toCacheableResponse(response)).catch((error) => {
    console.warn('edge cache write failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
