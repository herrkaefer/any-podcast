/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { test as it } from 'node:test'
import { cachedPublicResponse, publicDocumentKey } from '../site/public-cache.mjs'

it('only public HTML documents can enter the document cache', () => {
  for (const path of ['/admin', '/api/admin/config/draft', '/static/x.mp3'])assert.equal(publicDocumentKey(new Request(`https://example.com${path}`)), null)
  assert.equal(publicDocumentKey(new Request('https://example.com/episode/2026-10-19', { headers: { rsc: '1' } })), null)
  assert.equal(publicDocumentKey(new Request('https://example.com/episode/2026-10-19', { method: 'POST' })), null)
  assert.notEqual(publicDocumentKey(new Request('https://a.com/episode/2026-10-19')), publicDocumentKey(new Request('https://b.com/episode/2026-10-19')))
})
it('cached document streams without invoking the application and HEAD has no body', async () => {
  const env = { PODCAST_R2: { get: async () => ({ uploaded: new Date(), body: '<html>Published</html>', httpEtag: '"1"' }) } }
  const response = await cachedPublicResponse(new Request('https://example.com/episode/2026-10-19'), env)
  assert.equal(await response.text(), '<html>Published</html>')
  assert.equal(response.headers.get('x-podcast-cache'), 'hit')
  assert.equal(await (await cachedPublicResponse(new Request('https://example.com/episode/2026-10-19', { method: 'HEAD' }), env)).text(), '')
})
