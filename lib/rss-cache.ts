import { purgeEdgeCache } from '@/lib/edge-cache'

/**
 * How long a finished RSS response may live in Cloudflare's edge cache.
 *
 * This is the per-data-center cache, so it is deliberately short: each colo
 * re-reads the (global) R2 snapshot every few minutes, but that is a cheap R2
 * read rather than the expensive KV fan-out used to build the feed.
 */
export const RSS_EDGE_CACHE_TTL_SECONDS = 300

/**
 * How long the globally shared, prebuilt feed snapshot stays fresh. Past this
 * the next cache miss rebuilds from KV. Because the snapshot lives in R2 (one
 * bucket per podcast), a rebuild happens at most once per TTL for the whole
 * site instead of once per data center.
 */
export const RSS_SNAPSHOT_TTL_SECONDS = 1800

/** Client-facing freshness for the feed document itself. */
export const RSS_CLIENT_CACHE_TTL_SECONDS = 3600

const RSS_EDGE_CACHE_TAG = 'rss-feed'

export function getRssCacheTag(runEnv: string) {
  return `${RSS_EDGE_CACHE_TAG}:${runEnv}`
}

export function buildFeedSnapshotKey(runEnv: string) {
  return `feeds/${runEnv}/rss.xml`
}

export interface FeedSnapshot {
  xml: string
  etag: string
  lastModified: string
}

function parseLastModified(value: unknown): number {
  if (typeof value !== 'string') {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Reads the prebuilt feed XML from the site's R2 bucket. Returns the document
 * plus how old it is so callers can decide whether to serve it or rebuild.
 */
export async function readFeedSnapshot(
  bucket: R2Bucket,
  runEnv: string,
): Promise<{ snapshot: FeedSnapshot, ageSeconds: number } | null> {
  try {
    const object = await bucket.get(buildFeedSnapshotKey(runEnv))
    if (!object) {
      return null
    }

    const xml = await object.text()
    const metadata = object.customMetadata ?? {}
    const builtAt = Number.parseInt(metadata.builtAt ?? '', 10)
    const ageSeconds = Number.isFinite(builtAt) && builtAt > 0
      ? Math.max(0, Math.floor((Date.now() - builtAt) / 1000))
      : Number.POSITIVE_INFINITY

    return {
      snapshot: {
        xml,
        etag: metadata.etag || `"snapshot-${builtAt || 0}"`,
        lastModified: metadata.lastModified || new Date(builtAt || Date.now()).toUTCString(),
      },
      ageSeconds,
    }
  }
  catch (error) {
    console.warn('read feed snapshot failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function writeFeedSnapshot(
  bucket: R2Bucket,
  runEnv: string,
  snapshot: FeedSnapshot,
): Promise<void> {
  try {
    await bucket.put(buildFeedSnapshotKey(runEnv), snapshot.xml, {
      customMetadata: {
        builtAt: String(Date.now()),
        etag: snapshot.etag,
        lastModified: snapshot.lastModified,
      },
      httpMetadata: {
        contentType: 'application/xml; charset=utf-8',
      },
    })
  }
  catch (error) {
    console.warn('write feed snapshot failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Drops the per-colo cache entry and the global R2 snapshot so the next request
 * rebuilds the feed from current content. Used by admin writes.
 */
export async function invalidateRssFeed(baseUrl: string, runEnv: string, bucket?: R2Bucket): Promise<void> {
  const normalized = baseUrl.replace(/\/$/, '')
  if (normalized) {
    try {
      await purgeEdgeCache(new Request(`${normalized}/rss.xml`), getRssCacheTag(runEnv))
    }
    catch (error) {
      console.warn('invalidate rss edge cache failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (bucket) {
    try {
      await bucket.delete(buildFeedSnapshotKey(runEnv))
    }
    catch (error) {
      console.warn('invalidate rss snapshot failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export function isFeedSnapshotFresh(ageSeconds: number): boolean {
  return Number.isFinite(ageSeconds) && ageSeconds < RSS_SNAPSHOT_TTL_SECONDS
}

export function getFeedLastModifiedMs(lastModified: string): number {
  return parseLastModified(lastModified)
}
