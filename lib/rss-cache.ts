import { purgeEdgeCache } from '@/lib/edge-cache'

/** How long a finished RSS response may live in Cloudflare's edge cache. */
export const RSS_EDGE_CACHE_TTL_SECONDS = 3600

const RSS_EDGE_CACHE_TAG = 'rss-feed'

export function getRssCacheTag(runEnv: string) {
  return `${RSS_EDGE_CACHE_TAG}:${runEnv}`
}

/**
 * Best-effort invalidation of the cached feed for the current site.
 *
 * The Cloudflare Cache API is per-data-center, so this only clears the edge
 * cache entry where the write happened. Everywhere else the feed refreshes
 * within RSS_EDGE_CACHE_TTL_SECONDS, which matches the previous `revalidate`
 * behavior.
 */
export async function invalidateRssEdgeCache(baseUrl: string, runEnv: string): Promise<void> {
  const normalized = baseUrl.replace(/\/$/, '')
  if (!normalized) {
    return
  }

  try {
    await purgeEdgeCache(new Request(`${normalized}/rss.xml`), getRssCacheTag(runEnv))
  }
  catch (error) {
    console.warn('invalidate rss edge cache failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
