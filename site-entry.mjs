import { cachedPublicResponse } from './site/public-cache.mjs'

export { BucketCachePurge } from './.open-next/.build/durable-objects/bucket-cache-purge.js'
export { DOQueueHandler } from './.open-next/.build/durable-objects/queue.js'
export { DOShardedTagCache } from './.open-next/.build/durable-objects/sharded-tag-cache.js'
export { PublicPageRenderer } from './site/renderer.mjs'
export default {
  async fetch(request, env) {
    const cached = await cachedPublicResponse(request, env)
    if (cached)
      return cached
    const renderer = env.PUBLIC_PAGE_RENDERER.get(env.PUBLIC_PAGE_RENDERER.idFromName(new URL(request.url).hostname))
    return renderer.fetch(request)
  },
}
