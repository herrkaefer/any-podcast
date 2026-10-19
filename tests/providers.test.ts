/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDefaultRuntimeConfig, mergeRuntimeConfig } from '../lib/runtime-config'
import { edgeRate, edgeTtsPatch, isCompatibleEdgeVoice } from '../lib/tts-config'
import { createResponseText, defaultOpenCodeBaseUrl, getAiProvider, getPrimaryModel } from '../workflow/ai'
import { buildRuntimeTtsSettings, getSpeakerMarkers, parseConversationLines } from '../workflow/dialogue'
import synthesize, { validateTtsConfig } from '../workflow/tts'

const hosts = [{ id: 'host1', gender: 'male' }, { id: 'host2', gender: 'female' }]

test('native voices and percentage speeds for both podcast languages', () => {
  for (const language of ['en-US', 'zh-CN']) {
    const patch = edgeTtsPatch(language, hosts)
    assert.notEqual(patch.voices.host1, patch.voices.host2)
    assert.ok(Object.values(patch.voices).every(voice => isCompatibleEdgeVoice(voice, language)))
    assert.equal(patch.speed, '+0%')
  }
  assert.equal(edgeRate(0), '+0%')
  assert.equal(edgeRate('-5%'), '-5%')
  assert.throws(() => edgeRate('fast'))
  assert.throws(() => edgeRate(101))
  assert.equal(isCompatibleEdgeVoice('en-US-EmmaMultilingualNeural', 'en-US'), false)
})

test('production allows Edge without paid TTS credentials and rejects mismatched voices', async () => {
  assert.equal(validateTtsConfig({ NODE_ENV: 'production' } as unknown as CloudflareEnv, 'edge'), 'edge')
  assert.throws(() => getAiProvider({}, { provider: 'opencode', model: 'deepseek-v4.1-flash' }), /OPENCODE_API_KEY/)
  await assert.rejects(synthesize('Hello', 'Aaron', {} as CloudflareEnv, {
    provider: 'edge',
    language: 'en-US',
    voicesBySpeaker: { Aaron: 'zh-CN-YunxiNeural' },
  }), /does not match/)
})

test('provider migration clears old speed, model and API URL, preserves music and editorial settings', async () => {
  const base = await buildDefaultRuntimeConfig('spectrum-podcast-en')
  const previous = structuredClone(base)
  previous.tts.provider = 'minimax'
  previous.tts.model = 'speech-2.6-hd'
  previous.tts.apiUrl = 'https://api.minimaxi.com/v1/t2a_v2'
  previous.tts.speed = '1.0'
  previous.tts.voices = { host1: 'English_Trustworth_Man', host2: 'English_ConfidentWoman' }
  const next = mergeRuntimeConfig(previous, { tts: { provider: 'edge' } })
  assert.equal(next.tts.speed, '+0%')
  assert.equal(next.tts.apiUrl, '')
  assert.equal(next.tts.model, '')
  assert.equal(next.tts.voices.host1, 'en-US-GuyNeural')
  assert.deepEqual(next.tts.introMusic, previous.tts.introMusic)
  assert.deepEqual(next.prompts, previous.prompts)
  assert.deepEqual(next.sources, previous.sources)
  assert.deepEqual(next.hosts, previous.hosts)
  const settings = buildRuntimeTtsSettings(next)
  assert.equal(settings.voicesBySpeaker[next.hosts[0].speakerMarker], 'en-US-GuyNeural')
  const markers = getSpeakerMarkers(next)
  assert.equal(parseConversationLines([`${markers[0]}: Hello`, `${markers[1]}：Hi`], markers).length, 2)
})

