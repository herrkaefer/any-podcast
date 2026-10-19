/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { invalidatePublishedWebsite, warmPublishedWebsite } from '../workflow/website-publication'

test('publication clears page and feed caches for every host, keeping audio and previews', async () => {
  const keys = new Set(['feeds/production/a/rss.xml', 'feeds/production/b/rss.xml', 'public-pages/a/index/page-1.html', 'public-pages/b/episode/next/page-1.html', 'previews/accepted/podcast.mp3', '2026/10/19/audio.mp3'])
  await invalidatePublishedWebsite({
    async list({ prefix }) { return { objects: [...keys].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false } },
    async delete(removed) { for (const key of removed) keys.delete(key) },
  }, 'production')
  assert.deepEqual([...keys], ['previews/accepted/podcast.mp3', '2026/10/19/audio.mp3'])
})

test('HTTP success alone does not count as a warmed cache', async () => {
  await assert.rejects(warmPublishedWebsite('https://example.com', '2026-10-20', async () => new Response('Rendered but not cached')), /cache is not ready/)
  const visited = new Set<string>()
  await warmPublishedWebsite('https://example.com', '2026-10-20', async (url) => {
    visited.add(new URL(String(url)).pathname)
    return new Response('Published', { headers: { 'x-podcast-cache': 'hit' } })
  })
  assert.deepEqual([...visited], ['/episode/2026-10-20', '/', '/rss.xml'])
})
