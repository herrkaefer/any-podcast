import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers'
import type { AiEnv } from './ai'
import type { SourceConfig } from './sources/types'

import type { RuntimeConfigBundle, RuntimeTtsIntroMusicConfig } from '@/types/runtime-config'

import { WorkflowEntrypoint } from 'cloudflare:workers'
import { buildContentKey, buildPodcastKeyBase } from '@/config'
import { getActiveRuntimeConfig } from '@/lib/runtime-config'
import { getTemplateVariables, renderPromptTemplates } from '@/lib/template'
import { createResponseText, getAiProvider, getMaxTokens, getPrimaryModel, getThinkingModel } from './ai'
import { getStoryCandidatesFromSources, processGmailMessage } from './sources'
import { listGmailMessageRefs } from './sources/gmail'
import { fetchRssItems } from './sources/rss'
import { getDateKeyInTimeZone, zonedTimeToUtc } from './timezone'
import synthesize, { buildGeminiTtsPrompt, synthesizeGeminiTTS } from './tts'
import { addIntroMusic, concatAudioFiles, getStoryContent, isSubrequestLimitError } from './utils'

interface Params {
  today?: string
  nowIso?: string
  windowMode?: 'calendar' | 'rolling'
  windowHours?: number
  jobId?: string
  continuationSeq?: number
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
  TTS_WORKFLOW: Workflow<TtsWorkflowParams>
  BROWSER: Fetcher
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

interface RuntimePromptSet {
  summarizeStory: string
  summarizePodcast: string
  summarizeBlog: string
  intro: string
  title: string
  extractNewsletterLinks: string
}

interface ParsedConversationLine {
  speaker: string
  text: string
  raw: string
}

interface RuntimeTtsSettings {
  provider: 'edge' | 'minimax' | 'murf' | 'gemini'
  language: string
  languageBoost?: 'auto' | 'Chinese' | 'English'
  model?: string
  speed?: string | number
  apiUrl?: string
  geminiPrompt?: string
  voicesBySpeaker: Record<string, string>
  geminiSpeakers: { speaker: string, voice?: string }[]
}

interface TtsWorkflowParams {
  parsedConversations: ParsedConversationLine[]
  podcastKey: string
  contentKey: string
  ttsSettings: RuntimeTtsSettings
  ffmpegAudioQuality: number
  introThemeUrl?: string
  introMusicConfig: RuntimeTtsIntroMusicConfig
  isDev: boolean
}

type WorkflowStage
  = | 'collect_candidates'
    | 'expand_gmail'
    | 'summarize_stories'
    | 'compose_text'
    | 'tts_render'
    | 'done'

interface WorkflowCursorState {
  sourceIndex: number
  gmailIndex: number
  storyIndex: number
  ttsLineIndex: number
}

interface WorkflowProgressState {
  sourcesTotal: number
  sourcesProcessed: number
  gmailTotal: number
  gmailProcessed: number
  storiesTotal: number
  storiesProcessed: number
  storiesRelevant: number
  ttsTotal: number
  ttsProcessed: number
}

interface WorkflowJobState {
  jobId: string
  stage: WorkflowStage
  continuationSeq: number
  nowIso: string
  today: string
  windowMode: 'calendar' | 'rolling'
  windowHours: number
  publishDateKey: string
  publishedAt: string
  cursor: WorkflowCursorState
  progress: WorkflowProgressState
  candidatesKey?: string
  summaryKey?: string
  composeKey?: string
  contentKey?: string
  podcastKey?: string
  provider?: RuntimeTtsSettings['provider']
  updatedAt: number
  status: 'running' | 'done'
}

interface BudgetTracker {
  used: number
  limit: number
  reserve: number
}

interface CandidateSnapshot {
  stories: Story[]
  gmailMessages: Array<{
    id: string
    source: SourceConfig
    lookbackDays: number
    subject?: string
    receivedAt?: string
  }>
}

interface SummarySnapshot {
  keptStories: Story[]
  allStories: string[]
}

interface ComposeSnapshot {
  stories: Story[]
  podcastContent: string
  blogContent: string
  introContent: string
  episodeTitle: string
  parsedConversations: ParsedConversationLine[]
  contentKey: string
  podcastKey: string
  ttsSettings: RuntimeTtsSettings
  ffmpegAudioQuality: number
  introThemeUrl?: string
  introMusicConfig: RuntimeTtsIntroMusicConfig
  isDev: boolean
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

function validateTtsConfig(env: Env, providerInput?: string): RuntimeTtsSettings['provider'] {
  const provider = (providerInput || '').trim().toLowerCase()
  if (!provider) {
    throw new Error('runtime config tts.provider is required when skipTts is false')
  }

  const isProduction = (env.NODE_ENV || 'production') === 'production'
  const supported = isProduction ? ['gemini', 'minimax', 'murf'] : ['gemini', 'minimax', 'murf', 'edge']
  if (!supported.includes(provider)) {
    throw new Error(`Unsupported runtime tts.provider: ${provider} (supported: ${supported.join(', ')})`)
  }

  if (provider === 'gemini' && !env.GEMINI_API_KEY?.trim()) {
    throw new Error('GEMINI_API_KEY is required when tts.provider=gemini')
  }

  if (provider === 'minimax') {
    if (!env.TTS_API_KEY?.trim()) {
      throw new Error('TTS_API_KEY is required when tts.provider=minimax')
    }
    if (!env.TTS_API_ID?.trim()) {
      throw new Error('TTS_API_ID is required when tts.provider=minimax')
    }
  }

  return provider as RuntimeTtsSettings['provider']
}

function getSpeakerMarkers(config: RuntimeConfigBundle) {
  const markers = config.hosts
    .map(host => host.speakerMarker.trim())
    .filter(Boolean)
  if (markers.length === 0) {
    throw new Error('No speaker markers configured in hosts. Please configure hosts with speakerMarker in admin.')
  }
  return markers
}

function normalizeDialogText(value: string) {
  return value.replace(/^[:：]\s*/, '').trim()
}

function parseConversationLines(lines: string[], markers: string[]): ParsedConversationLine[] {
  const normalizedMarkers = markers
    .map(marker => marker.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  return lines
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return null
      }

      const matched = normalizedMarkers.find(marker => trimmed.startsWith(marker))
      if (!matched) {
        return null
      }

      const content = normalizeDialogText(trimmed.slice(matched.length))
      if (!content) {
        return null
      }

      return {
        speaker: matched,
        text: content,
        raw: trimmed,
      } satisfies ParsedConversationLine
    })
    .filter((item): item is ParsedConversationLine => Boolean(item))
}

