export * from '../workflow'

type WindowMode = 'calendar' | 'rolling'

interface WorkflowTriggerParams {
  nowIso?: string
  today?: string
  windowMode?: WindowMode
  windowHours?: number
}

interface Env extends CloudflareEnv {
  PODCAST_WORKFLOW: Workflow
  BROWSER: Fetcher
  PODCAST_SITE_URL?: string
  TRIGGER_TOKEN?: string
}

function toDateIsoOrThrow(raw: unknown, field: string) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined
  }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${field} must be a valid ISO datetime`)
  }
  return date.toISOString()
}

function toDateKeyOrThrow(raw: unknown, field: string) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new TypeError(`${field} must be in YYYY-MM-DD format`)
  }
  return raw
}

function toWindowModeOrThrow(raw: unknown, field: string): WindowMode | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined
  }
  if (raw === 'calendar' || raw === 'rolling') {
    return raw
  }
  throw new TypeError(`${field} must be "calendar" or "rolling"`)
}

function toWindowHoursOrThrow(raw: unknown, field: string) {
  if (raw === undefined || raw === null || raw === '') {
    return undefined
  }
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
  if (!Number.isFinite(value) || value <= 0 || value > 168) {
    throw new TypeError(`${field} must be an integer between 1 and 168`)
  }
  return value
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return {}
  }
  const raw = await request.clone().text()
  if (!raw.trim()) {
    return {}
  }
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

async function getRequestWorkflowParams(request: Request): Promise<WorkflowTriggerParams> {
  const now = new Date()
  const searchParams = new URL(request.url).searchParams
  const body = await readJsonBody(request)

  const nowIsoRaw = searchParams.get('nowIso')
    || searchParams.get('now')
    || body.nowIso
    || body.now
    || now.toISOString()
  const todayRaw = searchParams.get('today') || body.today
  const windowModeRaw = searchParams.get('windowMode') || body.windowMode || 'calendar'
  const windowHoursRaw = searchParams.get('windowHours') || body.windowHours

  return {
    nowIso: toDateIsoOrThrow(nowIsoRaw, 'nowIso'),
    today: toDateKeyOrThrow(todayRaw, 'today'),
    windowMode: toWindowModeOrThrow(windowModeRaw, 'windowMode'),
    windowHours: toWindowHoursOrThrow(windowHoursRaw, 'windowHours'),
  }
}

function getScheduledWorkflowParams(event: ScheduledEvent): WorkflowTriggerParams {
  return {
    nowIso: new Date(event.scheduledTime).toISOString(),
    windowMode: 'calendar',
  }
}

export default {
  async runWorkflow(event: ScheduledEvent | Request, env: Env, ctx: ExecutionContext) {
    console.info('trigger event by:', event)
    const isScheduled = 'scheduledTime' in event

    let triggerParams: WorkflowTriggerParams
    try {
      triggerParams = isScheduled
        ? getScheduledWorkflowParams(event)
        : await getRequestWorkflowParams(event)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid trigger payload'
      console.warn('invalid workflow trigger payload', { message })
      return new Response(message, { status: 400 })
    }

    const createWorkflow = async () => {
      const instance = await env.PODCAST_WORKFLOW.create({
        params: triggerParams,
      })

      const instanceDetails = {
        id: instance.id,
        details: await instance.status(),
        params: triggerParams,
      }

      console.info('instance detail:', instanceDetails)
      return instanceDetails
    }

    ctx.waitUntil(createWorkflow())

    return new Response('create workflow success')
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const { pathname, hostname, searchParams } = new URL(request.url)
    if (request.method === 'POST' && hostname === 'localhost') {
      // curl -X POST http://localhost:8787
      return this.runWorkflow(request, env, ctx)
    }
    if (pathname === '/trigger' && request.method === 'POST') {
      const token = searchParams.get('token')
      if (!env.TRIGGER_TOKEN || token !== env.TRIGGER_TOKEN) {
        return new Response('Unauthorized', { status: 401 })
      }
      return this.runWorkflow(request, env, ctx)
    }
    if (pathname === '/audio' || pathname === '/audio.html') {
      return env.ASSETS.fetch(request)
    }
    if (pathname.includes('/static')) {
      const filename = pathname.replace('/static/', '')
      const file = await env.PODCAST_R2.get(filename)
      console.info('fetch static file:', filename, {
        uploaded: file?.uploaded,
        size: file?.size,
      })
      if (file) {
        return new Response(file.body)
      }

      // Fallback for local assets (e.g. worker/static/theme.mp3).
      const fallbackAsset = await env.ASSETS.fetch(new URL(`/${filename}`, request.url).toString())
      if (fallbackAsset.ok) {
        console.info('fetch static file fallback to assets:', filename)
        return fallbackAsset
      }

      return new Response(`Static file not found: ${filename}`, { status: 404 })
    }
    const siteUrl = env.PODCAST_SITE_URL ?? 'http://localhost:3000'
    return Response.redirect(new URL(pathname, siteUrl).toString(), 302)
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    return this.runWorkflow(event, env, ctx)
  },
}
