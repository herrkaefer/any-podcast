import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers'
import type { AiEnv } from './ai'

import { WorkflowEntrypoint } from 'cloudflare:workers'

import { buildContentKey, buildPodcastKeyBase, podcastTitle } from '@/config'
import { createResponseText, getAiProvider, getMaxTokens, getPrimaryModel, getThinkingModel } from './ai'
import { introPrompt, summarizeBlogPrompt, summarizePodcastPrompt, summarizeStoryPrompt, titlePrompt } from './prompt'
import { getStoryCandidatesFromSources, processGmailMessage } from './sources'
import synthesize, { buildGeminiTtsPrompt, synthesizeGeminiTTS } from './tts'
import { addIntroMusic, concatAudioFiles, getStoryContent, isSubrequestLimitError } from './utils'

interface Params {
  today?: string
  nowIso?: string
  windowMode?: 'calendar' | 'rolling'
  windowHours?: number
}

interface Env extends CloudflareEnv, AiEnv {
  JINA_KEY?: string
  GMAIL_CLIENT_ID?: string
  GMAIL_CLIENT_SECRET?: string
  GMAIL_REFRESH_TOKEN?: string
  GMAIL_USER_EMAIL?: string
  NODE_ENV: string
  PODCAST_WORKER_URL: string
  PODCAST_R2_BUCKET_URL: string
  PODCAST_WORKFLOW: Workflow
  BROWSER: Fetcher
  SKIP_TTS?: string
  TTS_PROVIDER?: string
  TTS_API_ID?: string
  TTS_API_KEY?: string
  WORKFLOW_TEST_STEP?: string
  WORKFLOW_TEST_INPUT?: string
  WORKFLOW_TEST_INSTRUCTIONS?: string
  WORKFLOW_TTS_INPUT?: string
}

interface StorySummaryResult {
  relevant: boolean
  summary: string | null
  reason: string
}

const storySummarySchema = {
  type: 'OBJECT',
  properties: {
    relevant: { type: 'BOOLEAN' },
    summary: { type: 'STRING', nullable: true },
    reason: { type: 'STRING' },
  },
  required: ['relevant', 'summary', 'reason'],
} as const

function formatError(error: unknown) {
  const err = error as {
    name?: string
    message?: string
    stack?: string
    cause?: unknown
    status?: number
    statusText?: string
    response?: { status?: number, statusText?: string }
    data?: unknown
  }
  return {
    name: err?.name,
    message: err?.message,
    status: err?.status ?? err?.response?.status,
    statusText: err?.statusText ?? err?.response?.statusText,
    stack: err?.stack,
    cause: err?.cause,
    data: err?.data,
  }
}

function validateTtsConfig(env: Env) {
  const provider = (env.TTS_PROVIDER || '').trim().toLowerCase()
  if (!provider) {
    throw new Error('TTS_PROVIDER is required when SKIP_TTS is false (current: empty)')
  }

  const isProduction = (env.NODE_ENV || 'production') === 'production'
  const supported = isProduction ? ['gemini', 'minimax', 'murf'] : ['gemini', 'minimax', 'murf', 'edge']
  if (!supported.includes(provider)) {
    throw new Error(`Unsupported TTS_PROVIDER: ${provider} (supported: ${supported.join(', ')})`)
  }

  if (provider === 'gemini' && !env.GEMINI_API_KEY?.trim()) {
    throw new Error('GEMINI_API_KEY is required when TTS_PROVIDER=gemini')
  }

  if (provider === 'minimax') {
    if (!env.TTS_API_KEY?.trim()) {
      throw new Error('TTS_API_KEY is required when TTS_PROVIDER=minimax')
    }
    if (!env.TTS_API_ID?.trim()) {
      throw new Error('TTS_API_ID is required when TTS_PROVIDER=minimax')
    }
  }

  return provider
}

