import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { buildContentPrefix } from '@/config'
import { jsonError } from '@/lib/admin-api'
import { requireAdminSession } from '@/lib/admin-auth'

interface EpisodeListItem {
  date: string
  title: string
  publishedAt?: string
  updatedAt?: number
  audio?: string
  configVersion?: string
}

function getEpisodeSortTime(item: EpisodeListItem): number {
  if (item.publishedAt) {
    const publishedAt = Date.parse(item.publishedAt)
    if (!Number.isNaN(publishedAt)) {
      return publishedAt
    }
  }

  const dateValue = Date.parse(`${item.date}T00:00:00Z`)
  if (!Number.isNaN(dateValue)) {
    return dateValue
  }

  return item.updatedAt ?? 0
}

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    return jsonError('Unauthorized', 401)
  }

  const { searchParams } = new URL(request.url)
  const pageRaw = Number.parseInt(searchParams.get('page') || '1', 10)
  const pageSizeRaw = Number.parseInt(searchParams.get('pageSize') || searchParams.get('limit') || '20', 10)
  const requestedPage = Number.isNaN(pageRaw) ? 1 : Math.max(pageRaw, 1)
  const pageSize = Number.isNaN(pageSizeRaw) ? 20 : Math.min(Math.max(pageSizeRaw, 1), 100)
  const runEnv = adminEnv.NODE_ENV || 'production'
  const prefix = buildContentPrefix(runEnv)

  const entryNames: string[] = []
  let cursor: string | undefined

  do {
    const listed = await adminEnv.PODCAST_KV.list({
      prefix,
      cursor,
      limit: 1000,
    })
    entryNames.push(...listed.keys.map(entry => entry.name))
    cursor = listed.list_complete ? undefined : listed.cursor
  } while (cursor)

  const items = await Promise.all(entryNames.map(async (entryName) => {
    const value = await adminEnv.PODCAST_KV.get(entryName, 'json') as Article | null
    if (!value) {
      return null
    }
    const summary: EpisodeListItem = {
      date: value.date,
      title: value.title,
      publishedAt: value.publishedAt,
      updatedAt: value.updatedAt,
      audio: value.audio,
      configVersion: value.configVersion,
    }
    return summary
  }))
  const sortedItems = items
    .filter((item): item is EpisodeListItem => Boolean(item))
    .sort((left, right) => getEpisodeSortTime(right) - getEpisodeSortTime(left))
  const total = sortedItems.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const startIndex = (page - 1) * pageSize
  const pagedItems = sortedItems.slice(startIndex, startIndex + pageSize)

  return NextResponse.json({
    items: pagedItems,
    page,
    pageSize,
    total,
    totalPages,
    cursor: undefined,
    listComplete: true,
  })
}
