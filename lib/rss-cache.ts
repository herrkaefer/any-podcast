/**
 * The RSS feed is expensive to build: one KV list plus a KV get and an R2 head
 * per episode (roughly 120 of each for a 120-episode show). Podcast platforms
 * poll feeds constantly, so building per request burns the Workers KV quota.
 *
 * Instead the finished XML is stored as a small object in the site's R2 bucket
 * and shared globally. A request rebuilds only when that snapshot is missing or
 * older than RSS_SNAPSHOT_TTL_SECONDS; every other request pays a single R2 read
 * (or a CDN hit) instead of the KV fan-out.
 *
 * Snapshots are keyed by host because feed links and episode guids embed the
 * serving origin. Sharing one document across hosts would rewrite every guid
 * whenever a different host happened to trigger the build.
 */

/** How long the globally shared snapshot stays fresh. */
export const RSS_SNAPSHOT_TTL_SECONDS = 1800

/** How long the CDN may cache the feed. Kept short so edits show up quickly. */
export const RSS_CDN_CACHE_TTL_SECONDS = 300

/** How long podcast clients may cache the feed document themselves. */
export const RSS_CLIENT_CACHE_TTL_SECONDS = 3600

/**
 * Normalizes a host into a safe object-key segment. Keeping this deterministic
 * matters: a changed key would silently orphan the previous snapshot.
 */
export function normalizeHostKey(host: string): string {
  return host.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '_') || 'unknown-host'
}

export function buildFeedSnapshotKey(runEnv: string, hostKey: string) {
  return `feeds/${runEnv}/${normalizeHostKey(hostKey)}/rss.xml`
}

export interface FeedSnapshot {
  xml: string
  etag: string
  lastModified: string
}

/**
 * Reads the prebuilt feed XML and reports its age so callers can decide whether
 * to serve it or rebuild.
 */
export async function readFeedSnapshot(
  bucket: R2Bucket,
  runEnv: string,
  hostKey: string,
): Promise<{ snapshot: FeedSnapshot, ageSeconds: number } | null> {
  try {
    const object = await bucket.get(buildFeedSnapshotKey(runEnv, hostKey))
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
  hostKey: string,
  snapshot: FeedSnapshot,
): Promise<void> {
  try {
    await bucket.put(buildFeedSnapshotKey(runEnv, hostKey), snapshot.xml, {
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
 * Deletes the snapshot so the next request rebuilds the feed from current
 * content. Called after admin writes and after the workflow publishes episodes.
 */
export async function invalidateFeedSnapshot(bucket: R2Bucket, runEnv: string, hostKey: string): Promise<void> {
  try {
    await bucket.delete(buildFeedSnapshotKey(runEnv, hostKey))
  }
  catch (error) {
    console.warn('invalidate feed snapshot failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function isFeedSnapshotFresh(ageSeconds: number): boolean {
  return Number.isFinite(ageSeconds) && ageSeconds < RSS_SNAPSHOT_TTL_SECONDS
}

function matchesEtag(ifNoneMatch: string, etag: string): boolean {
  for (const candidate of ifNoneMatch.split(',').map(part => part.trim()).filter(Boolean)) {
    if (candidate === '*' || candidate === etag) {
      return true
    }
    if (candidate.startsWith('W/') && candidate.slice(2) === etag) {
      return true
    }
  }
  return false
}

/** True when the client's conditional headers allow a 304 Not Modified. */
export function matchesConditionalRequest(
  request: Request,
  etag: string | null | undefined,
  lastModified: string | null | undefined,
): boolean {
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && etag && matchesEtag(ifNoneMatch, etag)) {
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
