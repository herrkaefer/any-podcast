interface WebsiteBucket {
  list: (options: { prefix: string, cursor?: string }) => Promise<{ objects: { key: string }[], truncated: boolean, cursor?: string }>
  delete: (keys: string[]) => Promise<void>
}
export async function invalidatePublishedWebsite(bucket: WebsiteBucket, runEnv: string) {
  for (const prefix of [`feeds/${runEnv}/`, 'public-pages/']) {
    let cursor: string | undefined
    do {
      const page = await bucket.list({ prefix, cursor })
      if (page.objects.length)
        await bucket.delete(page.objects.map(object => object.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
}
export async function warmPublishedWebsite(siteUrl: string, date: string, fetcher: typeof fetch = fetch) {
  for (const path of [`/episode/${date}`, '/', '/rss.xml']) {
    const response = await fetcher(new URL(path, siteUrl))
    await response.arrayBuffer()
    if (!response.ok)
      throw new Error(`Published website warmup failed: ${path} HTTP ${response.status}`)
    const verification = await fetcher(new URL(path, siteUrl))
    await verification.arrayBuffer()
    if (!verification.ok || verification.headers.get('x-podcast-cache') !== 'hit')
      throw new Error(`Published website cache is not ready: ${path}`)
  }
}