function buildRuntimeTtsSettings(config: RuntimeConfigBundle): RuntimeTtsSettings {
  const provider = config.tts.provider || 'edge'
  const voicesBySpeaker: Record<string, string> = {}

  for (const host of config.hosts) {
    const voice = config.tts.voices[host.id]
    if (voice) {
      voicesBySpeaker[host.speakerMarker] = voice
    }
  }

  const geminiSpeakers = config.hosts
    .map(host => ({
      speaker: host.speakerMarker,
      voice: config.tts.voices[host.id],
    }))
    .filter(item => item.speaker)

  return {
    provider,
    language: config.tts.language || 'zh-CN',
    languageBoost: config.tts.languageBoost,
    model: config.tts.model || undefined,
    speed: config.tts.speed,
    apiUrl: config.tts.apiUrl,
    geminiPrompt: config.tts.geminiPrompt || undefined,
    voicesBySpeaker,
    geminiSpeakers,
  }
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

function trimWrappingQuotes(value: string) {
  return value.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
}

function extractEpisodeTitle(text: string): string | null {
  const markers = new Set([
    '推荐标题',
    '推荐题目',
    '最终标题',
    'recommended title',
    'final title',
  ])

  for (const rawLine of text.split('\n')) {
    const line = rawLine
      .trim()
      .replace(/^[-*]\s*/, '')
      .replace(/\*\*/g, '')
    const separatorIndex = line.search(/[：:]/)
    if (separatorIndex < 0) {
      continue
    }
    const label = line.slice(0, separatorIndex).trim().toLowerCase()
    if (!markers.has(label)) {
      continue
    }
    const title = trimWrappingQuotes(line.slice(separatorIndex + 1))
    if (title) {
      return title
    }
  }

  return null
}

async function summarizeStoryWithRelevance(params: {
  env: AiEnv
  runtimeAi: RuntimeConfigBundle['ai']
  model: string
  instructions: string
  input: string
  maxOutputTokens: number
}) {
  const { env, runtimeAi, model, instructions, input, maxOutputTokens } = params
  const maxAttempts = 2
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await createResponseText({
        env,
        runtimeAi,
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
  frequencyDays: number,
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

  const normalizedFrequencyDays = Math.max(1, Math.floor(frequencyDays))
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const endDateKey = getDateKeyInTimeZone(yesterday, timeZone)
  const endDateUtc = new Date(`${endDateKey}T00:00:00.000Z`)
  const startDateUtc = new Date(endDateUtc.getTime() - (normalizedFrequencyDays - 1) * 24 * 60 * 60 * 1000)
  const startDateKey = `${startDateUtc.getUTCFullYear()}-${String(startDateUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(startDateUtc.getUTCDate()).padStart(2, '0')}`
  return {
    windowStart: zonedTimeToUtc(startDateKey, timeZone, 0, 0, 0),
    windowEnd: zonedTimeToUtc(endDateKey, timeZone, 23, 59, 59),
    windowDateKey: endDateKey,
  }
}

const retryConfig: WorkflowStepConfig = {
  retries: {
    limit: 5,
    delay: '10 seconds',
    backoff: 'exponential',
  },
  timeout: '3 minutes',
}

const DEFAULT_FFMPEG_AUDIO_QUALITY = 5
const BLOCKED_STORY_HOSTNAMES = new Set(['doi.org', 'dx.doi.org'])
const NON_GEMINI_TTS_LINE_SLEEP = '12 seconds'
const NON_GEMINI_TTS_SUBREQUEST_BACKOFF_SLEEP = '20 seconds'
const NON_GEMINI_TTS_RETRY_SLEEP = '5 seconds'
const NON_GEMINI_TTS_MAX_ATTEMPTS = 2
const SUBREQUEST_SOFT_LIMIT = 35
const SUBREQUEST_SOFT_RESERVE = 6

const BUDGET_COST = {
  kvRead: 1,
  kvWrite: 1,
  r2Read: 1,
  r2Write: 1,
  sourceFetchRssBase: 1,
  sourceFetchRssNewsletterItem: 2,
  sourceFetchGmailBase: 2,
  sourceFetchGmailPerRef: 1,
  gmailExpand: 3,
  storyContent: 2,
  storySummary: 2,
  llmCompose: 2,
  ttsLine: 3,
  audioMerge: 3,
  introMusic: 3,
  workflowCreate: 1,
} as const

function withRetryLimit(limit: number) {
  const delay = retryConfig.retries?.delay || '10 seconds'
  const backoff = retryConfig.retries?.backoff || 'exponential'
  return {
    limit,
    delay,
    backoff,
  }
}

function isBlockedStoryUrl(url: string | undefined) {
  if (!url) {
    return false
  }
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return BLOCKED_STORY_HOSTNAMES.has(hostname)
  }
  catch {
    return false
  }
}

function buildJobStateKey(jobId: string) {
  return `workflow:job:${jobId}:state`
}

function buildJobDataKey(jobId: string, name: string) {
  return `workflow/jobs/${jobId}/${name}.json`
}

function createBudgetTracker(): BudgetTracker {
  return {
    used: 0,
    limit: SUBREQUEST_SOFT_LIMIT,
    reserve: SUBREQUEST_SOFT_RESERVE,
  }
}

function consumeBudget(
  budget: BudgetTracker,
  cost: number,
  label: string,
  jobId: string,
  extra?: Record<string, unknown>,
) {
  budget.used += Math.max(0, Math.floor(cost))
  console.info('subrequest budget consumed', {
    jobId,
    label,
    cost,
    used: budget.used,
    limit: budget.limit,
    reserve: budget.reserve,
    ...(extra || {}),
  })
}

function shouldHandoff(budget: BudgetTracker, nextCost: number) {
  return budget.used + Math.max(0, Math.floor(nextCost)) + budget.reserve > budget.limit
}

function estimateRssSourceFetchCost(stories: Story[]) {
  const newsletterItemIds = new Set(
    stories
      .map(story => (story.sourceItemId || '').trim())
      .filter(Boolean),
  )
  return BUDGET_COST.sourceFetchRssBase
    + newsletterItemIds.size * BUDGET_COST.sourceFetchRssNewsletterItem
}

function estimateGmailSourceFetchCost(refCount: number) {
  return BUDGET_COST.sourceFetchGmailBase
    + Math.max(0, Math.floor(refCount)) * BUDGET_COST.sourceFetchGmailPerRef
}

function normalizeNonNegativeInt(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

function createInitialProgress(sourceTotal: number): WorkflowProgressState {
  return {
    sourcesTotal: Math.max(0, Math.floor(sourceTotal)),
    sourcesProcessed: 0,
    gmailTotal: 0,
    gmailProcessed: 0,
    storiesTotal: 0,
    storiesProcessed: 0,
    storiesRelevant: 0,
    ttsTotal: 0,
    ttsProcessed: 0,
  }
}

function normalizeProgress(
  progress: WorkflowProgressState,
  cursor: WorkflowCursorState,
): WorkflowProgressState {
  const normalized = {
    ...progress,
  }
  normalized.sourcesProcessed = Math.max(normalized.sourcesProcessed, cursor.sourceIndex)
  normalized.gmailProcessed = Math.max(normalized.gmailProcessed, cursor.gmailIndex)
  normalized.storiesProcessed = Math.max(normalized.storiesProcessed, cursor.storyIndex)
  normalized.ttsProcessed = Math.max(normalized.ttsProcessed, cursor.ttsLineIndex)

  normalized.sourcesTotal = Math.max(normalized.sourcesTotal, normalized.sourcesProcessed)
  normalized.gmailTotal = Math.max(normalized.gmailTotal, normalized.gmailProcessed)
  normalized.storiesTotal = Math.max(normalized.storiesTotal, normalized.storiesProcessed)
  normalized.ttsTotal = Math.max(normalized.ttsTotal, normalized.ttsProcessed)

  normalized.storiesRelevant = Math.min(
    Math.max(0, Math.floor(normalized.storiesRelevant)),
    normalized.storiesTotal,
  )

  return normalized
}

function parseWorkflowProgress(
  value: unknown,
  cursor: WorkflowCursorState,
): WorkflowProgressState {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  return normalizeProgress({
    sourcesTotal: normalizeNonNegativeInt(record.sourcesTotal),
    sourcesProcessed: normalizeNonNegativeInt(record.sourcesProcessed),
    gmailTotal: normalizeNonNegativeInt(record.gmailTotal),
    gmailProcessed: normalizeNonNegativeInt(record.gmailProcessed),
    storiesTotal: normalizeNonNegativeInt(record.storiesTotal),
    storiesProcessed: normalizeNonNegativeInt(record.storiesProcessed),
    storiesRelevant: normalizeNonNegativeInt(record.storiesRelevant),
    ttsTotal: normalizeNonNegativeInt(record.ttsTotal),
    ttsProcessed: normalizeNonNegativeInt(record.ttsProcessed),
  }, cursor)
}

const WORKFLOW_STAGE_FLOW: Array<{ stage: WorkflowStage, name: string }> = [
  { stage: 'collect_candidates', name: 'collect candidates' },
  { stage: 'expand_gmail', name: 'expand gmail links' },
  { stage: 'summarize_stories', name: 'summarize stories' },
  { stage: 'compose_text', name: 'compose podcast/blog text' },
  { stage: 'tts_render', name: 'render tts audio' },
  { stage: 'done', name: 'done' },
]

function logWorkflowObservation(params: {
  jobId: string
  stage: WorkflowStage
  continuationSeq: number
  status: WorkflowJobState['status']
  cursor: WorkflowCursorState
  progress: WorkflowProgressState
  budget: BudgetTracker
  label: string
  extra?: Record<string, unknown>
}) {
  const progress = normalizeProgress(params.progress, params.cursor)
  const stageIndex = WORKFLOW_STAGE_FLOW.findIndex(item => item.stage === params.stage)
  const currentStageIndex = stageIndex >= 0 ? stageIndex + 1 : 0
  const currentStageName = stageIndex >= 0 ? WORKFLOW_STAGE_FLOW[stageIndex].name : params.stage
  console.info('workflow observation', {
    jobId: params.jobId,
    stage: params.stage,
    stageName: currentStageName,
    stageOrder: {
      current: currentStageIndex,
      total: WORKFLOW_STAGE_FLOW.length,
    },
    stageFlow: WORKFLOW_STAGE_FLOW.map(item => item.stage),
    continuationSeq: params.continuationSeq,
    status: params.status,
    cursor: params.cursor,
    progress: {
      sources: {
        processed: progress.sourcesProcessed,
        total: progress.sourcesTotal,
      },
      gmailMessages: {
        processed: progress.gmailProcessed,
        total: progress.gmailTotal,
      },
      stories: {
        processed: progress.storiesProcessed,
        total: progress.storiesTotal,
        relevant: progress.storiesRelevant,
      },
      ttsLines: {
        processed: progress.ttsProcessed,
        total: progress.ttsTotal,
      },
    },
    budgetUsed: params.budget.used,
    budgetLimit: params.budget.limit,
    budgetReserve: params.budget.reserve,
    label: params.label,
    ...(params.extra || {}),
  })
}

function createInitialCursor(): WorkflowCursorState {
  return {
    sourceIndex: 0,
    gmailIndex: 0,
    storyIndex: 0,
    ttsLineIndex: 0,
  }
}

function isWorkflowStage(value: unknown): value is WorkflowStage {
  return value === 'collect_candidates'
    || value === 'expand_gmail'
    || value === 'summarize_stories'
    || value === 'compose_text'
    || value === 'tts_render'
    || value === 'done'
}

function parseWorkflowCursor(value: unknown): WorkflowCursorState {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  return {
    sourceIndex: normalizeNonNegativeInt(record.sourceIndex),
    gmailIndex: normalizeNonNegativeInt(record.gmailIndex),
    storyIndex: normalizeNonNegativeInt(record.storyIndex),
    ttsLineIndex: normalizeNonNegativeInt(record.ttsLineIndex),
  }
}

function parseWorkflowJobState(value: unknown): WorkflowJobState | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.jobId !== 'string' || !record.jobId.trim()) {
    return null
  }
  if (!isWorkflowStage(record.stage)) {
    return null
  }
  const cursor = parseWorkflowCursor(record.cursor)
  return {
    jobId: record.jobId,
    stage: record.stage,
    continuationSeq: typeof record.continuationSeq === 'number' && Number.isFinite(record.continuationSeq)
      ? Math.max(0, Math.floor(record.continuationSeq))
      : 0,
    nowIso: typeof record.nowIso === 'string' ? record.nowIso : new Date().toISOString(),
    today: typeof record.today === 'string' ? record.today : '',
    windowMode: record.windowMode === 'rolling' ? 'rolling' : 'calendar',
    windowHours: typeof record.windowHours === 'number' && Number.isFinite(record.windowHours)
      ? Math.max(1, Math.floor(record.windowHours))
      : 24,
    publishDateKey: typeof record.publishDateKey === 'string' ? record.publishDateKey : '',
    publishedAt: typeof record.publishedAt === 'string' ? record.publishedAt : '',
    cursor,
    progress: parseWorkflowProgress(record.progress, cursor),
    candidatesKey: typeof record.candidatesKey === 'string' ? record.candidatesKey : undefined,
    summaryKey: typeof record.summaryKey === 'string' ? record.summaryKey : undefined,
    composeKey: typeof record.composeKey === 'string' ? record.composeKey : undefined,
    contentKey: typeof record.contentKey === 'string' ? record.contentKey : undefined,
    podcastKey: typeof record.podcastKey === 'string' ? record.podcastKey : undefined,
    provider: record.provider === 'edge' || record.provider === 'gemini' || record.provider === 'minimax' || record.provider === 'murf'
      ? record.provider
      : undefined,
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
    status: record.status === 'done' ? 'done' : 'running',
  }
}

function createInitialWorkflowJobState(params: {
  jobId: string
  continuationSeq: number
  nowIso: string
  today: string
  windowMode: 'calendar' | 'rolling'
  windowHours: number
  publishDateKey: string
  publishedAt: string
  sourceTotal: number
}): WorkflowJobState {
  return {
    jobId: params.jobId,
    stage: 'collect_candidates',
    continuationSeq: params.continuationSeq,
    nowIso: params.nowIso,
    today: params.today,
    windowMode: params.windowMode,
    windowHours: params.windowHours,
    publishDateKey: params.publishDateKey,
    publishedAt: params.publishedAt,
    cursor: createInitialCursor(),
    progress: createInitialProgress(params.sourceTotal),
    updatedAt: Date.now(),
    status: 'running',
  }
}

async function loadJsonFromR2<T>(r2: R2Bucket, key: string): Promise<T | null> {
  const object = await r2.get(key)
  if (!object) {
    return null
  }
  const text = await object.text()
  if (!text.trim()) {
    return null
  }
  return JSON.parse(text) as T
}

async function saveJsonToR2(r2: R2Bucket, key: string, value: unknown) {
  await r2.put(key, JSON.stringify(value))
}

export class TtsWorkflow extends WorkflowEntrypoint<Env, TtsWorkflowParams> {
  async run(event: WorkflowEvent<TtsWorkflowParams>, step: WorkflowStep) {
    console.info('trigged event: TtsWorkflow', event)

    const payload = event.payload
    if (!payload) {
      throw new Error('TtsWorkflow payload is required')
    }

    const {
      parsedConversations,
      podcastKey,
      contentKey,
      ttsSettings,
      ffmpegAudioQuality,
      introThemeUrl,
      introMusicConfig,
      isDev,
    } = payload

    if (!parsedConversations.length) {
      throw new Error('TtsWorkflow payload has no dialog lines')
    }

    const ttsProvider = await step.do('validate tts config', { ...retryConfig, retries: withRetryLimit(0) }, async () => {
      const provider = validateTtsConfig(this.env, ttsSettings.provider)
      console.info('TTS config validated', {
        provider,
        hasGeminiApiKey: Boolean(this.env.GEMINI_API_KEY?.trim()),
        hasTtsApiKey: Boolean(this.env.TTS_API_KEY?.trim()),
        hasTtsApiId: Boolean(this.env.TTS_API_ID?.trim()),
      })
      return provider
    })
    const useGeminiTTS = ttsProvider === 'gemini'

    const tmpPrefix = `tmp/${event.instanceId}`
    const geminiWavKey = `${tmpPrefix}/podcast.wav`
    const basePodcastKey = `${tmpPrefix}/podcast.base.mp3`
    const nonGeminiAudioKeys: string[] = []
    let basePodcastUrl = ''

    if (useGeminiTTS) {
      const dialogLines = parsedConversations.map(item => item.raw)
      const geminiPrompt = buildGeminiTtsPrompt(dialogLines, {
        geminiPrompt: ttsSettings.geminiPrompt,
        geminiSpeakers: ttsSettings.geminiSpeakers,
      })

      console.info('Gemini TTS input', {
        totalLines: parsedConversations.length,
        promptChars: geminiPrompt.length,
      })

      const geminiAudioUrl = await step.do('create gemini podcast audio', { ...retryConfig, retries: withRetryLimit(2), timeout: '10 minutes' }, async () => {
        const startedAt = Date.now()
        const retryLimit = 2
        for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
          try {
            console.info('Gemini TTS attempt', {
              attempt: attempt + 1,
              promptChars: geminiPrompt.length,
              lines: parsedConversations.length,
            })
            const result = await synthesizeGeminiTTS(geminiPrompt, this.env, {
              model: ttsSettings.model,
              apiUrl: ttsSettings.apiUrl,
              geminiSpeakers: ttsSettings.geminiSpeakers,
            })
            if (!result.audio.size) {
              throw new Error('podcast audio size is 0')
            }

            const audioUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${geminiWavKey}?t=${Date.now()}`
            await this.env.PODCAST_R2.put(geminiWavKey, result.audio)

            console.info('Gemini TTS done', {
              key: geminiWavKey,
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

      await step.sleep('reset quota before convert', '5 seconds')

      basePodcastUrl = await step.do('convert gemini audio to mp3', { ...retryConfig, retries: withRetryLimit(3) }, async () => {
        if (!this.env.BROWSER) {
          throw new Error('BROWSER binding is required for audio convert')
        }

        const blob = await concatAudioFiles([geminiAudioUrl], this.env.BROWSER, {
          workerUrl: this.env.PODCAST_WORKER_URL,
          audioQuality: ffmpegAudioQuality,
        })
        await this.env.PODCAST_R2.put(basePodcastKey, blob)
        const nextBasePodcastUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${basePodcastKey}?t=${Date.now()}`

        console.info('Gemini audio converted to MP3', {
          key: basePodcastKey,
          size: blob.size,
        })
        return nextBasePodcastUrl
      })
    }
    else {
      for (const [index, conversation] of parsedConversations.entries()) {
        let audioUrl = ''
        for (let attempt = 1; attempt <= NON_GEMINI_TTS_MAX_ATTEMPTS; attempt += 1) {
          try {
            audioUrl = await step.do(
              `create audio ${index} attempt ${attempt}: ${conversation.text.substring(0, 20)}...`,
              { ...retryConfig, retries: withRetryLimit(0), timeout: '30 minutes' },
              async () => {
                const startedAt = Date.now()
                console.info('create conversation audio', conversation.raw)
                const audio = await synthesize(conversation.text, conversation.speaker, this.env, {
                  provider: ttsSettings.provider,
                  language: ttsSettings.language,
                  languageBoost: ttsSettings.languageBoost,
                  model: ttsSettings.model,
                  speed: ttsSettings.speed,
                  apiUrl: ttsSettings.apiUrl,
                  voicesBySpeaker: ttsSettings.voicesBySpeaker,
                })

                if (!audio.size) {
                  throw new Error('podcast audio size is 0')
                }

                const audioKey = `${tmpPrefix}/podcast-${index}.mp3`
                const nextAudioUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${audioKey}?t=${Date.now()}`

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
                if (isDev) {
                  console.info('TTS line duration', { index, ms: Date.now() - startedAt })
                }
                return nextAudioUrl
              },
            )
            break
          }
          catch (error) {
            const subrequestLimited = isSubrequestLimitError(error)
            console.warn('TTS line attempt failed', {
              index,
              attempt,
              subrequestLimited,
              error: formatError(error),
            })
            if (attempt >= NON_GEMINI_TTS_MAX_ATTEMPTS) {
              console.error('TTS line failed', {
                index,
                conversation: conversation.raw,
                error: formatError(error),
              })
              throw error
            }
            await step.sleep(
              subrequestLimited
                ? `yield subrequest budget before retry audio ${index}`
                : `wait before retry audio ${index}`,
              subrequestLimited
                ? NON_GEMINI_TTS_SUBREQUEST_BACKOFF_SLEEP
                : NON_GEMINI_TTS_RETRY_SLEEP,
            )
          }
        }

        if (!audioUrl) {
          throw new Error(`TTS line ${index} failed without output URL`)
        }

        nonGeminiAudioKeys.push(`${tmpPrefix}/podcast-${index}.mp3`)
        const hasMoreLines = index < parsedConversations.length - 1
        if (hasMoreLines) {
          await step.sleep(
            `yield between TTS lines after line ${index}`,
            NON_GEMINI_TTS_LINE_SLEEP,
          )
        }
      }

      basePodcastUrl = await step.do('concat audio files', retryConfig, async () => {
        if (!this.env.BROWSER) {
          throw new Error('BROWSER binding is required for concat audio files')
        }

        const audioFiles = nonGeminiAudioKeys.map(key => `${this.env.PODCAST_R2_BUCKET_URL}/${key}?t=${Date.now()}`)
        const blob = await concatAudioFiles(audioFiles, this.env.BROWSER, {
          workerUrl: this.env.PODCAST_WORKER_URL,
          audioQuality: ffmpegAudioQuality,
        })
        await this.env.PODCAST_R2.put(basePodcastKey, blob)
        const nextBasePodcastUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${basePodcastKey}?t=${Date.now()}`

        console.info('concat audio files done', { key: basePodcastKey, size: blob.size })
        return nextBasePodcastUrl
      })
    }

    await step.sleep('reset quota before intro music', '30 seconds')

    try {
      await step.do('add intro music', retryConfig, async () => {
        if (!this.env.BROWSER) {
          throw new Error('BROWSER binding is required for intro music')
        }
        const blob = await addIntroMusic(basePodcastUrl, this.env.BROWSER, {
          workerUrl: this.env.PODCAST_WORKER_URL,
          themeUrl: introThemeUrl,
          fadeOutStart: introMusicConfig.fadeOutStart,
          fadeOutDuration: introMusicConfig.fadeOutDuration,
          podcastDelayMs: introMusicConfig.podcastDelay,
          audioQuality: ffmpegAudioQuality,
        })
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
        const baseObj = await this.env.PODCAST_R2.get(basePodcastKey)
        if (!baseObj) {
          throw new Error('Base podcast object not found for fallback')
        }
        await this.env.PODCAST_R2.put(podcastKey, baseObj.body)
        console.info('fallback: base podcast copied', { key: podcastKey })
      })
    }

    await step.do('update content audio in kv', retryConfig, async () => {
      const current = await this.env.PODCAST_KV.get(contentKey, 'json')
      if (!current || typeof current !== 'object') {
        throw new Error(`content not found for key: ${contentKey}`)
      }
      const existing = current as Record<string, unknown>
      const updatedAt = Date.now()
      const nextContent = {
        ...existing,
        audio: podcastKey,
        updatedAt,
        updatedBy: 'tts-workflow',
      }
      await this.env.PODCAST_KV.put(contentKey, JSON.stringify(nextContent))
      console.info('content audio updated in kv', {
        contentKey,
        podcastKey,
      })
    })

    await step.do('clean up temporary data', retryConfig, async () => {
      const deletePromises: Array<Promise<unknown>> = [
        this.env.PODCAST_R2.delete(basePodcastKey).catch((error) => {
          console.error('delete base podcast temp failed', {
            key: basePodcastKey,
            error: formatError(error),
          })
        }),
      ]

      if (useGeminiTTS) {
        deletePromises.push(this.env.PODCAST_R2.delete(geminiWavKey).catch((error) => {
          console.error('delete gemini temp wav failed', {
            key: geminiWavKey,
            error: formatError(error),
          })
        }))
      }
      else {
        for (const key of nonGeminiAudioKeys) {
          deletePromises.push(this.env.PODCAST_R2.delete(key).catch((error) => {
            console.error('delete temp files failed', {
              key,
              error: formatError(error),
            })
          }))
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

export class PodcastWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    console.info('trigged event: PodcastWorkflow', event)

    const runEnv = this.env.NODE_ENV || 'production'
    const isDev = runEnv !== 'production'
    const runtimeState = await getActiveRuntimeConfig(this.env)
    const runtimeConfig = runtimeState.config
    const runtimePrompts: RuntimePromptSet = renderPromptTemplates(
      runtimeConfig.prompts,
      getTemplateVariables(runtimeConfig),
    )
    const speakerMarkers = getSpeakerMarkers(runtimeConfig)
    const runtimeTtsSettings = buildRuntimeTtsSettings(runtimeConfig)
    const introThemeUrl = runtimeConfig.tts.introMusic.url
      ? new URL(runtimeConfig.tts.introMusic.url, this.env.PODCAST_WORKER_URL).toString()
      : undefined
    const ffmpegAudioQuality = DEFAULT_FFMPEG_AUDIO_QUALITY
    const breakTime = isDev ? '2 seconds' : '5 seconds'
    const payloadNow = event.payload?.nowIso ? new Date(event.payload.nowIso) : null
    const now = payloadNow && !Number.isNaN(payloadNow.getTime())
      ? payloadNow
      : new Date()
    const windowMode = event.payload?.windowMode
    const windowHours = event.payload?.windowHours ?? 24
    const sourceFrequencyDays = Math.max(1, runtimeConfig.sources.lookbackDays)
    const timeZone = runtimeConfig.locale.timezone || 'America/Chicago'
    const { windowStart, windowEnd, windowDateKey } = buildTimeWindow(now, windowMode, windowHours, sourceFrequencyDays, timeZone)
    const today = event.payload?.today || windowDateKey
    const publishedAt = now.toISOString()
    const publishDateKey = getDateKeyInTimeZone(now, timeZone)
    const skipTTS = runtimeConfig.tts.skipTts === true
    const runtimeAi = runtimeConfig.ai
    const aiProvider = getAiProvider(this.env, runtimeAi)
    const maxTokens = getMaxTokens(this.env, aiProvider, runtimeAi)
    const primaryModel = getPrimaryModel(this.env, aiProvider, runtimeAi)
    const thinkingModel = getThinkingModel(this.env, aiProvider, runtimeAi)
    const testConfig = runtimeConfig.test
    const testStep = (testConfig.workflowTestStep || this.env.WORKFLOW_TEST_STEP || '').trim().toLowerCase()
    const testInputOverride = testConfig.workflowTestInput || this.env.WORKFLOW_TEST_INPUT || ''
    const testInstructionsOverride = testConfig.workflowTestInstructions || this.env.WORKFLOW_TEST_INSTRUCTIONS || ''
    const ttsTestInputOverride = testConfig.workflowTtsInput || this.env.WORKFLOW_TTS_INPUT || ''

    console.info('AI runtime config', {
      provider: aiProvider,
      primaryModel,
      thinkingModel,
      maxTokens,
      runtimeConfigVersion: runtimeState.version,
      runtimeConfigSource: runtimeState.source,
      runtimeTimeZone: timeZone,
      ttsProvider: runtimeTtsSettings.provider,
      speakerMarkers,
    })
    console.info('source fetch window config', {
      mode: windowMode || 'calendar',
      frequencyDays: sourceFrequencyDays,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      timeZone,
    })

    if (testStep && testStep !== 'stories') {
      const fallbackInput = 'Summarize the following in one sentence: This is a short test input.'
      const fallbackInstructions = 'You are a concise assistant.'
      const testInput = testInputOverride || fallbackInput
      const testInstructions = testInstructionsOverride || fallbackInstructions
      const primarySpeaker = speakerMarkers[0] || 'Host1'
      const secondarySpeaker = speakerMarkers[1] || speakerMarkers[0] || 'Host2'

      const text = await step.do(`workflow test step: ${testStep}`, retryConfig, async () => {
        if (testStep === 'openai' || testStep === 'responses') {
          return (await createResponseText({
            env: this.env,
            runtimeAi,
            model: primaryModel,
            instructions: testInstructions,
            input: testInput,
            maxOutputTokens: maxTokens,
          })).text
        }

        if (testStep === 'tts') {
          const sampleInput = ttsTestInputOverride
            || testInputOverride
            || [
              `${primarySpeaker}：大家好，欢迎收听测试播客。`,
              `${secondarySpeaker}：大家好。今天我们用一小段对话来测试 TTS。`,
              `${primarySpeaker}：如果你能听到自然的双人声切换，说明流程是通的。`,
            ].join('\n')

          console.info('TTS test input', {
            chars: sampleInput.length,
            preview: sampleInput.slice(0, 200),
          })

          if (skipTTS) {
            return 'skip TTS enabled, skip audio generation'
          }

          const ttsProvider = validateTtsConfig(this.env, runtimeTtsSettings.provider)

          if (ttsProvider === 'gemini') {
            const lines = sampleInput
              .split('\n')
              .map(line => line.trim())
              .filter(Boolean)
            const prompt = buildGeminiTtsPrompt(lines, {
              geminiPrompt: runtimeTtsSettings.geminiPrompt,
              geminiSpeakers: runtimeTtsSettings.geminiSpeakers,
            })
            const { audio, extension } = await synthesizeGeminiTTS(prompt, this.env, {
              model: runtimeTtsSettings.model,
              apiUrl: runtimeTtsSettings.apiUrl,
              geminiSpeakers: runtimeTtsSettings.geminiSpeakers,
            })
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
          const parsedConversations = parseConversationLines(conversations, speakerMarkers)
          if (parsedConversations.length === 0) {
            throw new Error('No valid TTS dialog lines found. Please ensure each line starts with configured speaker markers.')
          }

          const testPrefix = `tmp/${event.instanceId}/tts-test`
          const audioUrls: string[] = []
          for (const [index, conversation] of parsedConversations.entries()) {
            const audio = await synthesize(conversation.text, conversation.speaker, this.env, {
              provider: runtimeTtsSettings.provider,
              language: runtimeTtsSettings.language,
              languageBoost: runtimeTtsSettings.languageBoost,
              model: runtimeTtsSettings.model,
              speed: runtimeTtsSettings.speed,
              apiUrl: runtimeTtsSettings.apiUrl,
              voicesBySpeaker: runtimeTtsSettings.voicesBySpeaker,
            })
            if (!audio.size) {
              throw new Error('podcast audio size is 0')
            }
            const audioKey = `${testPrefix}-${index}.mp3`
            await this.env.PODCAST_R2.put(audioKey, audio)
            const audioUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${audioKey}?t=${Date.now()}`
            audioUrls.push(audioUrl)
          }

          if (!this.env.BROWSER) {
            return `Generated ${audioUrls.length} audio files (no BROWSER binding, skipped merge)`
          }

          const merged = await concatAudioFiles(audioUrls, this.env.BROWSER, {
            workerUrl: this.env.PODCAST_WORKER_URL,
            audioQuality: ffmpegAudioQuality,
          })
          const mergedKey = `${testPrefix}.merged.mp3`
          await this.env.PODCAST_R2.put(mergedKey, merged)
          const mergedUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${mergedKey}?t=${Date.now()}`
          console.info('tts test merged audio url', {
            mergedUrl,
            sourceCount: audioUrls.length,
          })
          return mergedUrl
        }

        if (testStep === 'tts-intro') {
          const sampleInput = ttsTestInputOverride
            || testInputOverride
            || [
              `${primarySpeaker}：大家好，欢迎收听测试播客。`,
              `${secondarySpeaker}：大家好。今天我们用一小段对话来测试 TTS 和片头音乐效果。`,
              `${primarySpeaker}：如果你能听到片头音乐淡出后接上人声，说明流程是通的。`,
            ].join('\n')

          console.info('TTS intro test input', {
            chars: sampleInput.length,
            preview: sampleInput.slice(0, 200),
          })

          if (skipTTS) {
            return 'skip TTS enabled, skip audio generation'
          }

          if (!this.env.BROWSER) {
            throw new Error('BROWSER binding is required for tts-intro test')
          }

          const ttsProvider = validateTtsConfig(this.env, runtimeTtsSettings.provider)
          const testPrefix = `tmp/${event.instanceId}/tts-intro`

          // Step 1: Generate TTS audio (no browser needed)
          const ttsResult = await step.do('tts-intro: generate tts', { ...retryConfig, timeout: '10 minutes' }, async () => {
            if (ttsProvider === 'gemini') {
              const lines = sampleInput.split('\n').map(line => line.trim()).filter(Boolean)
              const prompt = buildGeminiTtsPrompt(lines, {
                geminiPrompt: runtimeTtsSettings.geminiPrompt,
                geminiSpeakers: runtimeTtsSettings.geminiSpeakers,
              })
              console.info('tts-intro: gemini prompt', {
                lines: lines.length,
                chars: prompt.length,
                preview: prompt.slice(0, 240),
              })
              const { audio } = await synthesizeGeminiTTS(prompt, this.env, {
                model: runtimeTtsSettings.model,
                apiUrl: runtimeTtsSettings.apiUrl,
                geminiSpeakers: runtimeTtsSettings.geminiSpeakers,
              })
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
            const parsedConversations = parseConversationLines(conversations, speakerMarkers)
            const audioUrls: string[] = []
            for (const [index, conversation] of parsedConversations.entries()) {
              const audio = await synthesize(conversation.text, conversation.speaker, this.env, {
                provider: runtimeTtsSettings.provider,
                language: runtimeTtsSettings.language,
                languageBoost: runtimeTtsSettings.languageBoost,
                model: runtimeTtsSettings.model,
                speed: runtimeTtsSettings.speed,
                apiUrl: runtimeTtsSettings.apiUrl,
                voicesBySpeaker: runtimeTtsSettings.voicesBySpeaker,
              })
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
            const mp3Blob = await concatAudioFiles(ttsResult.urls, this.env.BROWSER, {
              workerUrl: this.env.PODCAST_WORKER_URL,
              audioQuality: ffmpegAudioQuality,
            })
            const baseKey = `${testPrefix}.base.mp3`
            await this.env.PODCAST_R2.put(baseKey, mp3Blob)
            const url = `${this.env.PODCAST_R2_BUCKET_URL}/${baseKey}?t=${Date.now()}`
            console.info('tts-intro: mp3 conversion done', { baseKey, size: mp3Blob.size })
            return url
          })

          await step.sleep('reset quota before intro music', '30 seconds')

          // Step 3: Add intro music (needs browser)
          const finalUrl = await step.do('tts-intro: add intro music', retryConfig, async () => {
            const finalBlob = await addIntroMusic(baseUrl, this.env.BROWSER, {
              workerUrl: this.env.PODCAST_WORKER_URL,
              themeUrl: introThemeUrl,
              fadeOutStart: runtimeConfig.tts.introMusic.fadeOutStart,
              fadeOutDuration: runtimeConfig.tts.introMusic.fadeOutDuration,
              podcastDelayMs: runtimeConfig.tts.introMusic.podcastDelay,
              audioQuality: ffmpegAudioQuality,
            })
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
          return finalUrl
        }

        if (testStep === 'story') {
          const candidates = await getStoryCandidatesFromSources({
            now,
            env: this.env,
            window: { start: windowStart, end: windowEnd, timeZone },
            sourceConfig: {
              lookbackDays: runtimeConfig.sources.lookbackDays,
              sources: runtimeConfig.sources.items,
            },
            sourceOptions: {
              timeZone,
              newsletterHosts: runtimeConfig.sources.newsletterHosts,
              archiveLinkKeywords: runtimeConfig.sources.archiveLinkKeywords,
              extractNewsletterLinksPrompt: runtimePrompts.extractNewsletterLinks,
              runtimeAi,
            },
          })
          let story = candidates.stories[0]
          if (!story && candidates.gmailMessages.length > 0) {
            const messageRef = candidates.gmailMessages[0]
            const messageStories = await processGmailMessage({
              messageId: messageRef.id,
              source: messageRef.source,
              now,
              lookbackDays: messageRef.lookbackDays,
              env: this.env,
              runtimeAi,
              window: { start: windowStart, end: windowEnd, timeZone },
              timeZone,
              archiveLinkKeywords: runtimeConfig.sources.archiveLinkKeywords,
              extractNewsletterLinksPrompt: runtimePrompts.extractNewsletterLinks,
            })
            story = messageStories[0]
          }
          if (!story) {
            throw new Error('workflow test step "story": no stories found')
          }
          const storyResponse = await getStoryContent(story, maxTokens, this.env)
          const { result } = await summarizeStoryWithRelevance({
            env: this.env,
            runtimeAi,
            model: primaryModel,
            instructions: runtimePrompts.summarizeStory,
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
            runtimeAi,
            model: thinkingModel,
            instructions: runtimePrompts.summarizePodcast,
            input: testInputOverride || sampleStories,
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
            runtimeAi,
            model: thinkingModel,
            instructions: runtimePrompts.summarizeBlog,
            input: testInputOverride || sampleInput,
            maxOutputTokens: maxTokens,
          })).text
        }

        if (testStep === 'intro') {
          const sampleInput = testInputOverride
            || `${primarySpeaker}：大家好，欢迎收听测试播客。\n${secondarySpeaker}：大家好，这是一段测试内容。`
          return (await createResponseText({
            env: this.env,
            runtimeAi,
            model: primaryModel,
            instructions: runtimePrompts.intro,
            input: sampleInput,
            maxOutputTokens: maxTokens,
          })).text
        }

        throw new Error(`workflow test step "${testStep}" is not supported`)
      })

      const textOutput = typeof text === 'string' ? text : JSON.stringify(text)
      console.info(`workflow test step "${testStep}" result`, {
        text: isDev ? textOutput : textOutput.slice(0, 200),
      })
      return
    }

    const jobId = event.payload?.jobId?.trim() || event.instanceId
    const stateKey = buildJobStateKey(jobId)
    const enabledSources = runtimeConfig.sources.items.filter(source => source.enabled !== false)
    const requestedContinuationSeq = typeof event.payload?.continuationSeq === 'number'
      ? Math.max(0, Math.floor(event.payload.continuationSeq))
      : 0
    const budget = createBudgetTracker()

    let workflowState = await step.do('load workflow state', retryConfig, async () => {
      const raw = await this.env.PODCAST_KV.get(stateKey, 'json')
      return parseWorkflowJobState(raw)
    })
    consumeBudget(budget, BUDGET_COST.kvRead, 'load workflow state', jobId)

    if (!workflowState) {
      workflowState = createInitialWorkflowJobState({
        jobId,
        continuationSeq: requestedContinuationSeq,
        nowIso: now.toISOString(),
        today,
        windowMode: windowMode === 'rolling' ? 'rolling' : 'calendar',
        windowHours,
        publishDateKey,
        publishedAt,
        sourceTotal: enabledSources.length,
      })
      logWorkflowObservation({
        jobId,
        stage: workflowState.stage,
        continuationSeq: workflowState.continuationSeq,
        status: workflowState.status,
        cursor: workflowState.cursor,
        progress: workflowState.progress,
        budget,
        label: 'create initial state',
      })
    }
    else {
      workflowState.progress = normalizeProgress({
        ...workflowState.progress,
        sourcesTotal: Math.max(workflowState.progress.sourcesTotal, enabledSources.length),
      }, workflowState.cursor)
      logWorkflowObservation({
        jobId,
        stage: workflowState.stage,
        continuationSeq: workflowState.continuationSeq,
        status: workflowState.status,
        cursor: workflowState.cursor,
        progress: workflowState.progress,
        budget,
        label: 'resume from persisted state',
      })
    }

    const saveWorkflowState = async (label: string) => {
      await step.do(label, retryConfig, async () => {
        workflowState.progress = normalizeProgress(workflowState.progress, workflowState.cursor)
        workflowState.updatedAt = Date.now()
        await this.env.PODCAST_KV.put(stateKey, JSON.stringify(workflowState))
        return workflowState.stage
      })
      consumeBudget(budget, BUDGET_COST.kvWrite, label, jobId)
      logWorkflowObservation({
        jobId,
        stage: workflowState.stage,
        continuationSeq: workflowState.continuationSeq,
        status: workflowState.status,
        cursor: workflowState.cursor,
        progress: workflowState.progress,
        budget,
        label: `state saved: ${label}`,
      })
    }

    const loadCandidatesSnapshot = async () => {
      if (!workflowState.candidatesKey) {
        return { stories: [], gmailMessages: [] } satisfies CandidateSnapshot
      }
      const loaded = await step.do('load candidates snapshot', retryConfig, async () => {
        return await loadJsonFromR2<CandidateSnapshot>(this.env.PODCAST_R2, workflowState.candidatesKey as string)
      })
      consumeBudget(budget, BUDGET_COST.r2Read, 'load candidates snapshot', jobId)
      return loaded || { stories: [], gmailMessages: [] } satisfies CandidateSnapshot
    }

    const saveCandidatesSnapshot = async (snapshot: CandidateSnapshot) => {
      const key = workflowState.candidatesKey || buildJobDataKey(jobId, 'candidates')
      await step.do('save candidates snapshot', retryConfig, async () => {
        await saveJsonToR2(this.env.PODCAST_R2, key, snapshot)
        return key
      })
      consumeBudget(budget, BUDGET_COST.r2Write, 'save candidates snapshot', jobId)
      workflowState.candidatesKey = key
    }

    const loadSummarySnapshot = async () => {
      if (!workflowState.summaryKey) {
        return { keptStories: [], allStories: [] } satisfies SummarySnapshot
      }
      const loaded = await step.do('load summary snapshot', retryConfig, async () => {
        return await loadJsonFromR2<SummarySnapshot>(this.env.PODCAST_R2, workflowState.summaryKey as string)
      })
      consumeBudget(budget, BUDGET_COST.r2Read, 'load summary snapshot', jobId)
      return loaded || { keptStories: [], allStories: [] } satisfies SummarySnapshot
    }

    const saveSummarySnapshot = async (snapshot: SummarySnapshot) => {
      const key = workflowState.summaryKey || buildJobDataKey(jobId, 'summary')
      await step.do('save summary snapshot', retryConfig, async () => {
        await saveJsonToR2(this.env.PODCAST_R2, key, snapshot)
        return key
      })
      consumeBudget(budget, BUDGET_COST.r2Write, 'save summary snapshot', jobId)
      workflowState.summaryKey = key
    }

    const loadComposeSnapshot = async () => {
      if (!workflowState.composeKey) {
        return null
      }
      const loaded = await step.do('load compose snapshot', retryConfig, async () => {
        return await loadJsonFromR2<ComposeSnapshot>(this.env.PODCAST_R2, workflowState.composeKey as string)
      })
      consumeBudget(budget, BUDGET_COST.r2Read, 'load compose snapshot', jobId)
      return loaded
    }

    const saveComposeSnapshot = async (snapshot: ComposeSnapshot) => {
      const key = workflowState.composeKey || buildJobDataKey(jobId, 'compose')
      await step.do('save compose snapshot', retryConfig, async () => {
        await saveJsonToR2(this.env.PODCAST_R2, key, snapshot)
        return key
      })
      consumeBudget(budget, BUDGET_COST.r2Write, 'save compose snapshot', jobId)
      workflowState.composeKey = key
    }

    const spawnContinuation = async (reason: string) => {
      workflowState.continuationSeq += 1
      await saveWorkflowState(`checkpoint before continuation: ${reason}`)
      const nextSeq = workflowState.continuationSeq
      const nextInstanceId = `${jobId}-c${nextSeq}`
      const instanceId = await step.do(`spawn continuation #${nextSeq}`, { ...retryConfig, retries: withRetryLimit(2) }, async () => {
        try {
          const instance = await this.env.PODCAST_WORKFLOW.create({
            id: nextInstanceId,
            params: {
              jobId,
              continuationSeq: nextSeq,
              nowIso: workflowState.nowIso,
              today: workflowState.today,
              windowMode: workflowState.windowMode,
              windowHours: workflowState.windowHours,
            },
          })
          return instance.id
        }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message.toLowerCase().includes('already exists') || message.toLowerCase().includes('duplicate')) {
            return nextInstanceId
          }
          throw error
        }
      })
      consumeBudget(budget, BUDGET_COST.workflowCreate, 'spawn continuation', jobId)
      console.info('continuation spawned', {
        jobId,
        reason,
        currentInstanceId: event.instanceId,
        nextInstanceId: instanceId,
        stage: workflowState.stage,
      })
      logWorkflowObservation({
        jobId,
        stage: workflowState.stage,
        continuationSeq: workflowState.continuationSeq,
        status: workflowState.status,
        cursor: workflowState.cursor,
        progress: workflowState.progress,
        budget,
        label: 'continuation spawned',
        extra: {
          reason,
          nextInstanceId: instanceId,
        },
      })
    }

    const maybeHandoff = async (
      stage: WorkflowStage,
      nextCost: number,
      reason: string,
      cursorPatch?: Partial<WorkflowCursorState>,
    ) => {
      if (!shouldHandoff(budget, nextCost)) {
        return false
      }
      logWorkflowObservation({
        jobId,
        stage,
        continuationSeq: workflowState.continuationSeq,
        status: workflowState.status,
        cursor: {
          ...workflowState.cursor,
          ...(cursorPatch || {}),
        },
        progress: workflowState.progress,
        budget,
        label: 'handoff required',
        extra: {
          reason,
          nextCost,
        },
      })
      workflowState.stage = stage
      workflowState.cursor = {
        ...workflowState.cursor,
        ...cursorPatch,
      }
      workflowState.progress = normalizeProgress(workflowState.progress, workflowState.cursor)
      await spawnContinuation(reason)
      return true
    }

    if (!workflowState.today) {
      workflowState.today = today
    }
    if (!workflowState.publishDateKey) {
      workflowState.publishDateKey = publishDateKey
    }
    if (!workflowState.publishedAt) {
      workflowState.publishedAt = publishedAt
    }
    if (!workflowState.nowIso) {
      workflowState.nowIso = now.toISOString()
    }
    await saveWorkflowState('save workflow state bootstrap')

    let stageLogCursor = ''
    while (true) {
      if (workflowState.status === 'done' || workflowState.stage === 'done') {
        logWorkflowObservation({
          jobId,
          stage: workflowState.stage,
          continuationSeq: workflowState.continuationSeq,
          status: workflowState.status,
          cursor: workflowState.cursor,
          progress: workflowState.progress,
          budget,
          label: 'workflow loop exit',
        })
        return
      }
      const currentStageCursor = `${workflowState.stage}:${workflowState.cursor.sourceIndex}:${workflowState.cursor.gmailIndex}:${workflowState.cursor.storyIndex}:${workflowState.cursor.ttsLineIndex}`
      if (stageLogCursor !== currentStageCursor) {
        stageLogCursor = currentStageCursor
        logWorkflowObservation({
          jobId,
          stage: workflowState.stage,
          continuationSeq: workflowState.continuationSeq,
          status: workflowState.status,
          cursor: workflowState.cursor,
          progress: workflowState.progress,
          budget,
          label: 'enter stage',
        })
      }
      if (workflowState.stage === 'collect_candidates') {
        const candidatesSnapshot = await loadCandidatesSnapshot()
        workflowState.progress.sourcesTotal = Math.max(
          workflowState.progress.sourcesTotal,
          enabledSources.length,
        )
        for (let sourceIndex = workflowState.cursor.sourceIndex; sourceIndex < enabledSources.length; sourceIndex += 1) {
          const source = enabledSources[sourceIndex]
          const predictedSourceCost = source.type === 'rss'
            ? BUDGET_COST.sourceFetchRssBase + BUDGET_COST.sourceFetchRssNewsletterItem
            : source.type === 'gmail'
              ? BUDGET_COST.sourceFetchGmailBase + BUDGET_COST.sourceFetchGmailPerRef
              : 0
          if (await maybeHandoff(
            'collect_candidates',
            predictedSourceCost + BUDGET_COST.r2Write + BUDGET_COST.workflowCreate,
            `collect source index ${sourceIndex}`,
            { sourceIndex },
          )) {
            return
          }

          const lookbackDays = source.lookbackDays ?? runtimeConfig.sources.lookbackDays
          if (source.type === 'rss') {
            const stories = await step.do(`collect source rss ${source.id}`, retryConfig, async () => {
              return await fetchRssItems(source, now, lookbackDays, {
                start: windowStart,
                end: windowEnd,
                timeZone,
              }, this.env, {
                timeZone,
                newsletterHosts: runtimeConfig.sources.newsletterHosts,
                extractNewsletterLinksPrompt: runtimePrompts.extractNewsletterLinks,
                runtimeAi,
              })
            })
            const sourceCost = estimateRssSourceFetchCost(stories)
            consumeBudget(budget, sourceCost, `collect rss ${source.id}`, jobId, {
              stories: stories.length,
              newsletterItems: new Set(
                stories.map(story => (story.sourceItemId || '').trim()).filter(Boolean),
              ).size,
            })
            if (stories.length > 0) {
              candidatesSnapshot.stories.push(...stories)
            }
          }
          else if (source.type === 'gmail') {
            const refs = await step.do(`collect source gmail ${source.id}`, retryConfig, async () => {
              return await listGmailMessageRefs(source, now, lookbackDays, this.env, {
                start: windowStart,
                end: windowEnd,
                timeZone,
              }, {
                timeZone,
              })
            })
            const sourceCost = estimateGmailSourceFetchCost(refs.length)
            consumeBudget(budget, sourceCost, `collect gmail ${source.id}`, jobId, {
              refs: refs.length,
            })
            if (refs.length > 0) {
              candidatesSnapshot.gmailMessages.push(...refs)
            }
          }
          else {
            candidatesSnapshot.stories.push({
              id: source.id,
              title: source.name,
              url: source.url,
              sourceName: source.name,
              sourceUrl: source.url,
            })
          }
          workflowState.cursor.sourceIndex = sourceIndex + 1
          workflowState.progress.sourcesProcessed = workflowState.cursor.sourceIndex
        }

        await saveCandidatesSnapshot(candidatesSnapshot)
        workflowState.progress.gmailTotal = Math.max(
          workflowState.progress.gmailTotal,
          candidatesSnapshot.gmailMessages.length,
        )
        workflowState.progress.gmailProcessed = workflowState.cursor.gmailIndex
        workflowState.stage = 'expand_gmail'
        workflowState.cursor.gmailIndex = 0
        await saveWorkflowState('stage transition: collect_candidates -> expand_gmail')
        continue
      }

      if (workflowState.stage === 'expand_gmail') {
        const candidatesSnapshot = await loadCandidatesSnapshot()
        workflowState.progress.gmailTotal = Math.max(
          workflowState.progress.gmailTotal,
          candidatesSnapshot.gmailMessages.length,
        )
        for (let gmailIndex = workflowState.cursor.gmailIndex; gmailIndex < candidatesSnapshot.gmailMessages.length; gmailIndex += 1) {
          if (await maybeHandoff(
            'expand_gmail',
            BUDGET_COST.gmailExpand + BUDGET_COST.r2Write + BUDGET_COST.workflowCreate,
            `expand gmail index ${gmailIndex}`,
            { gmailIndex },
          )) {
            return
          }

          const messageRef = candidatesSnapshot.gmailMessages[gmailIndex]
          const expandedStories = await step.do(`expand gmail ${messageRef.id}`, retryConfig, async () => {
            return await processGmailMessage({
              messageId: messageRef.id,
              source: messageRef.source,
              now,
              lookbackDays: messageRef.lookbackDays,
              env: this.env,
              runtimeAi,
              window: {
                start: windowStart,
                end: windowEnd,
                timeZone,
              },
              timeZone,
              archiveLinkKeywords: runtimeConfig.sources.archiveLinkKeywords,
              extractNewsletterLinksPrompt: runtimePrompts.extractNewsletterLinks,
            })
          })
          consumeBudget(budget, BUDGET_COST.gmailExpand, `expand gmail ${messageRef.id}`, jobId)
          if (expandedStories.length > 0) {
            candidatesSnapshot.stories.push(...expandedStories)
          }
          workflowState.cursor.gmailIndex = gmailIndex + 1
          workflowState.progress.gmailProcessed = workflowState.cursor.gmailIndex
        }

        const blockedStories = candidatesSnapshot.stories.filter(story => isBlockedStoryUrl(story.url))
        const candidateStories = candidatesSnapshot.stories.filter(story => !isBlockedStoryUrl(story.url))
        if (blockedStories.length > 0) {
          console.warn('blocked story urls skipped', {
            count: blockedStories.length,
            hosts: Array.from(new Set(blockedStories.map((story) => {
              try {
                return new URL(story.url || '').hostname.toLowerCase()
              }
              catch {
                return ''
              }
            }).filter(Boolean))),
          })
        }

        if (!candidateStories.length) {
          workflowState.status = 'done'
          workflowState.stage = 'done'
          logWorkflowObservation({
            jobId,
            stage: workflowState.stage,
            continuationSeq: workflowState.continuationSeq,
            status: workflowState.status,
            cursor: workflowState.cursor,
            progress: workflowState.progress,
            budget,
            label: 'no candidate stories',
          })
          await saveWorkflowState('no candidate stories, mark done')
          return
        }

        console.info('top stories', isDev ? candidateStories : JSON.stringify(candidateStories))
        console.info(`total stories: ${candidateStories.length}`)

        candidatesSnapshot.stories = candidateStories
        candidatesSnapshot.gmailMessages = []
        await saveCandidatesSnapshot(candidatesSnapshot)
        workflowState.progress.storiesTotal = candidateStories.length
        workflowState.progress.storiesProcessed = workflowState.cursor.storyIndex
        workflowState.progress.storiesRelevant = 0

        if (testStep === 'stories') {
          console.info('workflow test step "stories" completed, stopping before summarization', {
            totalStories: candidateStories.length,
            stories: candidateStories.map(s => ({ id: s.id, title: s.title, url: s.url, sourceName: s.sourceName })),
          })
          workflowState.status = 'done'
          workflowState.stage = 'done'
          await saveWorkflowState('workflow test stories done')
          return
        }

        const storyGroups = new Map<string, { count: number, label: string }>()
        for (const story of candidateStories) {
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

        workflowState.stage = 'summarize_stories'
        workflowState.cursor.storyIndex = 0
        await saveWorkflowState('stage transition: expand_gmail -> summarize_stories')
        continue
      }

      if (workflowState.stage === 'summarize_stories') {
        const candidatesSnapshot = await loadCandidatesSnapshot()
        const summarySnapshot = await loadSummarySnapshot()
        const candidateStories = candidatesSnapshot.stories
        workflowState.progress.storiesTotal = candidateStories.length
        workflowState.progress.storiesProcessed = workflowState.cursor.storyIndex
        workflowState.progress.storiesRelevant = summarySnapshot.keptStories.length
        logWorkflowObservation({
          jobId,
          stage: workflowState.stage,
          continuationSeq: workflowState.continuationSeq,
          status: workflowState.status,
          cursor: workflowState.cursor,
          progress: workflowState.progress,
          budget,
          label: 'summarize snapshot loaded',
          extra: {
            summarySnapshot: {
              candidatesTotal: candidateStories.length,
              summariesTotal: summarySnapshot.allStories.length,
              relevantTotal: summarySnapshot.keptStories.length,
            },
          },
        })

        for (let storyIndex = workflowState.cursor.storyIndex; storyIndex < candidateStories.length; storyIndex += 1) {
          if (await maybeHandoff(
            'summarize_stories',
            BUDGET_COST.storyContent + BUDGET_COST.storySummary + BUDGET_COST.r2Write + BUDGET_COST.workflowCreate,
            `summarize story index ${storyIndex}`,
            { storyIndex },
          )) {
            await saveSummarySnapshot(summarySnapshot)
            return
          }

          const story = candidateStories[storyIndex]
          const storyId = story.id || `story-${storyIndex + 1}`
          let storyResponse = ''
          try {
            storyResponse = await step.do(`get story ${storyId}: ${story.title}`, retryConfig, async () => {
              return await getStoryContent(story, maxTokens, this.env)
            })
            consumeBudget(budget, BUDGET_COST.storyContent, `get story ${storyId}`, jobId)
          }
          catch (error) {
            console.warn(`get story ${storyId} content failed, skip story`, {
              title: story.title,
              error: formatError(error),
            })
            workflowState.cursor.storyIndex = storyIndex + 1
            workflowState.progress.storiesProcessed = workflowState.cursor.storyIndex
            await step.sleep('Give AI a break', breakTime)
            continue
          }

          if (!storyResponse.trim()) {
            console.warn(`get story ${storyId} content empty, skip`, {
              title: story.title,
            })
            workflowState.cursor.storyIndex = storyIndex + 1
            workflowState.progress.storiesProcessed = workflowState.cursor.storyIndex
            await step.sleep('Give AI a break', breakTime)
            continue
          }

          await step.sleep('reset quota before summarize', breakTime)
          let summaryResult: StorySummaryResult | null = null
          try {
            summaryResult = await step.do(`summarize story ${storyId}: ${story.title}`, { ...retryConfig, retries: withRetryLimit(2) }, async () => {
              const { result, usage, finishReason } = await summarizeStoryWithRelevance({
                env: this.env,
                runtimeAi,
                model: primaryModel,
                instructions: runtimePrompts.summarizeStory,
                input: storyResponse,
                maxOutputTokens: maxTokens,
              })
              console.info(`get story ${storyId} summary success`, {
                relevant: result.relevant,
                reason: result.reason,
                summaryLength: result.summary?.length || 0,
                usage,
                finishReason,
              })
              return result
            })
            consumeBudget(budget, BUDGET_COST.storySummary, `summarize story ${storyId}`, jobId)
          }
          catch (error) {
            console.warn(`get story ${storyId} summary failed after retries`, {
              title: story.title,
              error: formatError(error),
            })
          }

          if (!summaryResult || !summaryResult.relevant) {
            workflowState.cursor.storyIndex = storyIndex + 1
            workflowState.progress.storiesProcessed = workflowState.cursor.storyIndex
            await step.sleep('Give AI a break', breakTime)
            continue
          }

          const summaryText = summaryResult.summary?.trim()
          if (!summaryText) {
            workflowState.cursor.storyIndex = storyIndex + 1
            workflowState.progress.storiesProcessed = workflowState.cursor.storyIndex
            await step.sleep('Give AI a break', breakTime)
            continue
          }

          summarySnapshot.allStories.push(`<story>${summaryText}</story>`)
          summarySnapshot.keptStories.push(story)
          workflowState.cursor.storyIndex = storyIndex + 1
          workflowState.progress.storiesProcessed = workflowState.cursor.storyIndex
          workflowState.progress.storiesRelevant = summarySnapshot.keptStories.length
          await step.sleep('Give AI a break', breakTime)
        }

        await saveSummarySnapshot(summarySnapshot)
        workflowState.progress.storiesRelevant = summarySnapshot.keptStories.length
        logWorkflowObservation({
          jobId,
          stage: workflowState.stage,
          continuationSeq: workflowState.continuationSeq,
          status: workflowState.status,
          cursor: workflowState.cursor,
          progress: workflowState.progress,
          budget,
          label: 'summarize snapshot persisted',
          extra: {
            summarySnapshot: {
              candidatesTotal: candidateStories.length,
              summariesTotal: summarySnapshot.allStories.length,
              relevantTotal: summarySnapshot.keptStories.length,
            },
          },
        })
        if (!summarySnapshot.keptStories.length) {
          workflowState.status = 'done'
          workflowState.stage = 'done'
          logWorkflowObservation({
            jobId,
            stage: workflowState.stage,
            continuationSeq: workflowState.continuationSeq,
            status: workflowState.status,
            cursor: workflowState.cursor,
            progress: workflowState.progress,
            budget,
            label: 'no relevant stories after summarize',
          })
          await saveWorkflowState('no relevant stories after summarize')
          return
        }

        workflowState.stage = 'compose_text'
        await saveWorkflowState('stage transition: summarize_stories -> compose_text')
        continue
      }

      if (workflowState.stage === 'compose_text') {
        if (await maybeHandoff(
          'compose_text',
          BUDGET_COST.llmCompose * 4 + BUDGET_COST.kvWrite + BUDGET_COST.r2Write + BUDGET_COST.workflowCreate,
          'compose text stage needs fresh budget',
        )) {
          return
        }

        const summarySnapshot = await loadSummarySnapshot()
        const keptStories = summarySnapshot.keptStories
        const allStories = summarySnapshot.allStories
        workflowState.progress.storiesRelevant = keptStories.length
        const composeStepsTotal = 4
        const logComposeStep = (
          stepIndex: number,
          stepName: string,
          phase: 'start' | 'done',
          extra?: Record<string, unknown>,
        ) => {
          logWorkflowObservation({
            jobId,
            stage: workflowState.stage,
            continuationSeq: workflowState.continuationSeq,
            status: workflowState.status,
            cursor: workflowState.cursor,
            progress: workflowState.progress,
            budget,
            label: `compose ${phase}: ${stepName}`,
            extra: {
              composeStep: {
                current: stepIndex,
                total: composeStepsTotal,
                name: stepName,
                phase,
              },
              ...(extra || {}),
            },
          })
        }
        logComposeStep(0, 'prepare summary input', 'done', {
          summarySnapshot: {
            summariesTotal: allStories.length,
            relevantTotal: keptStories.length,
          },
        })
        if (!keptStories.length || !allStories.length) {
          workflowState.status = 'done'
          workflowState.stage = 'done'
          logWorkflowObservation({
            jobId,
            stage: workflowState.stage,
            continuationSeq: workflowState.continuationSeq,
            status: workflowState.status,
            cursor: workflowState.cursor,
            progress: workflowState.progress,
            budget,
            label: 'compose skipped due to empty summary snapshot',
          })
          await saveWorkflowState('summary snapshot empty before compose')
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

        logComposeStep(1, 'podcast content', 'start', {
          inputStories: allStories.length,
        })
        const podcastContent = await step.do('create podcast content', { ...retryConfig, retries: withRetryLimit(3) }, async () => {
          const attemptInputs: { label: string, stories: string[] }[] = [
            { label: 'all', stories: allStories },
          ]
          if (allStories.length > 6) {
            attemptInputs.push({ label: 'first-6', stories: allStories.slice(0, 6) })
          }

          for (const attempt of attemptInputs) {
            const input = attempt.stories.join('\n\n---\n\n')
            try {
              const { text } = await createResponseText({
                env: this.env,
                runtimeAi,
                model: thinkingModel,
                instructions: runtimePrompts.summarizePodcast,
                input,
                maxOutputTokens: maxTokens,
              })
              return text
            }
            catch (error) {
              if (isSubrequestLimitError(error))
                throw error
            }
          }
          return ''
        })
        consumeBudget(budget, BUDGET_COST.llmCompose, 'create podcast content', jobId)
        logComposeStep(1, 'podcast content', 'done', {
          outputChars: podcastContent.length,
        })
        if (!podcastContent) {
          workflowState.status = 'done'
          workflowState.stage = 'done'
          logWorkflowObservation({
            jobId,
            stage: workflowState.stage,
            continuationSeq: workflowState.continuationSeq,
            status: workflowState.status,
            cursor: workflowState.cursor,
            progress: workflowState.progress,
            budget,
            label: 'podcast content empty',
          })
          await saveWorkflowState('podcast content empty')
          return
        }

        await step.sleep('Give AI a break', breakTime)

        logComposeStep(2, 'blog content', 'start', {
          inputStories: allStories.length,
        })
        const blogContent = await step.do('create blog content', { ...retryConfig, retries: withRetryLimit(3) }, async () => {
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
            try {
              const { text } = await createResponseText({
                env: this.env,
                runtimeAi,
                model: thinkingModel,
                instructions: runtimePrompts.summarizeBlog,
                input,
                maxOutputTokens: maxTokens,
              })
              return text
            }
            catch (error) {
              if (isSubrequestLimitError(error))
                throw error
            }
          }
          return ''
        })
        consumeBudget(budget, BUDGET_COST.llmCompose, 'create blog content', jobId)
        logComposeStep(2, 'blog content', 'done', {
          outputChars: blogContent.length,
        })
        if (!blogContent) {
          workflowState.status = 'done'
          workflowState.stage = 'done'
          logWorkflowObservation({
            jobId,
            stage: workflowState.stage,
            continuationSeq: workflowState.continuationSeq,
            status: workflowState.status,
            cursor: workflowState.cursor,
            progress: workflowState.progress,
            budget,
            label: 'blog content empty',
          })
          await saveWorkflowState('blog content empty')
          return
        }

        logComposeStep(3, 'intro content', 'start')
        const introContent = await step.do('create intro content', retryConfig, async () => {
          const { text } = await createResponseText({
            env: this.env,
            runtimeAi,
            model: primaryModel,
            instructions: runtimePrompts.intro,
            input: podcastContent,
          })
          return text
        })
        consumeBudget(budget, BUDGET_COST.llmCompose, 'create intro content', jobId)
        logComposeStep(3, 'intro content', 'done', {
          outputChars: introContent.length,
        })

        logComposeStep(4, 'episode title', 'start')
        const episodeTitle = await step.do('generate episode title', retryConfig, async () => {
          const { text } = await createResponseText({
            env: this.env,
            runtimeAi,
            model: primaryModel,
            instructions: runtimePrompts.title,
            input: podcastContent,
          })
          const parsedTitle = extractEpisodeTitle(text)
          return parsedTitle || `${runtimeConfig.site.title} ${workflowState.publishDateKey}`
        })
        consumeBudget(budget, BUDGET_COST.llmCompose, 'generate episode title', jobId)
        logComposeStep(4, 'episode title', 'done', {
          title: episodeTitle,
        })

        const contentKey = buildContentKey(runEnv, workflowState.publishDateKey)
        const podcastKeyBase = buildPodcastKeyBase(runEnv, workflowState.publishDateKey)
        const podcastKey = `${podcastKeyBase}.mp3`
        const ttsInputOverride = ttsTestInputOverride.trim()
        const ttsSourceText = ttsInputOverride || podcastContent
        const conversations = ttsSourceText
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
        const parsedConversations = parseConversationLines(conversations, speakerMarkers)
        if (!skipTTS && parsedConversations.length === 0) {
          throw new Error('No valid TTS dialog lines found. Please ensure each line starts with configured speaker markers.')
        }

        await step.do('save content to kv', retryConfig, async () => {
          const updatedAt = Date.now()
          await this.env.PODCAST_KV.put(contentKey, JSON.stringify({
            date: workflowState.publishDateKey,
            publishedAt: workflowState.publishedAt,
            title: episodeTitle,
            stories: keptStories,
            podcastContent,
            blogContent,
            introContent,
            audio: '',
            updatedAt,
            configVersion: runtimeState.version,
            updatedBy: 'workflow',
          }))
          return true
        })
        consumeBudget(budget, BUDGET_COST.kvWrite, 'save content to kv', jobId)

        await saveComposeSnapshot({
          stories: keptStories,
          podcastContent,
          blogContent,
          introContent,
          episodeTitle,
          parsedConversations,
          contentKey,
          podcastKey,
          ttsSettings: runtimeTtsSettings,
          ffmpegAudioQuality,
          introThemeUrl,
          introMusicConfig: runtimeConfig.tts.introMusic,
          isDev,
        })
        workflowState.contentKey = contentKey
        workflowState.podcastKey = podcastKey
        workflowState.progress.storiesRelevant = keptStories.length
        workflowState.progress.ttsTotal = parsedConversations.length
        workflowState.progress.ttsProcessed = workflowState.cursor.ttsLineIndex
        logWorkflowObservation({
          jobId,
          stage: workflowState.stage,
          continuationSeq: workflowState.continuationSeq,
          status: workflowState.status,
          cursor: workflowState.cursor,
          progress: workflowState.progress,
          budget,
          label: 'compose stage complete',
          extra: {
            summarySnapshot: {
              summariesTotal: allStories.length,
              relevantTotal: keptStories.length,
            },
            content: {
              title: episodeTitle,
              contentKey,
              podcastKey,
            },
          },
        })

        if (skipTTS) {
          workflowState.status = 'done'
          workflowState.stage = 'done'
          logWorkflowObservation({
            jobId,
            stage: workflowState.stage,
            continuationSeq: workflowState.continuationSeq,
            status: workflowState.status,
            cursor: workflowState.cursor,
            progress: workflowState.progress,
            budget,
            label: 'skip TTS complete',
          })
          await saveWorkflowState('skip TTS, mark done')
          return
        }

        workflowState.stage = 'tts_render'
        workflowState.cursor.ttsLineIndex = 0
        await saveWorkflowState('stage transition: compose_text -> tts_render')
        continue
      }

      if (workflowState.stage === 'tts_render') {
        const composeSnapshot = await loadComposeSnapshot()
        if (!composeSnapshot) {
          throw new Error(`compose snapshot missing for job ${jobId}`)
        }
        workflowState.progress.ttsTotal = composeSnapshot.parsedConversations.length
        workflowState.progress.ttsProcessed = workflowState.cursor.ttsLineIndex

        const provider = workflowState.provider || validateTtsConfig(this.env, composeSnapshot.ttsSettings.provider)
        workflowState.provider = provider
        const tmpPrefix = `tmp/${jobId}`
        const geminiWavKey = `${tmpPrefix}/podcast.wav`
        const basePodcastKey = `${tmpPrefix}/podcast.base.mp3`
        let basePodcastUrl = ''

        if (provider === 'gemini') {
          if (await maybeHandoff(
            'tts_render',
            BUDGET_COST.ttsLine + BUDGET_COST.audioMerge + BUDGET_COST.introMusic + BUDGET_COST.kvWrite + BUDGET_COST.workflowCreate,
            'gemini tts stage requires fresh budget',
          )) {
            return
          }

          const dialogLines = composeSnapshot.parsedConversations.map(item => item.raw)
          const geminiPrompt = buildGeminiTtsPrompt(dialogLines, {
            geminiPrompt: composeSnapshot.ttsSettings.geminiPrompt,
            geminiSpeakers: composeSnapshot.ttsSettings.geminiSpeakers,
          })

          const geminiAudioUrl = await step.do('create gemini podcast audio', { ...retryConfig, retries: withRetryLimit(2), timeout: '10 minutes' }, async () => {
            const result = await synthesizeGeminiTTS(geminiPrompt, this.env, {
              model: composeSnapshot.ttsSettings.model,
              apiUrl: composeSnapshot.ttsSettings.apiUrl,
              geminiSpeakers: composeSnapshot.ttsSettings.geminiSpeakers,
            })
            if (!result.audio.size) {
              throw new Error('podcast audio size is 0')
            }
            await this.env.PODCAST_R2.put(geminiWavKey, result.audio)
            return `${this.env.PODCAST_R2_BUCKET_URL}/${geminiWavKey}?t=${Date.now()}`
          })
          consumeBudget(budget, BUDGET_COST.ttsLine, 'gemini tts render', jobId)
          workflowState.progress.ttsProcessed = composeSnapshot.parsedConversations.length

          basePodcastUrl = await step.do('convert gemini audio to mp3', { ...retryConfig, retries: withRetryLimit(3) }, async () => {
            if (!this.env.BROWSER) {
              throw new Error('BROWSER binding is required for audio convert')
            }
            const blob = await concatAudioFiles([geminiAudioUrl], this.env.BROWSER, {
              workerUrl: this.env.PODCAST_WORKER_URL,
              audioQuality: composeSnapshot.ffmpegAudioQuality,
            })
            await this.env.PODCAST_R2.put(basePodcastKey, blob)
            return `${this.env.PODCAST_R2_BUCKET_URL}/${basePodcastKey}?t=${Date.now()}`
          })
          consumeBudget(budget, BUDGET_COST.audioMerge, 'convert gemini audio', jobId)
        }
        else {
          for (let index = workflowState.cursor.ttsLineIndex; index < composeSnapshot.parsedConversations.length; index += 1) {
            if (await maybeHandoff(
              'tts_render',
              BUDGET_COST.ttsLine + BUDGET_COST.workflowCreate,
              `render tts line ${index}`,
              { ttsLineIndex: index },
            )) {
              return
            }

            const conversation = composeSnapshot.parsedConversations[index]
            await step.do(
              `create audio ${index}`,
              { ...retryConfig, retries: withRetryLimit(0), timeout: '30 minutes' },
              async () => {
                const audio = await synthesize(conversation.text, conversation.speaker, this.env, {
                  provider: composeSnapshot.ttsSettings.provider,
                  language: composeSnapshot.ttsSettings.language,
                  languageBoost: composeSnapshot.ttsSettings.languageBoost,
                  model: composeSnapshot.ttsSettings.model,
                  speed: composeSnapshot.ttsSettings.speed,
                  apiUrl: composeSnapshot.ttsSettings.apiUrl,
                  voicesBySpeaker: composeSnapshot.ttsSettings.voicesBySpeaker,
                })
                if (!audio.size) {
                  throw new Error('podcast audio size is 0')
                }
                const audioKey = `${tmpPrefix}/podcast-${index}.mp3`
                await this.env.PODCAST_R2.put(audioKey, audio)
                return audioKey
              },
            )
            consumeBudget(budget, BUDGET_COST.ttsLine, `render tts line ${index}`, jobId)
            workflowState.cursor.ttsLineIndex = index + 1
            workflowState.progress.ttsProcessed = workflowState.cursor.ttsLineIndex
            const hasMoreLines = index < composeSnapshot.parsedConversations.length - 1
            if (hasMoreLines) {
              await step.sleep(
                `yield between TTS lines after line ${index}`,
                NON_GEMINI_TTS_LINE_SLEEP,
              )
            }
          }

          if (await maybeHandoff(
            'tts_render',
            BUDGET_COST.audioMerge + BUDGET_COST.introMusic + BUDGET_COST.kvWrite + BUDGET_COST.workflowCreate,
            'tts post process needs fresh budget',
            { ttsLineIndex: composeSnapshot.parsedConversations.length },
          )) {
            return
          }

          basePodcastUrl = await step.do('concat audio files', retryConfig, async () => {
            if (!this.env.BROWSER) {
              throw new Error('BROWSER binding is required for concat audio files')
            }
            const audioFiles = composeSnapshot.parsedConversations.map((_, index) => {
              return `${this.env.PODCAST_R2_BUCKET_URL}/${tmpPrefix}/podcast-${index}.mp3?t=${Date.now()}`
            })
            const blob = await concatAudioFiles(audioFiles, this.env.BROWSER, {
              workerUrl: this.env.PODCAST_WORKER_URL,
              audioQuality: composeSnapshot.ffmpegAudioQuality,
            })
            await this.env.PODCAST_R2.put(basePodcastKey, blob)
            return `${this.env.PODCAST_R2_BUCKET_URL}/${basePodcastKey}?t=${Date.now()}`
          })
          consumeBudget(budget, BUDGET_COST.audioMerge, 'concat audio files', jobId)
        }

        await step.sleep('reset quota before intro music', '30 seconds')
        try {
          await step.do('add intro music', retryConfig, async () => {
            if (!this.env.BROWSER) {
              throw new Error('BROWSER binding is required for intro music')
            }
            const blob = await addIntroMusic(basePodcastUrl, this.env.BROWSER, {
              workerUrl: this.env.PODCAST_WORKER_URL,
              themeUrl: composeSnapshot.introThemeUrl,
              fadeOutStart: composeSnapshot.introMusicConfig.fadeOutStart,
              fadeOutDuration: composeSnapshot.introMusicConfig.fadeOutDuration,
              podcastDelayMs: composeSnapshot.introMusicConfig.podcastDelay,
              audioQuality: composeSnapshot.ffmpegAudioQuality,
            })
            await this.env.PODCAST_R2.put(composeSnapshot.podcastKey, blob)
            return composeSnapshot.podcastKey
          })
        }
        catch (error) {
          console.warn('add intro music failed after retries, fallback to base', {
            error: formatError(error),
          })
          await step.do('fallback: copy base podcast', retryConfig, async () => {
            const baseObj = await this.env.PODCAST_R2.get(basePodcastKey)
            if (!baseObj) {
              throw new Error('Base podcast object not found for fallback')
            }
            await this.env.PODCAST_R2.put(composeSnapshot.podcastKey, baseObj.body)
            return composeSnapshot.podcastKey
          })
        }
        consumeBudget(budget, BUDGET_COST.introMusic, 'add intro music', jobId)

        await step.do('update content audio in kv', retryConfig, async () => {
          const current = await this.env.PODCAST_KV.get(composeSnapshot.contentKey, 'json')
          if (!current || typeof current !== 'object') {
            throw new Error(`content not found for key: ${composeSnapshot.contentKey}`)
          }
          const existing = current as Record<string, unknown>
          await this.env.PODCAST_KV.put(composeSnapshot.contentKey, JSON.stringify({
            ...existing,
            audio: composeSnapshot.podcastKey,
            updatedAt: Date.now(),
            updatedBy: 'workflow-inline-tts',
          }))
          return composeSnapshot.contentKey
        })
        consumeBudget(budget, BUDGET_COST.kvWrite, 'update content audio in kv', jobId)
        const podcastUrl = `${this.env.PODCAST_R2_BUCKET_URL}/${composeSnapshot.podcastKey}`
        console.info('podcast audio ready', {
          jobId,
          podcastKey: composeSnapshot.podcastKey,
          podcastUrl,
        })

        await step.do('clean up temporary data', retryConfig, async () => {
          const deleting: Array<Promise<unknown>> = [
            this.env.PODCAST_R2.delete(basePodcastKey).catch(() => {}),
            this.env.PODCAST_R2.delete(geminiWavKey).catch(() => {}),
          ]
          for (let index = 0; index < composeSnapshot.parsedConversations.length; index += 1) {
            deleting.push(this.env.PODCAST_R2.delete(`${tmpPrefix}/podcast-${index}.mp3`).catch(() => {}))
          }
          await Promise.all(deleting)
          return true
        })

        workflowState.status = 'done'
        workflowState.stage = 'done'
        logWorkflowObservation({
          jobId,
          stage: workflowState.stage,
          continuationSeq: workflowState.continuationSeq,
          status: workflowState.status,
          cursor: workflowState.cursor,
          progress: workflowState.progress,
          budget,
          label: 'tts render complete',
          extra: {
            contentKey: composeSnapshot.contentKey,
            podcastKey: composeSnapshot.podcastKey,
            podcastUrl,
          },
        })
        await saveWorkflowState('tts_render completed, mark done')
        return
      }
    }
  }
}
