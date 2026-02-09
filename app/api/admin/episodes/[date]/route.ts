import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { buildContentKey } from '@/config'
import { jsonError, parseJsonWithSchema } from '@/lib/admin-api'
import { requireAdminSession } from '@/lib/admin-auth'
import { episodePatchSchema } from '@/lib/schemas/admin'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isValidDateParam(date: string): boolean {
  if (!DATE_PATTERN.test(date)) {
    return false
  }
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime())
}

function getRunEnv(env: AdminEnv) {
  return env.NODE_ENV || 'production'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    return jsonError('Unauthorized', 401)
  }

  const { date } = await params
  if (!isValidDateParam(date)) {
    return jsonError('Invalid date format, expected YYYY-MM-DD', 400)
  }
  const key = buildContentKey(getRunEnv(adminEnv), date)
  const value = await adminEnv.PODCAST_KV.get(key, 'json') as Article | null
  if (!value) {
    return jsonError('Episode not found', 404)
  }
  return NextResponse.json({ item: value })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    return jsonError('Unauthorized', 401)
  }

  try {
    const { date } = await params
    if (!isValidDateParam(date)) {
      return jsonError('Invalid date format, expected YYYY-MM-DD', 400)
    }
    const key = buildContentKey(getRunEnv(adminEnv), date)
    const current = await adminEnv.PODCAST_KV.get(key, 'json') as Article | null
    if (!current) {
      return jsonError('Episode not found', 404)
    }

    const patch = await parseJsonWithSchema(request, episodePatchSchema)
    const next: Article = {
      ...current,
      ...patch,
      date: current.date,
      updatedAt: Date.now(),
      updatedBy: session.user,
    }

    await adminEnv.PODCAST_KV.put(key, JSON.stringify(next))
    return NextResponse.json({ ok: true, item: next })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to patch episode'
    return jsonError(message, 400)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    return jsonError('Unauthorized', 401)
  }

  const { date } = await params
  if (!isValidDateParam(date)) {
    return jsonError('Invalid date format, expected YYYY-MM-DD', 400)
  }
  const key = buildContentKey(getRunEnv(adminEnv), date)
  const current = await adminEnv.PODCAST_KV.get(key, 'json') as Article | null
  if (!current) {
    return jsonError('Episode not found', 404)
  }

  const { searchParams } = new URL(request.url)
  const keepAudio = searchParams.get('keepAudio') === 'true'

  await adminEnv.PODCAST_KV.delete(key)
  if (!keepAudio && current.audio) {
    await adminEnv.PODCAST_R2.delete(current.audio).catch((error) => {
      console.warn('delete episode audio failed', {
        key: current.audio,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  return NextResponse.json({
    ok: true,
    deleted: {
      date,
      key,
      audio: current.audio || '',
      keepAudio,
    },
  })
}
