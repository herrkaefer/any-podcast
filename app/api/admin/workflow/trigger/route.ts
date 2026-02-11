import process from 'node:process'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { jsonError, parseJsonWithSchema } from '@/lib/admin-api'
import { requireAdminSession } from '@/lib/admin-auth'
import { workflowTriggerSchema } from '@/lib/schemas/admin'

interface TriggerResponseBody {
  ok?: boolean
  endpoint?: string
  mode?: 'local' | 'production' | 'service-binding'
  nowIso?: string | null
  result?: string
  error?: string
}

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function isLocalRequest(request: Request, env: AdminEnv) {
  const requestUrl = new URL(request.url)
  if (isLocalHostname(requestUrl.hostname)) {
    return true
  }
  if (env.NODE_ENV === 'development' || process.env.NODE_ENV === 'development') {
    return true
  }
  return false
}

function resolveLocalWorkerUrl() {
  return 'http://localhost:8787'
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

async function triggerViaServiceBinding(
  serviceBinding: Fetcher,
  token: string,
  nowIso: string | undefined,
): Promise<{ workerResponse: Response, mode: TriggerResponseBody['mode'], endpoint: string }> {
  const url = new URL('https://worker.internal/trigger')
  url.searchParams.set('token', token)

  console.info('[trigger-route] using service binding, path: /trigger')
  const workerResponse = await serviceBinding.fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nowIso }),
  })
  return { workerResponse, mode: 'service-binding', endpoint: '/trigger (service-binding)' }
}

async function triggerViaHttp(
  workerBaseUrl: string,
  token: string | undefined,
  nowIso: string | undefined,
  localMode: boolean,
): Promise<{ workerResponse: Response, mode: TriggerResponseBody['mode'], endpoint: string }> {
  const target = new URL(workerBaseUrl)
  target.pathname = localMode ? '/' : '/trigger'
  target.search = ''

  if (!localMode && token) {
    target.searchParams.set('token', token)
  }

  const fetchUrl = target.toString()
  console.info('[trigger-route] HTTP fetch:', fetchUrl.replace(/token=[^&]+/, 'token=***'))
  const workerResponse = await fetch(fetchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nowIso }),
  })
  return {
    workerResponse,
    mode: localMode ? 'local' : 'production',
    endpoint: `${target.origin}${target.pathname}`,
  }
}

export async function POST(request: Request) {
  console.info('[trigger-route] POST received', request.url)
  const { env } = await getCloudflareContext({ async: true })
  const adminEnv = env as AdminEnv
  const session = await requireAdminSession(request, adminEnv)
  if (!session) {
    console.info('[trigger-route] unauthorized - no session')
    return jsonError('Unauthorized', 401)
  }

  try {
    const payload = await parseJsonWithSchema(request, workflowTriggerSchema)
    const nowIso = parseNowIsoOrThrow(payload.nowIso)
    const localMode = isLocalRequest(request, adminEnv)
    const token = adminEnv.TRIGGER_TOKEN?.trim()

    let triggerResult: { workerResponse: Response, mode: TriggerResponseBody['mode'], endpoint: string }

    if (!localMode && adminEnv.PODCAST_WORKER_SERVICE) {
      // Production: use service binding (avoids Cloudflare error 1042)
      if (!token) {
        return jsonError('TRIGGER_TOKEN is required for production workflow trigger', 400)
      }
      triggerResult = await triggerViaServiceBinding(adminEnv.PODCAST_WORKER_SERVICE, token, nowIso)
    }
    else {
      // Local dev: use HTTP fetch
      const workerBaseUrl = localMode
        ? resolveLocalWorkerUrl()
        : (adminEnv.PODCAST_WORKER_URL?.trim() || process.env.PODCAST_WORKER_URL?.trim())
      if (!workerBaseUrl) {
        return jsonError('PODCAST_WORKER_SERVICE binding or PODCAST_WORKER_URL is required', 400)
      }
      if (!localMode && !token) {
        return jsonError('TRIGGER_TOKEN is required for production workflow trigger', 400)
      }
      triggerResult = await triggerViaHttp(workerBaseUrl, token, nowIso, localMode)
    }

    const { workerResponse, mode, endpoint } = triggerResult
    const result = await workerResponse.text()
    console.info('[trigger-route] worker response:', workerResponse.status, result.slice(0, 200))

    if (!workerResponse.ok) {
      return jsonError(result || `Workflow trigger failed with status ${workerResponse.status}`, workerResponse.status)
    }

    return NextResponse.json({
      ok: true,
      endpoint,
      mode,
      nowIso: nowIso || null,
      result: result || 'create workflow success',
    } satisfies TriggerResponseBody)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to trigger workflow'
    console.error('[trigger-route] error:', message)
    return jsonError(message, 400)
  }
}