test('openCode uses Chat Completions, its own key and session, preserves JSON instructions and strips thinking', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    assert.equal(url, `${defaultOpenCodeBaseUrl}/chat/completions`)
    const headers = init?.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer test-opencode')
    assert.equal(headers['x-opencode-session'], 'episode-123')
    assert.equal(headers['User-Agent'], 'any-podcast/1.0')
    const body = JSON.parse(init?.body as string)
    assert.equal(body.model, 'deepseek-v4.1-flash')
    assert.equal(body.max_tokens, 1234)
    assert.deepEqual(body.thinking, { type: 'enabled' })
    assert.equal(body.reasoning_effort, 'high')
    assert.deepEqual(body.response_format, { type: 'json_object' })
    assert.match(body.messages[0].content, /JSON Schema/)
    return Response.json({ choices: [{ message: { content: '<think>internal</think>{"relevant":true}' }, finish_reason: 'stop' }] })
  }
  try {
    const result = await createResponseText({
      env: { OPENCODE_API_KEY: 'test-opencode', OPENAI_API_KEY: 'do-not-use' },
      runtimeAi: { provider: 'opencode', model: 'deepseek-v4.1-flash', sessionId: 'episode-123' },
      model: 'deepseek-v4.1-flash',
      instructions: 'Summarize',
      input: 'Article',
      maxOutputTokens: 1234,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { relevant: { type: 'BOOLEAN' } } },
    })
    assert.equal(result.text, '{"relevant":true}')
  }
  finally { globalThis.fetch = originalFetch }
})

test('truncated and empty model output fail rather than create incomplete episodes', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const [content, finishReason, expected] of [['partial', 'length', /truncated/], ['', 'stop', /empty output/]] as const) {
      globalThis.fetch = async () => Response.json({ choices: [{ message: { content }, finish_reason: finishReason }] })
      await assert.rejects(createResponseText({
        env: { OPENCODE_API_KEY: 'test' },
        runtimeAi: { provider: 'opencode', model: 'test' },
        model: 'test',
        instructions: 'test',
        input: 'test',
      }), expected)
    }
  }
  finally { globalThis.fetch = originalFetch }
})

test('OpenCode model environment variable overrides the Admin model for all requests', async () => {
  const env = { OPENCODE_API_KEY: 'test', OPENCODE_MODEL: ' another-chat-model ' }
  const runtimeAi = { provider: 'opencode' as const, model: 'admin-model' }
  assert.equal(getPrimaryModel(env, 'opencode', runtimeAi), 'another-chat-model')
  assert.equal(getPrimaryModel({ ...env, OPENCODE_MODEL: '' }, 'opencode', runtimeAi), 'admin-model')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(init?.body as string).model, 'another-chat-model')
    return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
  }
  try {
    await createResponseText({ env, runtimeAi, model: 'admin-model', instructions: 'test', input: 'test' })
  }
  finally { globalThis.fetch = originalFetch }
})

test('failed article extraction never reaches summarization as a title-only input', async () => {
  const { getStoryContent } = await import('../workflow/utils')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('', { status: 403 })
  try {
    const content = await getStoryContent({ id: 'article', title: 'ADHD and conversations', url: 'https://example.com/article' }, 8192, {})
    assert.equal(content, '')
  }
  finally { globalThis.fetch = originalFetch }
})

test('static article extraction keeps source links, removes boilerplate and rejects challenge/empty pages', async () => {
  const { extractStaticHtmlContent } = await import('../workflow/html-content')
  const body = 'This is a substantive paragraph from a public article. '.repeat(12)
  const html = `<html><head><title>Source article</title></head><body><nav>Navigation</nav><article><p>${body}</p><a href="/study">Original study</a></article><footer>Unsubscribe</footer></body></html>`
  const text = extractStaticHtmlContent(html, 'https://example.com/news')
  assert.match(text, /substantive paragraph/)
  assert.match(text, /\[Original study\]\(https:\/\/example.com\/study\)/)
  assert.doesNotMatch(text, /Navigation|Unsubscribe/)
  assert.equal(extractStaticHtmlContent(`<title>Just a moment...</title><body>${body}</body>`, 'https://example.com'), '')
  assert.equal(extractStaticHtmlContent('<title>Article title only</title>', 'https://example.com'), '')
})

