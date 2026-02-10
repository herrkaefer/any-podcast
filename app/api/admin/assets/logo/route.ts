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

function isSupportedImageFile(file: File) {
  if (file.type.startsWith('image/')) {
    return true
  }
  const ext = extensionFromFile(file)
  return new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp', 'ico', 'avif', 'heic', 'heif', 'tif', 'tiff']).has(ext)
}

function contentTypeFromExtension(ext: string) {
  if (ext === 'png')
    return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg')
    return 'image/jpeg'
  if (ext === 'webp')
    return 'image/webp'
  if (ext === 'svg')
    return 'image/svg+xml'
  if (ext === 'gif')
    return 'image/gif'
  if (ext === 'bmp')
    return 'image/bmp'
  if (ext === 'ico')
    return 'image/x-icon'
  if (ext === 'avif')
    return 'image/avif'
  if (ext === 'heic')
    return 'image/heic'
  if (ext === 'heif')
    return 'image/heif'
  if (ext === 'tif' || ext === 'tiff')
    return 'image/tiff'
  return undefined
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

  if (!isSupportedImageFile(value)) {
    return jsonError(
      `unsupported logo file: name="${value.name}", type="${value.type || '(empty)'}". allowed: image/* or common image extensions`,
      400,
    )
  }

  const MAX_LOGO_SIZE = 20 * 1024 * 1024 // 20MB
  if (value.size > MAX_LOGO_SIZE) {
    return jsonError(`file too large: ${(value.size / 1024 / 1024).toFixed(1)}MB, max 20MB`, 400)
  }

  const ext = extensionFromFile(value)
  const key = `assets/${podcastId}/logo/${Date.now()}.${ext}`
  const bytes = await value.arrayBuffer()
  const contentType = value.type || contentTypeFromExtension(ext)

  await adminEnv.PODCAST_R2.put(key, bytes, {
    httpMetadata: {
      contentType,
    },
  })

  return NextResponse.json({
    ok: true,
    key,
    url: `/static/${key}`,
  })
}
