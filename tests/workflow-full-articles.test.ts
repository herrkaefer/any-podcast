/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDefaultRuntimeConfig, getRuntimeConfigKeys } from '../lib/runtime-config'
import { PodcastWorkflow } from '../workflow'
import { defaultOpenCodeBaseUrl } from '../workflow/ai'

// Run the actual stage loop, stopping at the first audio step. No network or public writes.
test('episode workflow uses all complete articles in one composition, retries without dropping articles, and replays stored bodies', async () => {
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  console.info = () => {}
  const config = await buildDefaultRuntimeConfig('full-article-test')
  config.tts.introMusic.url = ''
  config.sources.items = Array.from({ length: 8 }, (_, i) => ({ id: `article-${i}`, name: `Article ${i}`, type: 'url' as const, url: `https://example.com/article/${i}`, enabled: true }))
  const kv = new Map([[getRuntimeConfigKeys('full-article-test').draft, JSON.stringify(config)]])
  const objects = new Map<string, string>()
  const requests: Record<string, unknown>[] = []
  let articleFetches = 0
  let compositionAttempts = 0
  const continuations: Record<string, unknown>[] = []
  const env = {
    PODCAST_ID: 'full-article-test',
    NODE_ENV: 'production',
    PODCAST_PUBLISH_MODE: 'preview',
    PODCAST_WORKER_URL: 'https://worker.example',
    PODCAST_R2_BUCKET_URL: 'https://audio.example',
    OPENCODE_API_KEY: 'test-key',
    PODCAST_WORKFLOW: { async create({ params }: { params: Record<string, unknown> }) {
      continuations.push(params)
      return { id: `continuation-${continuations.length}` }
    } },
    PODCAST_KV: {
      async get(key: string, format: string) {
        const value = kv.get(key)
        return value ? format === 'json' ? JSON.parse(value) : value : null
      },
      async put(key: string, value: string) {
        assert.match(key, /^(?:cfg:|workflow:)/)
        kv.set(key, value)
      },
    },
    PODCAST_R2: {
      async get(key: string) {
        const value = objects.get(key)
        return value ? { text: async () => value } : null
      },
      async put(key: string, value: string) { objects.set(key, value) },
    },
  }
  const firstMarker = config.hosts[0].speakerMarker
  const secondMarker = config.hosts[1].speakerMarker
  const script = `${firstMarker}: Here is what the research found.\n${secondMarker}: The final qualifying detail matters.`
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://example.com/article/')) {
      articleFetches++
      return new Response(`<article><p>${'Complete article background. '.repeat(1600)}</p><p>Final qualifying detail for ${url}.</p><p><a href="https://private.example/secret">Study details</a></p></article>`, { headers: { 'Content-Type': 'text/html' } })
    }
    assert.equal(url, `${defaultOpenCodeBaseUrl}/chat/completions`)
    const request = JSON.parse(init?.body as string)
    const input = request.messages[1].content
    requests.push(JSON.parse(input.startsWith('{') ? input : '{}'))
    assert.doesNotMatch(input, /https?:\/\//)
    let content: string
    if (requests.at(-1)?.articles && !requests.at(-1)?.conversation) {
      compositionAttempts++
      const articles = requests.at(-1)!.articles as Array<Record<string, string>>
      assert.equal(articles.length, 8)
      for (const article of articles) {
        assert.deepEqual(Object.keys(article), ['source', 'title', 'content'])
        assert.ok(article.content.length > 40960)
        assert.match(article.content, /Final qualifying detail/)
        assert.match(article.content, /Study details/)
      }
      if (compositionAttempts === 1)
        return new Response('Temporary model failure', { status: 503 })
      content = script
    }
    else if (requests.at(-1)?.conversation) {
      content = '## Article 0\n\nThe study has an important qualifying detail.'
    }
    else if (request.messages[0].content.includes('recommendedIndex')) {
      content = JSON.stringify({ coreAngle: 'Evidence', candidates: ['Research and its limits', 'What the evidence shows', 'Understanding the research'].map(title => ({ title, scores: { relevance: 9, search: 8, appeal: 8 }, reason: 'Specific' })), recommendedIndex: 0, recommendedTitle: 'Research and its limits' })
    }
    else { content = 'Research and its limits.' }
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
  }
  const step = {
    async do(name: string, optionsOrCallback: unknown, callback?: () => Promise<unknown>) {
      if (name === 'load compose snapshot')
        throw new Error('Reached audio stage')
      const run = (callback || optionsOrCallback) as () => Promise<unknown>
      try {
        return await run()
      }
      catch (error) {
        if (name !== 'create podcast content')
          throw error
        return run()
      }
    },
    async sleep() {},
  }
  try {
    const Workflow = PodcastWorkflow as unknown as new (ctx: unknown, env: unknown) => { run: (event: unknown, step: unknown) => Promise<unknown> }
    const workflow = new Workflow({}, env)
    const runToAudio = async (payload: Record<string, unknown>) => {
      continuations.push(payload)
      let instance = 0
      while (continuations.length && instance < 10) {
        const next = continuations.shift()!
        try {
          await workflow.run({ instanceId: `${next.jobId}-${instance++}`, payload: next }, step)
        }
        catch (error) {
          if (error instanceof Error && error.message === 'Reached audio stage')
            return
          throw error
        }
      }
      throw new Error('Workflow failed to reach audio stage')
    }
    await runToAudio({ jobId: 'full-body-original', publish: false, nowIso: '2026-10-19T12:00:00Z' })
    assert.equal(articleFetches, 8)
    assert.equal(compositionAttempts, 2)
    assert.equal(requests.length, 5, `Unexpected requests: ${requests.map(item => Object.keys(item).join(',')).join(';')}`) // composition retry + notes + description + title; no per-article summaries
    const materials = JSON.parse(objects.get('workflow/jobs/full-body-original/articles.json')!)
    assert.equal(materials.articles.length, 8)
    const preview = JSON.parse(objects.get('previews/full-body-original/episode.json')!)
    assert.equal(preview.podcastContent, script)
    assert.match(preview.blogContent, /\[Article 0\]\(https:\/\/example.com\/article\/0\)/)

    const beforeReplay = articleFetches
    await runToAudio({ jobId: 'full-body-replay', publish: false, replayMaterialJobId: 'full-body-original', nowIso: '2026-10-19T12:00:00Z' })
    assert.equal(articleFetches, beforeReplay)
    assert.deepEqual(JSON.parse(objects.get('workflow/jobs/full-body-replay/articles.json')!), materials)
    assert.ok(objects.has('previews/full-body-replay/episode.json'))
    assert.ok(!Array.from(kv.keys()).some(key => key.startsWith('content:')))
  }
  finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
  }
})