test('render queue serializes concurrent callers and spaces starts after a failed request', async () => {
  const { RenderRequestQueue } = await import('../workflow/render-rate-limit')
  let now = 100000
  let active = 0
  let maxActive = 0
  const starts: number[] = []
  const queue = new RenderRequestQueue(11000, {
    now: () => now,
    sleep: async (ms) => { now += ms },
  })
  const job = (fail: boolean) => queue.run(async () => {
    starts.push(now)
    active++
    maxActive = Math.max(maxActive, active)
    await Promise.resolve()
    now += 2000
    active--
    if (fail)
      throw new Error('failed render')
    return 'body'
  })
  const results = await Promise.allSettled([job(false), job(true), job(false)])
  assert.equal(maxActive, 1)
  assert.deepEqual(starts, [100000, 111000, 122000])
  assert.deepEqual(results.map(item => item.status), ['fulfilled', 'rejected', 'fulfilled'])
})

test('rendered Cloudflare content is preferred and direct HTML is only a fallback', async () => {
  const { getContentFromCloudflareWithJinaFallback } = await import('../workflow/utils')
  const originalFetch = globalThis.fetch
  let directCalls = 0
  let gateStatus = 200
  const rendered = 'Rendered article including dynamic content. '.repeat(15)
  const html = `<html><head><title>Fallback article</title></head><body><article><p>${'Static article body. '.repeat(30)}</p></article></body></html>`
  globalThis.fetch = async (_url, init) => {
    if (new Headers(init?.headers).get('accept') === 'text/html')
      directCalls++
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  }
  const gate = {
    idFromName: () => 'account',
    get: () => ({ fetch: async () => Response.json({ success: gateStatus === 200, result: rendered }, { status: gateStatus }) }),
  } as unknown as DurableObjectNamespace
  const env = { CLOUDFLARE_ANYPODCAST_ACCOUNT_ID: 'account', CLOUDFLARE_ANYPODCAST_API_TOKEN: 'test', CLOUDFLARE_RENDER_GATE: gate }
  try {
    const first = await getContentFromCloudflareWithJinaFallback('https://example.com/article', 'markdown', {}, env, { cloudflare: { retryLimit: 0 } })
    assert.equal(first, rendered)
    assert.equal(directCalls, 0)
    gateStatus = 503
    const second = await getContentFromCloudflareWithJinaFallback('https://example.com/article', 'markdown', {}, env, { cloudflare: { retryLimit: 0 } })
    assert.match(second, /Static article body/)
    assert.equal(directCalls, 1)
  }
  finally { globalThis.fetch = originalFetch }
})

