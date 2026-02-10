import process from 'node:process'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { jsonError, parseJsonWithSchema } from '@/lib/admin-api'
import { requireAdminSession } from '@/lib/admin-auth'
import { workflowTriggerSchema } from '@/lib/schemas/admin'

interface TriggerResponseBody {
  ok?: boolean
  endpoint?: string
  mode?: 'local' | 'production'
  nowIso?: string | null
  result?: string
  error?: string
}

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function resolveWorkerBaseUrl(request: Request, env: AdminEnv) {
  const configured = env.PODCAST_WORKER_URL?.trim() || process.env.PODCAST_WORKER_URL?.trim()
  if (configured) {
    return configured
  }

  const requestUrl = new URL(request.url)
  if (isLocalHostname(requestUrl.hostname)) {
    return 'http://localhost:8787'
  }

  if (env.NODE_ENV === 'development' || process.env.NODE_ENV === 'development') {
    return 'http://localhost:8787'
  }

  throw new Error('PODCAST_WORKER_URL is required (configure it on web app env)')
}

function parseNowIsoOrThrow(raw: string | undefined) {
  if (!raw || !raw.trim()) {
    return undefined
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('nowIso must be a valid datetime')
  }
  return parsed.toISOString()
}

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    return jsonError('Unauthorized', 401)
  }

  try {
    const payload = await parseJsonWithSchema(request, workflowTriggerSchema)
    const nowIso = parseNowIsoOrThrow(payload.nowIso)
    const workerBaseUrl = resolveWorkerBaseUrl(request, adminEnv)
    const target = new URL(workerBaseUrl)
    const localMode = isLocalHostname(target.hostname)
    target.pathname = localMode ? '/' : '/trigger'
    target.search = ''

    if (!localMode) {
      const token = adminEnv.TRIGGER_TOKEN?.trim()
      if (!token) {
        return jsonError('TRIGGER_TOKEN is required for production workflow trigger', 400)
      }
      target.searchParams.set('token', token)
    }

    const workerResponse = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nowIso,
      }),
    })

    const result = await workerResponse.text()
    if (!workerResponse.ok) {
      return jsonError(result || `Workflow trigger failed with status ${workerResponse.status}`, workerResponse.status)
    }

    return NextResponse.json({
      ok: true,
      endpoint: `${target.origin}${target.pathname}`,
      mode: localMode ? 'local' : 'production',
      nowIso: nowIso || null,
      result: result || 'create workflow success',
    } satisfies TriggerResponseBody)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to trigger workflow'
    return jsonError(message, 400)
  }
}
