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

export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    return jsonError('Unauthorized', 401)
  }

  const { searchParams } = new URL(request.url)
  const limitRaw = Number.parseInt(searchParams.get('limit') || '20', 10)
  const limit = Number.isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 100)
  const cursor = searchParams.get('cursor') || undefined
  const runEnv = adminEnv.NODE_ENV || 'production'
  const prefix = buildContentPrefix(runEnv)

  const listed = await adminEnv.PODCAST_KV.list({ prefix, limit, cursor })
  const items = await Promise.all(listed.keys.map(async (entry) => {
    const value = await adminEnv.PODCAST_KV.get(entry.name, 'json') as Article | null
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

  return NextResponse.json({
    items: items.filter((item): item is EpisodeListItem => Boolean(item)),
    cursor: listed.list_complete ? undefined : listed.cursor,
    listComplete: listed.list_complete,
  })
}
