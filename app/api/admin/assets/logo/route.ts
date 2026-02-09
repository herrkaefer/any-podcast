import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { podcastId } from '@/config'
import { jsonError } from '@/lib/admin-api'
import { requireAdminSession } from '@/lib/admin-auth'

function extensionFromFile(file: File) {
  const byName = file.name.split('.').pop()?.toLowerCase()
  if (byName) {
    return byName
  }
  if (file.type.includes('png')) {
    return 'png'
  }
  if (file.type.includes('svg')) {
    return 'svg'
  }
  if (file.type.includes('webp')) {
    return 'webp'
  }
  if (file.type.includes('jpeg') || file.type.includes('jpg')) {
    return 'jpg'
  }
  return 'bin'
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    return jsonError('Unauthorized', 401)
  }

  let form: FormData
  try {
    form = await request.formData()
  }
  catch {
    return jsonError('request must use multipart/form-data', 400)
  }
  const value = form.get('file')
  if (!(value instanceof File)) {
    return jsonError('file is required', 400)
  }

  if (!value.type.startsWith('image/')) {
    return jsonError('file must be image/*', 400)
  }

  const MAX_LOGO_SIZE = 5 * 1024 * 1024 // 5MB
  if (value.size > MAX_LOGO_SIZE) {
    return jsonError(`file too large: ${(value.size / 1024 / 1024).toFixed(1)}MB, max 5MB`, 400)
  }

  const ext = extensionFromFile(value)
  const key = `assets/${podcastId}/logo/${Date.now()}.${ext}`
  const bytes = await value.arrayBuffer()

  await adminEnv.PODCAST_R2.put(key, bytes, {
    httpMetadata: {
      contentType: value.type || undefined,
    },
  })

  return NextResponse.json({
    ok: true,
    key,
    url: `/static/${key}`,
  })
}
