import { DurableObject } from 'cloudflare:workers'
import { RenderRequestQueue } from '../workflow/render-rate-limit'

interface RenderEnv {
  CLOUDFLARE_ANYPODCAST_ACCOUNT_ID?: string
  CLOUDFLARE_ANYPODCAST_API_TOKEN?: string
}

/** Both podcasts bind to this single account-wide rendering queue. */
export class CloudflareRenderGate extends DurableObject<RenderEnv> {
  private queue!: RenderRequestQueue

  constructor(ctx: DurableObjectState, env: RenderEnv) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.queue = new RenderRequestQueue(undefined, {
        lastStartedAt: await ctx.storage.get<number>('lastStartedAt'),
        onStart: time => ctx.storage.put('lastStartedAt', time),
      })
    })
  }

  async fetch(request: Request): Promise<Response> {
    const { url } = await request.json() as { url?: string }
    if (!url || !['http:', 'https:'].includes(new URL(url).protocol)) {
      return new Response('Invalid article URL', { status: 400 })
    }
    const account = this.env.CLOUDFLARE_ANYPODCAST_ACCOUNT_ID?.trim()
    const token = this.env.CLOUDFLARE_ANYPODCAST_API_TOKEN?.trim()
    if (!account || !token)
      return new Response('Cloudflare extraction credentials missing', { status: 503 })
    return this.queue.run(async () => {
      const startedAt = Date.now()
      const upstream = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/browser-rendering/markdown`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(30000),
      })
      const body = await upstream.text()
      console.info('Cloudflare render completed', { url, status: upstream.status, startedAt, elapsedMs: Date.now() - startedAt })
      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json',
          ...(upstream.headers.get('retry-after') ? { 'Retry-After': upstream.headers.get('retry-after')! } : {}),
        },
      })
    })
  }
}
