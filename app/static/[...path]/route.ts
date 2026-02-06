import { getCloudflareContext } from '@opennextjs/cloudflare'

function getMimeTypeFromPath(path: string) {
  const normalized = path.toLowerCase()
  if (normalized.endsWith('.wav')) {
    return 'audio/wav'
  }
  if (normalized.endsWith('.mp3')) {
    return 'audio/mpeg'
  }
  if (normalized.endsWith('.m4a')) {
    return 'audio/mp4'
  }
  if (normalized.endsWith('.ogg')) {
    return 'audio/ogg'
  }
  if (normalized.endsWith('.webm')) {
    return 'audio/webm'
  }
  return 'application/octet-stream'
}

function buildStaticHeaders(file: R2ObjectBody, objectPath: string) {
  const headers = new Headers()
  file.writeHttpMetadata(headers)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('ETag', file.httpEtag)
  headers.set('Content-Type', headers.get('Content-Type') || getMimeTypeFromPath(objectPath))

  if (file.range && 'offset' in file.range && typeof file.range.offset === 'number') {
    const start = file.range.offset
    const length = typeof file.range.length === 'number' ? file.range.length : file.size - start
    const end = start + Math.max(length - 1, 0)
    headers.set('Content-Length', String(length))
    headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`)
    return { headers, status: 206 }
  }

  headers.set('Content-Length', String(file.size))
  return { headers, status: 200 }
}

async function fetchStaticObject(request: Request, objectPath: string) {
  const { env } = await getCloudflareContext({ async: true })
  const file = await env.PODCAST_R2.get(objectPath, { range: request.headers })
  if (!file) {
    return new Response('Not Found', { status: 404 })
  }

  const { headers, status } = buildStaticHeaders(file, objectPath)
  return { file, headers, status }
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const objectPath = path.join('/')
  const result = await fetchStaticObject(request, objectPath)
  if (result instanceof Response) {
    return result
  }
  return new Response(result.file.body, {
    status: result.status,
    headers: result.headers,
  })
}

export async function HEAD(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const objectPath = path.join('/')
  const result = await fetchStaticObject(request, objectPath)
  if (result instanceof Response) {
    return result
  }
  return new Response(null, {
    status: result.status,
    headers: result.headers,
  })
}
