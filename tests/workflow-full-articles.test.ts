/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDefaultRuntimeConfig, getRuntimeConfigKeys } from '../lib/runtime-config'
import { PodcastWorkflow } from '../workflow'
import { defaultOpenCodeBaseUrl } from '../workflow/ai'

// Run the actual stage loop to the first audio step using isolated in-memory storage.
test('episode workflow summarizes all complete articles, reviews against originals, and replays stored bodies', async () => {
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
  let summaryCalls = 0
  let reviewCalls = 0
  let rejectReview = false
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
        assert.match(key, /^(?:cfg:|workflow:|content:)/)
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
    assert.deepEqual(request.thinking, { type: 'enabled' })
    assert.equal(request.reasoning_effort, 'high')
    const input = request.messages[1].content
    requests.push(JSON.parse(input.startsWith('{') ? input : '{}'))
    assert.doesNotMatch(input, /https?:\/\//)
    let content: string
    if (requests.at(-1)?.speakerMarkers) {
      assert.deepEqual(request.thinking, { type: 'enabled' })
      assert.equal(request.reasoning_effort, 'high')
      reviewCalls++
      const packet = requests.at(-1) as { articles: { content: { text: string }[] }[], script: { line: number, text: string }[] }
      assert.equal(packet.articles.length, 8)
      assert.ok(packet.articles.every(article => article.content.map(p => p.text).join('\n').length > 40960))
      const checks = packet.script.map(turn => ({ line: turn.line, assessment: 'Verified against the complete original.', evidence: [{ articleIndex: 0, paragraphs: [1] }] }))
      content = rejectReview
        ? JSON.stringify({ checks, approved: false, issues: [{ line: 1, original: packet.script[0].text, replacement: `${firstMarker}: Still unresolved ${reviewCalls}.`, category: 'fact', explanation: 'Unresolved test error', evidence: [{ articleIndex: 0, paragraphs: [0] }] }], warnings: [] })
        : JSON.stringify({ checks, approved: true, issues: [], warnings: [] })
    }
    else if ((requests.at(-1)?.articles as unknown[])?.length === 1) {
      assert.deepEqual(request.thinking, { type: 'enabled' })
      assert.equal(request.reasoning_effort, 'high')
      summaryCalls++
      const article = (requests.at(-1)!.articles as { title: string, content: { text: string }[] }[])[0]
      assert.ok(article.content.map(p => p.text).join('\n').length > 40960)
      content = JSON.stringify({ relevant: true, reason: 'Research', overview: `Summary of ${article.title}.`, people: [], findings: [{ text: 'The final qualifying detail matters.', evidence: [1] }], context: [], examples: [], limitations: [] })
    }
    else if (requests.at(-1)?.articles && !requests.at(-1)?.conversation) {
      assert.deepEqual(request.thinking, { type: 'enabled' })
      assert.equal(request.reasoning_effort, 'high')
      compositionAttempts++
      const articles = requests.at(-1)!.articles as Array<Record<string, string>>
      assert.equal(articles.length, 8)
      for (const article of articles) {
        assert.deepEqual(Object.keys(article), ['source', 'title', 'content'])
        assert.ok(article.content.length < 40960)
        assert.match(article.content, /final qualifying detail/)
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
  let stepCache = new Map<string, unknown>()
  const step = {
    async do(name: string, optionsOrCallback: unknown, callback?: () => Promise<unknown>) {
      if (name === 'load compose snapshot')
        throw new Error('Reached audio stage')
      if (stepCache.has(name))
        return structuredClone(stepCache.get(name))
      const run = (callback || optionsOrCallback) as () => Promise<unknown>
      try {
        const result = await run()
        stepCache.set(name, structuredClone(result))
        return result
      }
      catch (error) {
        if (name !== 'draft podcast from detailed summaries')
          throw error
        const result = await run()
        stepCache.set(name, structuredClone(result))
        return result
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
        stepCache = new Map()
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
    assert.equal(summaryCalls, 8)
    assert.equal(reviewCalls, 1)
    assert.equal(requests.length, 14, `Unexpected requests: ${requests.map(item => Object.keys(item).join(',')).join(';')}`) // eight rich summaries, draft retry, full-article review, notes, description and title
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
    rejectReview = true
    env.PODCAST_PUBLISH_MODE = 'publish'
    await assert.rejects(runToAudio({ jobId: 'rejected-script', publish: true, replayMaterialJobId: 'full-body-original', nowIso: '2026-10-19T12:00:00Z' }), /requires preview mode/)
    await runToAudio({ jobId: 'review-notes-continue', publish: true, nowIso: '2026-10-19T12:00:00Z' })
    assert.ok(objects.has('workflow/jobs/review-notes-continue/compose.json'))
    const fallback = JSON.parse(objects.get('workflow/jobs/review-notes-continue/editorial-2-fallback.json')!)
    assert.equal(fallback.status, 'fallback')
    assert.match(fallback.script, /Still unresolved/)
    assert.ok(Array.from(kv.keys()).some(key => key.startsWith('content:')))
  }
  finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
  }
})
