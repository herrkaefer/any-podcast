import { DurableObject } from 'cloudflare:workers'
import { publicDocumentKey } from './public-cache.mjs'

// Rendering runs with the Durable Object CPU budget, including a cold cache.
export class PublicPageRenderer extends DurableObject {
  async fetch(request) {
    const { default: next } = await import('../.open-next/worker.js')
    const response = await next.fetch(request, this.env, {
      waitUntil: promise => this.ctx.waitUntil(promise),
      passThroughOnException() {},
    })
    const key = publicDocumentKey(request)
    if (key && request.method === 'GET' && response.ok && response.headers.get('content-type')?.includes('text/html') && !response.headers.has('set-cookie')) {
      // Finish writing before returning, so the very next visitor can use it.
      await this.env.PODCAST_R2.put(key, await response.clone().arrayBuffer(), {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
      })
    }
    if (request.method === 'GET' && new URL(request.url).pathname === '/rss.xml' && response.ok) {
      const host = new URL(request.url).hostname
      await this.env.PODCAST_R2.put(`feeds/${this.env.NODE_ENV || 'production'}/${host}/rss.xml`, await response.clone().arrayBuffer(), {
        httpMetadata: { contentType: 'application/xml; charset=utf-8' },
        customMetadata: { builtAt: String(Date.now()), etag: response.headers.get('etag') || '', lastModified: response.headers.get('last-modified') || new Date().toUTCString() },
      })
    }
    if (response.ok && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && /^\/api\/admin\/(?:config|episodes)/.test(new URL(request.url).pathname)) {
      let cursor
      do {
        const page = await this.env.PODCAST_R2.list({ prefix: 'public-pages/', cursor })
        if (page.objects.length)
          await this.env.PODCAST_R2.delete(page.objects.map(object => object.key))
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
    }
    const headers = new Headers(response.headers)
    headers.set('X-Podcast-Renderer', 'durable-object')
    if (new URL(request.url).pathname === '/rss.xml')
      headers.set('Cache-Control', 'private, no-store')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}