test('Edge v2 signature matches reference vectors and rolls over every five minutes', async () => {
  const { edgeTokenV2 } = await import('../workflow/edge-drm')
  const token = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
  for (const [seconds, expected] of [
    [0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
    [1700000000, '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2'],
    [1760600000.5, '382DA39AE9C7234A-D592F521358E457AC9556722046D878B004105AEE12B81167D37FD4778D35E78'],
    [2000000000, '2D62557F1142BC5D-FD9C30C68FF194A5EE6B45FEFC5E2BA1D1239F88A90569AB55CFFFAA7799F40E'],
  ] as const) assert.equal(edgeTokenV2(token, seconds), expected)
  assert.equal(edgeTokenV2(token, 1792134000), edgeTokenV2(token, 1792134299.9))
  assert.notEqual(edgeTokenV2(token, 1792134000), edgeTokenV2(token, 1792134300))
})

test('preview hold overrides trigger and checkpoint defaults, and never writes the public episode KV', async () => {
  const { resolvePublicationMode, saveEpisodeOutput, episodeAudioKey } = await import('../workflow/publication')
  assert.equal(resolvePublicationMode('preview', true, 'publish'), 'preview')
  assert.equal(resolvePublicationMode('publish', false), 'preview')
  assert.equal(resolvePublicationMode('publish', true, 'preview'), 'preview')
  assert.equal(resolvePublicationMode(undefined), 'publish')
  assert.throws(() => resolvePublicationMode('typo'), /must be/)
  const puts: { key: string, body: string }[] = []
  const env = {
    PODCAST_KV: { put() { throw new Error('Public KV must not be touched') } },
    PODCAST_R2: { async put(key: string, body: string) { puts.push({ key, body }) } },
  } as unknown as { PODCAST_KV: KVNamespace, PODCAST_R2: R2Bucket }
  const audio = episodeAudioKey('preview', 'job-123', '2026/10/19/episode.mp3')
  assert.equal(audio, 'previews/job-123/podcast.mp3')
  await saveEpisodeOutput(env, 'preview', 'job-123', 'content:production:show:date', { audio })
  assert.deepEqual(puts, [{ key: 'previews/job-123/episode.json', body: JSON.stringify({ audio }) }])
})

test('editorial materials retain full bodies and only expose source, title and content', async () => {
  const { buildPodcastStoryInput, createEditorialArticle } = await import('../workflow/editorial-input')
  const content = `${'Long article with definitions and research limits. '.repeat(1200).trim()}\n\nFinal qualifying detail.`
  const story = { title: 'Research', sourceName: 'Publisher', url: 'https://example.com/article', sourceUrl: 'https://private.example/secret' }
  const article = createEditorialArticle(story, content)
  const input = buildPodcastStoryInput([{ ...article, ...story }])
  assert.deepEqual(JSON.parse(input).articles[0], { source: 'Publisher', title: 'Research', content })
  assert.ok(input.includes('Final qualifying detail.'))
  assert.ok(!input.includes('https://'))
  assert.ok(!input.includes('secret'))
  assert.throws(() => buildPodcastStoryInput([]), /No article bodies/)
  assert.throws(() => createEditorialArticle(story, '<script>only boilerplate</script>'), /empty/)
})

test('body cleanup removes URLs while retaining link text, tables, facts and page text', async () => {
  const { cleanArticleText } = await import('../workflow/html-content')
  const cleaned = cleanArticleText('<nav>Subscribe</nav>\n\n# Research\n\n[Study details](https://example.com/a_(b)) report 450 million dollars.\n\n| Age | Count |\n| --- | --- |\n| 18–25 | 72 |\n\nSee https://example.com/more for details.\n\n<footer>Unsubscribe</footer>')
  assert.match(cleaned, /Study details report 450 million dollars/)
  assert.match(cleaned, /18–25.*72/)
  assert.doesNotMatch(cleaned, /https?:/)
  assert.match(cleaned, /Subscribe/)
  assert.match(cleaned, /Unsubscribe/)
})

test('duplicate feed articles are fetched once and citations are attached after generation', async () => {
  const { uniqueArticleStories, linkArticleHeadings } = await import('../workflow/editorial-input')
  const stories = [{ title: 'Original title', url: 'https://example.com/a?id=1&utm_source=a' }, { title: 'Same story', url: 'https://example.com/a?utm_source=b&id=1#section' }, { title: 'Different page', url: 'https://example.com/a?id=2' }]
  assert.equal(uniqueArticleStories(stories).length, 2)
  const notes = linkArticleHeadings('## Original title\n\nNotes.\n\n## Unrelated', stories)
  assert.match(notes, /## \[Original title\]\(https:\/\/example.com/)
  assert.match(notes, /## Unrelated$/)
})

test('both editorial prompts render the real show name without legacy placeholders or fixed exchange counts', async () => {
  const { podcastEditorialPrompt } = await import('../workflow/editorial-prompts')
  const { renderTemplate, findUnknownTemplateVariables } = await import('../lib/template')
  for (const language of ['zh', 'en'] as const) {
    const config = await buildDefaultRuntimeConfig(language === 'en' ? 'spectrum-podcast-en' : 'spectrum-podcast')
    const { getTemplateVariables } = await import('../lib/template')
    const variables = getTemplateVariables(config)
    assert.deepEqual(findUnknownTemplateVariables(podcastEditorialPrompt(language), variables), [])
    const rendered = renderTemplate(podcastEditorialPrompt(language), variables)
    assert.ok(rendered.includes(config.site.title))
    assert.ok(!rendered.includes('${'))
    assert.ok(!/3[–-]5/.test(rendered))
  }
})
