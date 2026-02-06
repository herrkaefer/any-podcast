export * from '../workflow'

interface Env extends CloudflareEnv {
  PODCAST_WORKFLOW: Workflow
  BROWSER: Fetcher
  PODCAST_SITE_URL?: string
  TRIGGER_TOKEN?: string
}

export default {
  runWorkflow(event: ScheduledEvent | Request, env: Env, ctx: ExecutionContext) {
    console.info('trigger event by:', event)

    const createWorkflow = async () => {
      const now = new Date()
      const isScheduled = 'scheduledTime' in event
      const instance = await env.PODCAST_WORKFLOW.create({
        params: {
          nowIso: isScheduled ? new Date(event.scheduledTime).toISOString() : now.toISOString(),
          windowMode: 'calendar',
        },
      })

      const instanceDetails = {
        id: instance.id,
        details: await instance.status(),
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
      return new Response(file?.body)
    }
    const siteUrl = env.PODCAST_SITE_URL ?? 'http://localhost:3000'
    return Response.redirect(new URL(pathname, siteUrl).toString(), 302)
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    return this.runWorkflow(event, env, ctx)
  },
}