function stripCodeFences(text: string) {
  return text.replace(/```(?:json)?/gi, '').trim()
}

function extractJsonObject(text: string) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
  }
  const match = trimmed.match(/\{[\s\S]*\}/)
  return match ? match[0] : ''
}

function parseStorySummary(text: string): StorySummaryResult | null {
  const cleaned = stripCodeFences(text)
  const json = extractJsonObject(cleaned)
  if (!json) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  }
  catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.relevant !== 'boolean') {
    return null
  }
  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  if (!reason) {
    return null
  }
  if (record.relevant && !summary) {
    return null
  }
  return {
    relevant: record.relevant,
    summary: summary || null,
    reason,
  }
}

async function summarizeStoryWithRelevance(params: {
  env: AiEnv
  model: string
  instructions: string
  input: string
  maxOutputTokens: number
}) {
  const { env, model, instructions, input, maxOutputTokens } = params
  const maxAttempts = 2
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await createResponseText({
        env,
        model,
        instructions: attempt === 1
          ? instructions
          : `${instructions}\n\n【重要】上一次输出不是有效 JSON，请只输出一个完整 JSON 对象，不要代码块或多余文字。`,
        input,
        maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema: storySummarySchema,
      })
      const parsed = parseStorySummary(response.text)
      if (!parsed) {
        lastError = new Error('story summary output is not valid JSON')
        continue
      }
      return { result: parsed, usage: response.usage, finishReason: response.finishReason }
    }
    catch (error) {
      if (isSubrequestLimitError(error))
        throw error
      lastError = error
    }
  }

  if (lastError instanceof Error) {
    throw lastError
  }
  throw new Error('story summary failed after 2 attempts')
}

function buildTimeWindow(
  now: Date,
  mode: Params['windowMode'] | undefined,
  hours: number,
  timeZone: string,
) {
  if (mode === 'rolling') {
    const end = now
    const start = new Date(now.getTime() - hours * 60 * 60 * 1000)
    return {
      windowStart: start,
      windowEnd: end,
      windowDateKey: getDateKeyInTimeZone(end, timeZone),
    }
  }

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const dateKey = getDateKeyInTimeZone(yesterday, timeZone)
  return {
    windowStart: zonedTimeToUtc(dateKey, timeZone, 0, 0, 0),
    windowEnd: zonedTimeToUtc(dateKey, timeZone, 23, 59, 59),
    windowDateKey: dateKey,
  }
}

function getDateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find(part => part.type === 'year')?.value || '0000'
  const month = parts.find(part => part.type === 'month')?.value || '01'
  const day = parts.find(part => part.type === 'day')?.value || '01'

  return `${year}-${month}-${day}`
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)

  const get = (type: string) => parts.find(part => part.type === type)?.value || '00'
  const utcTime = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  )

  return utcTime - date.getTime()
}

function zonedTimeToUtc(dateKey: string, timeZone: string, hour: number, minute: number, second: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone)
  return new Date(utcGuess - offset)
}

const retryConfig: WorkflowStepConfig = {
  retries: {
    limit: 5,
    delay: '10 seconds',
    backoff: 'exponential',
  },
  timeout: '3 minutes',
}

export class HackerNewsWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    console.info('trigged event: PodcastWorkflow', event)

    const runEnv = this.env.NODE_ENV || 'production'
    const isDev = runEnv !== 'production'
    const breakTime = isDev ? '2 seconds' : '5 seconds'
    const payloadNow = event.payload?.nowIso ? new Date(event.payload.nowIso) : null
    const now = payloadNow && !Number.isNaN(payloadNow.getTime())
      ? payloadNow
      : new Date()
    const windowMode = event.payload?.windowMode
    const windowHours = event.payload?.windowHours ?? 24
    const timeZone = 'America/Chicago'
    const { windowStart, windowEnd, windowDateKey } = buildTimeWindow(now, windowMode, windowHours, timeZone)
    const today = event.payload?.today || windowDateKey
    const publishedAt = now.toISOString()
    const publishDateKey = getDateKeyInTimeZone(now, timeZone)
    const skipTTS = this.env.SKIP_TTS === 'true'
    const aiProvider = getAiProvider(this.env)
    const maxTokens = getMaxTokens(this.env, aiProvider)
    const primaryModel = getPrimaryModel(this.env, aiProvider)
    const thinkingModel = getThinkingModel(this.env, aiProvider)
    const testStep = (this.env.WORKFLOW_TEST_STEP || '').trim().toLowerCase()

    console.info('AI runtime config', {
      provider: aiProvider,
      primaryModel,
      thinkingModel,
      maxTokens,
    })

    if (testStep && testStep !== 'stories') {
      const fallbackInput = 'Summarize the following in one sentence: This is a short test input.'
      const fallbackInstructions = 'You are a concise assistant.'
      const testInput = this.env.WORKFLOW_TEST_INPUT || fallbackInput
      const testInstructions = this.env.WORKFLOW_TEST_INSTRUCTIONS || fallbackInstructions

      const text = await step.do(`workflow test step: ${testStep}`, retryConfig, async () => {
        if (testStep === 'openai' || testStep === 'responses') {
          return (await createResponseText({
            env: this.env,
            model: primaryModel,
            instructions: testInstructions,
            input: testInput,
            maxOutputTokens: maxTokens,
          })).text
        }

        if (testStep === 'tts') {
          const sampleInput = this.env.WORKFLOW_TTS_INPUT
            || this.env.WORKFLOW_TEST_INPUT
            || [
              '女：Hello 大家好，欢迎收听测试播客。',
              '男：大家好，我是老冯。今天我们用一小段对话来测试 TTS。',
              '女：如果你能听到自然的男女声切换，说明流程是通的。',
            ].join('\n')

          console.info('TTS test input', {
            chars: sampleInput.length,
            preview: sampleInput.slice(0, 200),
          })

          if (skipTTS) {
            return 'skip TTS enabled, skip audio generation'
          }

          const ttsProvider = validateTtsConfig(this.env)

          if (ttsProvider === 'gemini') {
            const lines = sampleInput
              .split('\n')
              .map(line => line.trim())
              .filter(Boolean)
            const prompt = buildGeminiTtsPrompt(lines)
            const { audio, extension } = await synthesizeGeminiTTS(prompt, this.env)
            if (!audio.size) {
              throw new Error('podcast audio size is 0')
            }
            const audioKey = `tmp:${event.instanceId}:tts-test.${extension}`
            await this.env.PODCAST_R2.put(audioKey, audio)
            const audioUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${audioKey}?t=${Date.now()}`
            console.info('tts test audio url', audioUrl)
            return audioUrl
          }

          const conversations = sampleInput
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
          const audioUrls: string[] = []
          for (const [index, conversation] of conversations.entries()) {
            if (
              !(conversation.startsWith('男') || conversation.startsWith('女'))
              || !conversation.substring(2).trim()
            ) {
              console.warn('conversation is not valid', conversation)
              continue
            }
            const audio = await synthesize(conversation.substring(2), conversation[0], this.env)
            if (!audio.size) {
              throw new Error('podcast audio size is 0')
            }
            const audioKey = `tmp:${event.instanceId}:tts-test-${index}.mp3`
            await this.env.PODCAST_R2.put(audioKey, audio)
            const audioUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${audioKey}?t=${Date.now()}`
            audioUrls.push(audioUrl)
          }
          return `Generated ${audioUrls.length} audio files`
        }

        if (testStep === 'tts-intro') {
          const sampleInput = this.env.WORKFLOW_TTS_INPUT
            || this.env.WORKFLOW_TEST_INPUT
            || [
              '女：Hello 大家好，欢迎收听测试播客。',
              '男：大家好，我是老冯。今天我们用一小段对话来测试 TTS 和片头音乐效果。',
              '女：如果你能听到片头音乐淡出后接上人声，说明流程是通的。',
            ].join('\n')

          if (skipTTS) {
            return 'skip TTS enabled, skip audio generation'
          }

          if (!this.env.BROWSER) {
            throw new Error('BROWSER binding is required for tts-intro test')
          }

          const ttsProvider = validateTtsConfig(this.env)
          const testPrefix = `tmp/${event.instanceId}/tts-intro`

          // Step 1: Generate TTS audio (no browser needed)
          const ttsResult = await step.do('tts-intro: generate tts', { ...retryConfig, timeout: '10 minutes' }, async () => {
            if (ttsProvider === 'gemini') {
              const lines = sampleInput.split('\n').map(line => line.trim()).filter(Boolean)
              const prompt = buildGeminiTtsPrompt(lines)
              const { audio } = await synthesizeGeminiTTS(prompt, this.env)
              if (!audio.size) {
                throw new Error('podcast audio size is 0')
              }
              const wavKey = `${testPrefix}.wav`
              await this.env.PODCAST_R2.put(wavKey, audio)
              const wavUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${wavKey}?t=${Date.now()}`
              console.info('tts-intro: gemini tts done', { wavKey, size: audio.size })
              return { type: 'gemini' as const, urls: [wavUrl] }
            }

            const conversations = sampleInput.split('\n').map(line => line.trim()).filter(Boolean)
            const audioUrls: string[] = []
            for (const [index, conversation] of conversations.entries()) {
              if (!(conversation.startsWith('男') || conversation.startsWith('女')) || !conversation.substring(2).trim()) {
                continue
              }
              const audio = await synthesize(conversation.substring(2), conversation[0], this.env)
              if (!audio.size) {
                throw new Error('podcast audio size is 0')
              }
              const audioKey = `${testPrefix}-${index}.mp3`
              await this.env.PODCAST_R2.put(audioKey, audio)
              audioUrls.push(`${this.env.PODCAST_R2_BUCKET_URL}/${audioKey}?t=${Date.now()}`)
            }
            console.info('tts-intro: non-gemini tts done', { count: audioUrls.length })
            return { type: 'other' as const, urls: audioUrls }
          })

          await step.sleep('reset quota before convert', breakTime)

          // Step 2: Convert/concat to MP3 (needs browser)
          const baseUrl = await step.do('tts-intro: convert to mp3', retryConfig, async () => {
            const mp3Blob = await concatAudioFiles(ttsResult.urls, this.env.BROWSER, { workerUrl: this.env.PODCAST_WORKER_URL })
            const baseKey = `${testPrefix}.base.mp3`
            await this.env.PODCAST_R2.put(baseKey, mp3Blob)
            const url = `${this.env.PODCAST_R2_BUCKET_URL}/${baseKey}?t=${Date.now()}`
            console.info('tts-intro: mp3 conversion done', { baseKey, size: mp3Blob.size })
            return url
          })

          await step.sleep('reset quota before intro music', '30 seconds')

          // Step 3: Add intro music (needs browser)
          const finalUrl = await step.do('tts-intro: add intro music', retryConfig, async () => {
            const finalBlob = await addIntroMusic(baseUrl, this.env.BROWSER, { workerUrl: this.env.PODCAST_WORKER_URL })
            const finalKey = `${testPrefix}.final.mp3`
            await this.env.PODCAST_R2.put(finalKey, finalBlob)
            const url = `${this.env.PODCAST_R2_BUCKET_URL}/${finalKey}?t=${Date.now()}`
            console.info('tts-intro: intro music added', { finalKey, size: finalBlob.size })
            return url
          })

          // Clean up temp files
          await step.do('tts-intro: clean up', retryConfig, async () => {
            await Promise.all([
              this.env.PODCAST_R2.delete(`${testPrefix}.base.mp3`).catch(() => {}),
              this.env.PODCAST_R2.delete(`${testPrefix}.wav`).catch(() => {}),
              ...ttsResult.urls.map((_, i) => this.env.PODCAST_R2.delete(`${testPrefix}-${i}.mp3`).catch(() => {})),
            ])
            return 'cleaned up'
          })

          console.info('tts-intro test done', { finalUrl })
          return
        }

        if (testStep === 'story') {
          const candidates = await getStoryCandidatesFromSources({ now, env: this.env, window: { start: windowStart, end: windowEnd, timeZone } })
          let story = candidates.stories[0]
          if (!story && candidates.gmailMessages.length > 0) {
            const messageRef = candidates.gmailMessages[0]
            const messageStories = await processGmailMessage({
              messageId: messageRef.id,
              source: messageRef.source,
              now,
              lookbackDays: messageRef.lookbackDays,
              env: this.env,
              window: { start: windowStart, end: windowEnd, timeZone },
            })
            story = messageStories[0]
          }
          if (!story) {
            throw new Error('workflow test step "story": no stories found')
          }
          const storyResponse = await getStoryContent(story, maxTokens, this.env)
          const { result } = await summarizeStoryWithRelevance({
            env: this.env,
            model: primaryModel,
            instructions: summarizeStoryPrompt,
            input: storyResponse,
            maxOutputTokens: maxTokens,
          })
          if (!result.relevant) {
            return `NOT_RELEVANT: ${result.reason}`
          }
          return result.summary || ''
        }

        if (testStep === 'podcast') {
          const sampleStories = [
            '<story>这是一条测试摘要，讨论了一个新工具如何提升开发效率。</story>',
            '<story>另一条摘要聚焦隐私与数据安全的最新争议与观点。</story>',
          ].join('\n\n---\n\n')
          return (await createResponseText({
            env: this.env,
            model: thinkingModel,
            instructions: summarizePodcastPrompt,
            input: this.env.WORKFLOW_TEST_INPUT || sampleStories,
            maxOutputTokens: maxTokens,
          })).text
        }

        if (testStep === 'blog') {
          const sampleStories = [
            '<story>这是一条测试摘要，讨论了一个新工具如何提升开发效率。</story>',
            '<story>另一条摘要聚焦隐私与数据安全的最新争议与观点。</story>',
          ].join('\n\n---\n\n')
          const sampleInput = `<stories>[]</stories>\n\n---\n\n${sampleStories}`
          return (await createResponseText({
            env: this.env,
            model: thinkingModel,
            instructions: summarizeBlogPrompt,
            input: this.env.WORKFLOW_TEST_INPUT || sampleInput,
            maxOutputTokens: maxTokens,
          })).text
        }

        if (testStep === 'intro') {
          const sampleInput = this.env.WORKFLOW_TEST_INPUT || '女：Hello 大家好，欢迎收听测试播客。\n男：大家好，我是老冯。'
          return (await createResponseText({
            env: this.env,
            model: primaryModel,
            instructions: introPrompt,
            input: sampleInput,
            maxOutputTokens: maxTokens,
          })).text
        }

        throw new Error(`workflow test step "${testStep}" is not supported`)
      })

      console.info(`workflow test step "${testStep}" result`, {
        text: isDev ? text : text.slice(0, 200),
      })
      return
    }

    const candidates = await step.do(`list story candidates ${today}`, retryConfig, async () => {
      const result = await getStoryCandidatesFromSources({
        now,
        env: this.env,
        window: {
          start: windowStart,
          end: windowEnd,
          timeZone,
        },
      })

      if (!result.stories.length && !result.gmailMessages.length) {
        console.warn('no story candidates found, skip workflow run')
        return { stories: [], gmailMessages: [] }
      }

      return result
    })

    await step.sleep('reset quota after candidates', breakTime)

    const stories: Story[] = [...candidates.stories]
    const gmailMessages = candidates.gmailMessages

    if (gmailMessages.length > 0) {
      for (const messageRef of gmailMessages) {
        await step.sleep('reset quota before gmail', breakTime)
        const gmailResult = await step.do(`process gmail ${messageRef.id}`, retryConfig, async () => {
          const result = await processGmailMessage({
            messageId: messageRef.id,
            source: messageRef.source,
            now,
            lookbackDays: messageRef.lookbackDays,
            env: this.env,
            window: {
              start: windowStart,
              end: windowEnd,
              timeZone,
            },
          })
          return {
            messageId: messageRef.id,
            subject: messageRef.subject,
            receivedAt: messageRef.receivedAt,
            count: result.length,
            stories: result.map(s => ({ title: s.title, url: s.url })),
            _raw: result,
          }
        })
        if (gmailResult._raw.length > 0) {
          stories.push(...gmailResult._raw)
        }
      }
    }

    if (!stories.length) {
      console.info('no stories found after filtering, exit workflow run')
      return
    }

    console.info('top stories', isDev ? stories : JSON.stringify(stories))
    console.info(`total stories: ${stories.length}`)

    if (testStep === 'stories') {
      console.info('workflow test step "stories" completed, stopping before summarization', {
        totalStories: stories.length,
        stories: stories.map(s => ({ id: s.id, title: s.title, url: s.url, sourceName: s.sourceName })),
      })
      return
    }

    const storyGroups = new Map<string, { count: number, label: string }>()
    for (const story of stories) {
      const sourceLabel = story.sourceItemTitle || story.sourceName || story.sourceUrl || 'unknown'
      const groupKey = story.sourceItemId || sourceLabel
      const existing = storyGroups.get(groupKey)
      if (existing) {
        existing.count += 1
      }
      else {
        storyGroups.set(groupKey, { count: 1, label: sourceLabel })
      }
    }

    for (const [groupKey, group] of storyGroups.entries()) {
      console.info(`newsletter: ${group.label} (${groupKey}) -> ${group.count} articles`)
    }

    const keptStories: Story[] = []
    const allStories: string[] = []
    for (const story of stories) {
      const storyResponse = await step.do(`get story ${story.id}: ${story.title}`, retryConfig, async () => {
        return await getStoryContent(story, maxTokens, this.env)
      })

      console.info(`get story ${story.id} content success`, {
        title: story.title,
        chars: storyResponse.length,
      })

      await step.sleep('reset quota before summarize', breakTime)

      let summaryResult: StorySummaryResult | null = null
      try {
        summaryResult = await step.do(`summarize story ${story.id}: ${story.title}`, { ...retryConfig, retries: { ...retryConfig.retries, limit: 2 } }, async () => {
          console.info(`summarize story ${story.id} start`, {
            title: story.title,
            inputChars: storyResponse.length,
          })
          const { result, usage, finishReason } = await summarizeStoryWithRelevance({
            env: this.env,
            model: primaryModel,
            instructions: summarizeStoryPrompt,
            input: storyResponse,
            maxOutputTokens: maxTokens,
          })

          console.info(`get story ${story.id} summary success`, {
            relevant: result.relevant,
            reason: result.reason,
            summaryLength: result.summary?.length || 0,
            usage,
            finishReason,
          })
          return result
        })
      }
      catch (error) {
        if (isSubrequestLimitError(error))
          throw error
        console.warn(`get story ${story.id} summary failed after retries`, {
          title: story.title,
          error: formatError(error),
        })
      }

      if (!summaryResult) {
        console.info(`story ${story.id} skipped due to summary error`, { title: story.title })
        await step.sleep('Give AI a break', breakTime)
        continue
      }

      if (!summaryResult.relevant) {
        console.info(`story ${story.id} filtered out`, {
          title: story.title,
          reason: summaryResult.reason,
        })
        await step.sleep('Give AI a break', breakTime)
        continue
      }

      const summaryText = summaryResult.summary?.trim()
      if (!summaryText) {
        console.warn(`story ${story.id} summary empty, skip`, { title: story.title })
        await step.sleep('Give AI a break', breakTime)
        continue
      }

      console.info(`story ${story.id} kept`, {
        title: story.title,
        reason: summaryResult.reason,
        summaryLength: summaryText.length,
      })

      allStories.push(`<story>${summaryText}</story>`)
      keptStories.push(story)

      await step.sleep('Give AI a break', breakTime)
    }

    if (!keptStories.length) {
      console.info('no relevant stories after summarization, exit workflow run')
      return
    }

    const blogStories = keptStories.map((story) => {
      const resolvedLink = story.url || ''
      return {
        title: story.title || '',
        link: resolvedLink,
        url: resolvedLink,
        publishedAt: story.publishedAt || '',
      }
    })

    await step.sleep('Give AI a break', breakTime)

    const podcastContent = await step.do('create podcast content', { ...retryConfig, retries: { ...retryConfig.retries, limit: 3 } }, async () => {
      const attemptInputs: { label: string, stories: string[] }[] = [
        { label: 'all', stories: allStories },
      ]
      if (allStories.length > 6) {
        attemptInputs.push({ label: 'first-6', stories: allStories.slice(0, 6) })
      }

      for (const attempt of attemptInputs) {
        const input = attempt.stories.join('\n\n---\n\n')
        console.info('create podcast content attempt', {
          attempt: attempt.label,
          stories: attempt.stories.length,
          inputChars: input.length,
        })
        try {
          const { text, usage, finishReason } = await createResponseText({
            env: this.env,
            model: thinkingModel,
            instructions: summarizePodcastPrompt,
            input,
            maxOutputTokens: maxTokens,
          })

          console.info(`create podcast content success`, {
            attempt: attempt.label,
            stories: attempt.stories.length,
            inputChars: input.length,
            usage,
            finishReason,
          })

          return text
        }
        catch (error) {
          if (isSubrequestLimitError(error))
            throw error
          console.warn('create podcast content failed', {
            attempt: attempt.label,
            stories: attempt.stories.length,
            inputChars: input.length,
            error: formatError(error),
          })
        }
      }

      console.warn('create podcast content failed after retries, skip workflow')
      return ''
    })

    if (!podcastContent) {
      console.warn('podcast content is empty, exit workflow run')
      return
    }

    console.info('podcast content:\n', isDev ? podcastContent : podcastContent.slice(0, 100))

    await step.sleep('Give AI a break', breakTime)

    const blogContent = await step.do('create blog content', { ...retryConfig, retries: { ...retryConfig.retries, limit: 3 } }, async () => {
      const attemptInputs: { label: string, storyMeta: typeof blogStories, stories: string[] }[] = [
        { label: 'all', storyMeta: blogStories, stories: allStories },
      ]
      if (allStories.length > 6) {
        attemptInputs.push({
          label: 'first-6',
          storyMeta: blogStories.slice(0, 6),
          stories: allStories.slice(0, 6),
        })
      }

      for (const attempt of attemptInputs) {
        const input = `<stories>${JSON.stringify(attempt.storyMeta)}</stories>\n\n---\n\n${attempt.stories.join('\n\n---\n\n')}`
        console.info('create blog content attempt', {
          attempt: attempt.label,
          stories: attempt.stories.length,
          metaStories: attempt.storyMeta.length,
          inputChars: input.length,
        })
        try {
          const { text, usage, finishReason } = await createResponseText({
            env: this.env,
            model: thinkingModel,
            instructions: summarizeBlogPrompt,
            input,
            maxOutputTokens: maxTokens,
          })

          console.info('create blog content success', {
            attempt: attempt.label,
            stories: attempt.stories.length,
            metaStories: attempt.storyMeta.length,
            inputChars: input.length,
            usage,
            finishReason,
          })

          return text
        }
        catch (error) {
          if (isSubrequestLimitError(error))
            throw error
          console.warn('create blog content failed', {
            attempt: attempt.label,
            stories: attempt.stories.length,
            metaStories: attempt.storyMeta.length,
            inputChars: input.length,
            error: formatError(error),
          })
        }
      }

      console.warn('create blog content failed after retries, skip workflow')
      return ''
    })

    if (!blogContent) {
      console.warn('blog content is empty, exit workflow run')
      return
    }

    console.info('blog content:\n', isDev ? blogContent : blogContent.slice(0, 100))

    await step.sleep('Give AI a break', breakTime)

    const introContent = await step.do('create intro content', retryConfig, async () => {
      const { text, usage, finishReason } = await createResponseText({
        env: this.env,
        model: primaryModel,
        instructions: introPrompt,
        input: podcastContent,
      })

      console.info(`create intro content success`, { text, usage, finishReason })

      return text
    })

    const episodeTitle = await step.do('generate episode title', retryConfig, async () => {
      const { text } = await createResponseText({
        env: this.env,
        model: primaryModel,
        instructions: titlePrompt,
        input: podcastContent,
      })

      console.info('title generation output:\n', text)

      const match = text.match(/推荐标题[：:]\s*(.+)/)
      return match?.[1]?.trim() || `${podcastTitle} ${publishDateKey}`
    })

    console.info('episode title:', episodeTitle)

    await step.sleep('reset quota before TTS', breakTime)

    const contentKey = buildContentKey(runEnv, publishDateKey)
    const podcastKeyBase = buildPodcastKeyBase(runEnv, publishDateKey)
    const podcastKey = `${podcastKeyBase}.mp3`

    const ttsInputOverride = this.env.WORKFLOW_TTS_INPUT?.trim()
    if (ttsInputOverride) {
      console.info('TTS input overridden by WORKFLOW_TTS_INPUT')
    }
    const ttsSourceText = ttsInputOverride || podcastContent

    const conversations = ttsSourceText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    const dialogLines = conversations.filter(line => line.startsWith('男') || line.startsWith('女'))
    const ttsProvider = skipTTS
      ? ''
      : await step.do('validate tts config', { ...retryConfig, retries: { ...retryConfig.retries, limit: 0 } }, async () => {
          const provider = validateTtsConfig(this.env)
          console.info('TTS config validated', {
            provider,
            hasGeminiApiKey: Boolean(this.env.GEMINI_API_KEY?.trim()),
            hasTtsApiKey: Boolean(this.env.TTS_API_KEY?.trim()),
            hasTtsApiId: Boolean(this.env.TTS_API_ID?.trim()),
          })
          return provider
        })
    const useGeminiTTS = ttsProvider === 'gemini'

    console.info('TTS input stats', {
      hasOverride: Boolean(ttsInputOverride),
      chars: ttsSourceText.length,
      lines: conversations.length,
      dialogLines: dialogLines.length,
      preview: ttsSourceText.slice(0, 200),
    })

    if (skipTTS) {
      console.info('skip TTS enabled, skip audio generation')
    }
    else if (useGeminiTTS) {
      const geminiPrompt = buildGeminiTtsPrompt(dialogLines)

      console.info('Gemini TTS input', {
        totalLines: dialogLines.length,
        promptChars: geminiPrompt.length,
      })

      await step.do('create gemini podcast audio', { ...retryConfig, retries: { ...retryConfig.retries, limit: 2 }, timeout: '10 minutes' }, async () => {
        const startedAt = Date.now()
        const retryLimit = 2
        for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
          try {
            console.info('Gemini TTS attempt', {
              attempt: attempt + 1,
              promptChars: geminiPrompt.length,
              lines: dialogLines.length,
            })
            const result = await synthesizeGeminiTTS(geminiPrompt, this.env)
            if (!result.audio.size) {
              throw new Error('podcast audio size is 0')
            }

            const audioKey = `tmp/${podcastKey}.wav`
            const audioUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${audioKey}?t=${Date.now()}`
            await this.env.PODCAST_R2.put(audioKey, result.audio)
            await this.env.PODCAST_KV.put(`tmp:${event.instanceId}:audio:gemini`, audioUrl, { expirationTtl: 3600 })

            console.info('Gemini TTS done', {
              key: audioKey,
              size: result.audio.size,
              ms: Date.now() - startedAt,
            })
            return audioUrl
          }
          catch (error) {
            console.error('Gemini TTS attempt failed', {
              attempt: attempt + 1,
              error: formatError(error),
            })
            if (attempt >= retryLimit) {
              throw error
            }
          }
        }
        throw new Error('Gemini TTS failed after retries')
      })

      await step.sleep('reset quota before convert', breakTime)

      await step.do('convert gemini audio to mp3', { ...retryConfig, retries: { ...retryConfig.retries, limit: 3 } }, async () => {
        if (!this.env.BROWSER) {
          console.warn('browser is not configured, skip audio convert')
          return
        }
        const audioUrl = await this.env.PODCAST_KV.get(`tmp:${event.instanceId}:audio:gemini`)
        if (!audioUrl) {
          throw new Error('Gemini audio URL not found in KV')
        }
        const blob = await concatAudioFiles([audioUrl], this.env.BROWSER, { workerUrl: this.env.PODCAST_WORKER_URL })
        const basePodcastKey = `tmp/${podcastKey}.base.mp3`
        await this.env.PODCAST_R2.put(basePodcastKey, blob)
        await this.env.PODCAST_KV.put(`tmp:${event.instanceId}:audio:base`, `${this.env.PODCAST_R2_BUCKET_URL}/${basePodcastKey}?t=${Date.now()}`, { expirationTtl: 3600 })
        console.info('Gemini audio converted to MP3', {
          key: basePodcastKey,
          size: blob.size,
        })
      })

      await step.sleep('reset quota before intro music', '30 seconds')

      try {
        await step.do('add intro music (gemini)', retryConfig, async () => {
          if (!this.env.BROWSER) {
            throw new Error('browser is not configured')
          }
          const basePodcastUrl = await this.env.PODCAST_KV.get(`tmp:${event.instanceId}:audio:base`)
          if (!basePodcastUrl) {
            throw new Error('Base podcast URL not found in KV')
          }
          const blob = await addIntroMusic(basePodcastUrl, this.env.BROWSER, { workerUrl: this.env.PODCAST_WORKER_URL })
          await this.env.PODCAST_R2.put(podcastKey, blob)
          console.info('intro music added (gemini)', {
            key: podcastKey,
            size: blob.size,
          })
        })
      }
      catch (error) {
        console.warn('add intro music failed after retries, falling back to base podcast', {
          error: formatError(error),
        })
        await step.do('fallback: copy base podcast (gemini)', retryConfig, async () => {
          const baseKey = `tmp/${podcastKey}.base.mp3`
          const baseObj = await this.env.PODCAST_R2.get(baseKey)
          if (baseObj) {
            await this.env.PODCAST_R2.put(podcastKey, baseObj.body)
            console.info('fallback: base podcast copied', { key: podcastKey })
          }
        })
      }

      console.info('podcast audio url', `${this.env.PODCAST_R2_BUCKET_URL}/${podcastKey}`)
    }
    else {
      for (const [index, conversation] of conversations.entries()) {
        try {
          await step.do(`create audio ${index}: ${conversation.substring(0, 20)}...`, { ...retryConfig, retries: { ...retryConfig.retries, limit: 0 }, timeout: '30 minutes' }, async () => {
            if (
              !(conversation.startsWith('男') || conversation.startsWith('女'))
              || !conversation.substring(2).trim()
            ) {
              console.warn('conversation is not valid', conversation)
              return conversation
            }

            const retryLimit = 1
            const startedAt = Date.now()
            for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
              try {
                console.info('create conversation audio', conversation)
                const audio = await synthesize(conversation.substring(2), conversation[0], this.env)

                if (!audio.size) {
                  throw new Error('podcast audio size is 0')
                }

                const audioKey = `tmp/${podcastKey}-${index}.mp3`
                const audioUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${audioKey}?t=${Date.now()}`

                try {
                  await this.env.PODCAST_R2.put(audioKey, audio)
                }
                catch (error) {
                  console.error('TTS upload to R2 failed', {
                    index,
                    key: audioKey,
                    error: formatError(error),
                  })
                  throw error
                }

                try {
                  await this.env.PODCAST_KV.put(`tmp:${event.instanceId}:audio:${index}`, audioUrl, { expirationTtl: 3600 })
                }
                catch (error) {
                  console.error('TTS write to KV failed', {
                    index,
                    key: `tmp:${event.instanceId}:audio:${index}`,
                    error: formatError(error),
                  })
                  throw error
                }
                if (isDev) {
                  console.info('TTS line duration', { index, ms: Date.now() - startedAt })
                }
                return audioUrl
              }
              catch (error) {
                console.warn('TTS attempt failed', {
                  index,
                  attempt: attempt + 1,
                  error: formatError(error),
                })
                if (attempt >= retryLimit) {
                  throw error
                }
              }
            }

            throw new Error('TTS failed after retries')
          })
        }
        catch (error) {
          console.error('TTS line failed', {
            index,
            conversation,
            error: formatError(error),
          })
          throw error
        }
      }
    }

    const audioFiles = skipTTS || useGeminiTTS
      ? []
      : await step.do('collect all audio files', retryConfig, async () => {
          const audioUrls: string[] = []
          for (const [index] of conversations.entries()) {
            try {
              const audioUrl = await this.env.PODCAST_KV.get(`tmp:${event.instanceId}:audio:${index}`)
              if (audioUrl) {
                audioUrls.push(audioUrl)
              }
            }
            catch (error) {
              console.error('collect TTS audio url failed', {
                index,
                key: `tmp:${event.instanceId}:audio:${index}`,
                error: formatError(error),
              })
              throw error
            }
          }
          return audioUrls
        })

    if (!skipTTS && !useGeminiTTS) {
      await step.do('concat audio files', retryConfig, async () => {
        if (!this.env.BROWSER) {
          console.warn('browser is not configured, skip concat audio files')
          return
        }

        const blob = await concatAudioFiles(audioFiles, this.env.BROWSER, { workerUrl: this.env.PODCAST_WORKER_URL })
        const basePodcastKey = `tmp/${podcastKey}.base.mp3`
        try {
          await this.env.PODCAST_R2.put(basePodcastKey, blob)
          await this.env.PODCAST_KV.put(`tmp:${event.instanceId}:audio:base`, `${this.env.PODCAST_R2_BUCKET_URL}/${basePodcastKey}?t=${Date.now()}`, { expirationTtl: 3600 })
        }
        catch (error) {
          console.error('concat audio upload to R2 failed', {
            key: basePodcastKey,
            error: formatError(error),
          })
          throw error
        }

        console.info('concat audio files done', { key: basePodcastKey, size: blob.size })
        return `${this.env.PODCAST_R2_BUCKET_URL}/${basePodcastKey}?t=${Date.now()}`
      })

      await step.sleep('reset quota before intro music', '30 seconds')

      try {
        await step.do('add intro music', retryConfig, async () => {
          if (!this.env.BROWSER) {
            throw new Error('browser is not configured')
          }
          const basePodcastUrl = await this.env.PODCAST_KV.get(`tmp:${event.instanceId}:audio:base`)
          if (!basePodcastUrl) {
            throw new Error('Base podcast URL not found in KV')
          }
          const blob = await addIntroMusic(basePodcastUrl, this.env.BROWSER, { workerUrl: this.env.PODCAST_WORKER_URL })
          await this.env.PODCAST_R2.put(podcastKey, blob)
          console.info('intro music added', {
            key: podcastKey,
            size: blob.size,
          })
        })
      }
      catch (error) {
        console.warn('add intro music failed after retries, falling back to base podcast', {
          error: formatError(error),
        })
        await step.do('fallback: copy base podcast', retryConfig, async () => {
          const baseKey = `tmp/${podcastKey}.base.mp3`
          const baseObj = await this.env.PODCAST_R2.get(baseKey)
          if (baseObj) {
            await this.env.PODCAST_R2.put(podcastKey, baseObj.body)
            console.info('fallback: base podcast copied', { key: podcastKey })
          }
        })
      }
    }

    console.info('save podcast to r2 success')

    await step.do('save content to kv', retryConfig, async () => {
      try {
        const updatedAt = Date.now()
        await this.env.PODCAST_KV.put(contentKey, JSON.stringify({
          date: publishDateKey,
          publishedAt,
          title: episodeTitle,
          stories: keptStories,
          podcastContent,
          blogContent,
          introContent,
          audio: skipTTS ? '' : podcastKey,
          updatedAt,
        }))
      }
      catch (error) {
        console.error('save content to KV failed', {
          key: contentKey,
          error: formatError(error),
        })
        throw error
      }

      return introContent
    })

    console.info('save content to kv success')

    await step.do('clean up temporary data', retryConfig, async () => {
      const deletePromises = []

      // Clean up base podcast with intro music (both paths)
      if (!skipTTS) {
        deletePromises.push(this.env.PODCAST_KV.delete(`tmp:${event.instanceId}:audio:base`))
        deletePromises.push(
          this.env.PODCAST_R2.delete(`tmp/${podcastKey}.base.mp3`).catch((error) => {
            console.error('delete base podcast temp failed', {
              key: `tmp/${podcastKey}.base.mp3`,
              error: formatError(error),
            })
          }),
        )
      }

      if (!skipTTS && useGeminiTTS) {
        // Clean up Gemini TTS temporary data
        deletePromises.push(this.env.PODCAST_KV.delete(`tmp:${event.instanceId}:audio:gemini`))
        deletePromises.push(
          this.env.PODCAST_R2.delete(`tmp/${podcastKey}.wav`).catch((error) => {
            console.error('delete gemini temp wav failed', {
              key: `tmp/${podcastKey}.wav`,
              error: formatError(error),
            })
          }),
        )
      }
      else if (!skipTTS && !useGeminiTTS) {
        // Clean up non-Gemini audio temporary data
        for (const [index] of conversations.entries()) {
          const audioKey = `tmp:${event.instanceId}:audio:${index}`
          deletePromises.push(this.env.PODCAST_KV.delete(audioKey))
        }
        for (const index of audioFiles.keys()) {
          deletePromises.push(
            this.env.PODCAST_R2.delete(`tmp/${podcastKey}-${index}.mp3`).catch((error) => {
              console.error('delete temp files failed', {
                key: `tmp/${podcastKey}-${index}.mp3`,
                error: formatError(error),
              })
            }),
          )
        }
      }

      await Promise.all(deletePromises).catch((error) => {
        console.error('cleanup failed', {
          error: formatError(error),
        })
      })

      return 'temporary data cleaned up'
    })
  }
}
