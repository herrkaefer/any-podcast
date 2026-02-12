import type { PodcastPlatform, PodcastPlatformId } from '@/types/podcast'
import type { RuntimeExternalLink, RuntimeExternalPlatformId } from '@/types/runtime-config'

export const CONFIGURABLE_PLATFORM_OPTIONS: ReadonlyArray<{
  id: RuntimeExternalPlatformId
  name: string
}> = [
  { id: 'apple', name: 'Apple Podcasts' },
  { id: 'spotify', name: 'Spotify' },
  { id: 'youtube', name: 'YouTube' },
  { id: 'xiaoyuzhou', name: '小宇宙' },
]

const RSS_PLATFORM: { id: PodcastPlatformId, name: string } = {
  id: 'rss',
  name: 'RSS',
}

const CONFIGURABLE_PLATFORM_SET = new Set<RuntimeExternalPlatformId>(
  CONFIGURABLE_PLATFORM_OPTIONS.map(option => option.id),
)

export function isConfigurablePlatformId(value: string): value is RuntimeExternalPlatformId {
  return CONFIGURABLE_PLATFORM_SET.has(value as RuntimeExternalPlatformId)
}

export function normalizeRuntimeExternalLinks(value: unknown): RuntimeExternalLink[] {
  if (!Array.isArray(value)) {
    return []
  }

  const deduped = new Map<RuntimeExternalPlatformId, RuntimeExternalLink>()
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const source = item as Record<string, unknown>
    const platformRaw = typeof source.platform === 'string' ? source.platform.trim().toLowerCase() : ''
    if (!isConfigurablePlatformId(platformRaw)) {
      continue
    }

    const url = typeof source.url === 'string' ? source.url.trim() : ''
    if (!url) {
      continue
    }

    const icon = typeof source.icon === 'string' ? source.icon.trim() : ''
    deduped.set(platformRaw, {
      platform: platformRaw,
      url,
      icon: icon || undefined,
    })
  }

  const ordered: RuntimeExternalLink[] = []
  for (const option of CONFIGURABLE_PLATFORM_OPTIONS) {
    const item = deduped.get(option.id)
    if (item) {
      ordered.push(item)
    }
  }
  return ordered
}

export function buildPodcastPlatforms(
  externalLinks: unknown,
  rssUrl: string,
): PodcastPlatform[] {
  const byId = new Map<RuntimeExternalPlatformId, string>()
  for (const item of normalizeRuntimeExternalLinks(externalLinks)) {
    byId.set(item.platform, item.url)
  }

  const list: PodcastPlatform[] = []
  for (const option of CONFIGURABLE_PLATFORM_OPTIONS) {
    const link = byId.get(option.id)
    if (!link) {
      continue
    }
    list.push({
      id: option.id,
      name: option.name,
      link,
    })
  }

  const normalizedRssUrl = rssUrl.trim() || '/rss.xml'
  list.push({
    id: RSS_PLATFORM.id,
    name: RSS_PLATFORM.name,
    link: normalizedRssUrl,
  })
  return list
}
