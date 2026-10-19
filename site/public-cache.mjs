// Public documents only: never cache Admin/API responses or router payloads.
export function publicDocumentKey(request) {
  const url = new URL(request.url)
  if (!['GET', 'HEAD'].includes(request.method) || request.headers.has('rsc') || request.headers.has('next-router-state-tree'))
    return null
  if (url.pathname !== '/' && !/^\/episode\/\d{4}-\d{2}-\d{2}$/.test(url.pathname))
    return null
  const page = url.searchParams.get('page') || '1'
  if (!/^\d+$/.test(page))
    return null
  return `public-pages/${url.hostname}${url.pathname === '/' ? '/index' : url.pathname}/page-${page}.html`
}
export async function cachedPublicResponse(request, env) {
  const url = new URL(request.url)
  const key = url.pathname === '/rss.xml' && ['GET', 'HEAD'].includes(request.method)
    ? `feeds/${env.NODE_ENV || 'production'}/${url.hostname}/rss.xml`
    : publicDocumentKey(request)
  if (!key)
    return null
  const object = await env.PODCAST_R2.get(key)
  if (!object)
    return null
  return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
    'Content-Type': key.startsWith('feeds/') ? 'application/xml; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'X-Podcast-Cache': 'hit',
    'ETag': object.httpEtag,
  } })
}
