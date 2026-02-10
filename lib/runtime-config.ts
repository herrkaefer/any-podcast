import type {
  RuntimeConfigBundle,
  RuntimeConfigState,
} from '@/types/runtime-config'

import { externalLinks, keepDays, podcast, podcastContactEmail, podcastId, site } from '@/config'
import {
  extractNewsletterLinksPrompt,
  introPrompt,
  summarizeBlogPrompt,
  summarizePodcastPrompt,
  summarizeStoryPrompt,
  titlePrompt,
} from '@/workflow/prompt'
import { loadSourceConfig } from '@/workflow/sources/config'
import {
  runtimeConfigBundleSchema,
  runtimeConfigPatchSchema,
} from './schemas/admin'

interface RuntimeConfigEnv {
  PODCAST_KV: KVNamespace
}

const DEFAULT_NEWSLETTER_HOSTS = ['kill-the-newsletter.com']
const DEFAULT_ARCHIVE_LINK_KEYWORDS = [
  'in your browser',
  'in a browser',
  'in browser',
]

const DEFAULT_RSS_CATEGORIES = ['Health & Fitness', 'Education']
const WORKFLOW_TEST_STEPS = new Set([
  '',
  'openai',
  'responses',
  'tts',
  'tts-intro',
  'story',
  'podcast',
  'blog',
  'intro',
  'stories',
])
const DEFAULT_TEST_CONFIG: RuntimeConfigBundle['test'] = {
  workflowTestStep: '',
  workflowTestInput: '',
  workflowTestInstructions: '',
  workflowTtsInput: '',
}

export function getRuntimeConfigKeys(podcastIdInput = podcastId) {
  const base = `cfg:podcast:${podcastIdInput}`
  return {
    draft: `${base}:draft`,
  }
}

function getDefaultHosts() {
  const host1 = podcast.hosts[0]
  const host2 = podcast.hosts[1]
  return [
    {
      id: 'host1',
      name: host1?.name || '主持人A',
      speakerMarker: '男',
      gender: 'male' as const,
      persona: '',
      link: host1?.link || '',
    },
    {
      id: 'host2',
      name: host2?.name || '主持人B',
      speakerMarker: '女',
      gender: 'female' as const,
      persona: '',
      link: host2?.link || '',
    },
  ]
}

function getDefaultExternalLinks() {
  const list = [
    ...podcast.platforms.map(platform => ({
      platform: platform.id,
      url: platform.link,
    })),
    ...Object.entries(externalLinks).map(([platform, url]) => ({
      platform,
      url,
    })),
  ]
  const dedupe = new Map<string, { platform: string, url: string }>()
  for (const item of list) {
    const url = item.url.trim()
    if (!url) {
      continue
    }
    dedupe.set(item.platform, {
      platform: item.platform,
      url,
    })
  }
  return Array.from(dedupe.values())
}

function normalizeTestConfig(value: unknown): RuntimeConfigBundle['test'] {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_TEST_CONFIG }
  }

  const input = value as Record<string, unknown>
  const rawStep = typeof input.workflowTestStep === 'string'
    ? input.workflowTestStep.trim().toLowerCase()
    : ''

  return {
    workflowTestStep: WORKFLOW_TEST_STEPS.has(rawStep)
      ? rawStep as RuntimeConfigBundle['test']['workflowTestStep']
      : '',
    workflowTestInput: typeof input.workflowTestInput === 'string' ? input.workflowTestInput : '',
    workflowTestInstructions: typeof input.workflowTestInstructions === 'string' ? input.workflowTestInstructions : '',
    workflowTtsInput: typeof input.workflowTtsInput === 'string' ? input.workflowTtsInput : '',
  }
}

function normalizeTtsConfig(config: RuntimeConfigBundle): RuntimeConfigBundle {
  const hosts = config.hosts.length > 0 ? config.hosts : getDefaultHosts()
  const currentVoices = config.tts.voices || {}
  const hostVoiceDefaults = hosts.map((host, index) => ({
    hostId: host.id,
    defaultVoice: index === 0 ? 'Puck' : 'Zephyr',
  }))

  const voices: Record<string, string> = {}
  for (const item of hostVoiceDefaults) {
    voices[item.hostId] = currentVoices[item.hostId] || item.defaultVoice
  }

  return {
    ...config,
    hosts,
    tts: {
      ...config.tts,
      provider: config.tts.provider || 'gemini',
      language: config.tts.language || 'zh-CN',
      model: config.tts.model || 'gemini-2.5-flash-preview-tts',
      voices,
      geminiPrompt: config.tts.geminiPrompt || '请用中文播报以下播客对话，语气自然、节奏流畅、音量稳定。',
      introMusic: {
        url: config.tts.introMusic.url,
        fadeOutStart: config.tts.introMusic.fadeOutStart,
        fadeOutDuration: config.tts.introMusic.fadeOutDuration,
        podcastDelay: config.tts.introMusic.podcastDelay,
      },
      audioQuality: config.tts.audioQuality,
    },
    test: normalizeTestConfig(config.test),
  }
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => [key, sortObject(nested)])
  return Object.fromEntries(entries)
}

function stableJsonStringify(value: unknown) {
  return JSON.stringify(sortObject(value))
}

async function sha256(input: string) {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildDefaultRuntimeConfig(): Promise<RuntimeConfigBundle> {
  const sourceConfig = await loadSourceConfig()
  const nowIso = new Date().toISOString()
  const hosts = getDefaultHosts()

  const baseConfig: RuntimeConfigBundle = {
    site: {
      title: podcast.base.title,
      description: podcast.base.description,
      coverLogoUrl: podcast.base.cover,
      contactEmail: podcastContactEmail,
      themeColor: site.themeColor,
      pageSize: site.pageSize,
      defaultDescriptionLength: site.defaultDescriptionLength,
      keepDays,
      favicon: site.favicon,
      seo: {
        locale: site.seo.locale,
        defaultImage: site.seo.defaultImage,
      },
      externalLinks: getDefaultExternalLinks(),
      rss: {
        language: 'zh-CN',
        categories: DEFAULT_RSS_CATEGORIES,
        itunesCategories: DEFAULT_RSS_CATEGORIES.map(text => ({ text })),
        feedDays: 30,
        relatedLinksLabel: '相关链接：',
      },
    },
    hosts,
    ai: {
      provider: 'gemini',
      model: 'gemini-2.0-flash',
    },
    tts: {
      provider: 'gemini',
      language: 'zh-CN',
      model: 'gemini-2.5-flash-preview-tts',
      voices: {
        [hosts[0].id]: 'Puck',
        [hosts[1].id]: 'Zephyr',
      },
      geminiPrompt: '请用中文播报以下播客对话，语气自然、节奏流畅、音量稳定。',
      introMusic: {
        url: '/static/theme.mp3',
        fadeOutStart: 19,
        fadeOutDuration: 3,
        podcastDelay: 19000,
      },
      audioQuality: 5,
    },
    locale: {
      language: 'zh',
      timezone: 'America/Chicago',
      dateFormat: 'YYYY-MM-DD',
    },
    sources: {
      lookbackDays: sourceConfig.lookbackDays,
      items: sourceConfig.sources,
      newsletterHosts: DEFAULT_NEWSLETTER_HOSTS,
      archiveLinkKeywords: DEFAULT_ARCHIVE_LINK_KEYWORDS,
    },
    prompts: {
      summarizeStory: summarizeStoryPrompt,
      summarizePodcast: summarizePodcastPrompt,
      summarizeBlog: summarizeBlogPrompt,
      intro: introPrompt,
      title: titlePrompt,
      extractNewsletterLinks: extractNewsletterLinksPrompt,
    },
    test: { ...DEFAULT_TEST_CONFIG },
    meta: {
      podcastId,
      updatedAt: nowIso,
      updatedBy: 'system',
      version: 'latest',
      note: 'Default config from codebase',
      checksum: '',
    },
  }

  const checksum = await sha256(stableJsonStringify({
    ...baseConfig,
    meta: { ...baseConfig.meta, checksum: '' },
  }))
  baseConfig.meta.checksum = checksum
  return runtimeConfigBundleSchema.parse(normalizeTtsConfig(baseConfig))
}

async function readBundle(env: RuntimeConfigEnv, key: string) {
  const json = await env.PODCAST_KV.get(key, 'json')
  if (!json) {
    return null
  }
  const raw = json as Record<string, unknown>
  const rawSite = raw.site && typeof raw.site === 'object'
    ? (raw.site as Record<string, unknown>)
    : null
  const sanitizedSite = rawSite
    ? (() => {
        const { theme: _theme, ...rest } = rawSite
        return rest
      })()
    : raw.site
  const parsed = runtimeConfigBundleSchema.safeParse({
    ...raw,
    site: sanitizedSite,
    test: normalizeTestConfig(raw.test),
  })
  if (!parsed.success) {
    return null
  }
  return parsed.data
}

async function writeBundle(env: RuntimeConfigEnv, key: string, config: RuntimeConfigBundle) {
  await env.PODCAST_KV.put(key, JSON.stringify(config))
}

export async function getDraftRuntimeConfig(env: RuntimeConfigEnv, podcastIdInput = podcastId): Promise<RuntimeConfigBundle> {
  const keys = getRuntimeConfigKeys(podcastIdInput)
  const draft = await readBundle(env, keys.draft)
  if (draft) {
    return normalizeTtsConfig(draft)
  }
  const fallback = await buildDefaultRuntimeConfig()
  await writeBundle(env, keys.draft, fallback)
  return fallback
}

export async function getActiveRuntimeConfig(env: RuntimeConfigEnv, podcastIdInput = podcastId): Promise<RuntimeConfigState> {
  const active = await getDraftRuntimeConfig(env, podcastIdInput)
  return {
    config: active,
    source: 'kv',
    version: active.meta.version,
  }
}

export function mergeRuntimeConfig(current: RuntimeConfigBundle, patch: unknown): RuntimeConfigBundle {
  const parsedPatch = runtimeConfigPatchSchema.parse(patch)

  return runtimeConfigBundleSchema.parse(normalizeTtsConfig({
    ...current,
    hosts: parsedPatch.hosts ?? current.hosts,
    site: parsedPatch.site
      ? {
          ...current.site,
          ...parsedPatch.site,
          seo: parsedPatch.site.seo
            ? { ...current.site.seo, ...parsedPatch.site.seo }
            : current.site.seo,
          rss: parsedPatch.site.rss
            ? { ...current.site.rss, ...parsedPatch.site.rss }
            : current.site.rss,
        }
      : current.site,
    ai: parsedPatch.ai
      ? {
          ...current.ai,
          ...parsedPatch.ai,
        }
      : current.ai,
    tts: parsedPatch.tts
      ? {
          ...current.tts,
          ...parsedPatch.tts,
          introMusic: parsedPatch.tts.introMusic
            ? { ...current.tts.introMusic, ...parsedPatch.tts.introMusic }
            : current.tts.introMusic,
          voices: parsedPatch.tts.voices
            ? { ...current.tts.voices, ...parsedPatch.tts.voices }
            : current.tts.voices,
        }
      : current.tts,
    locale: parsedPatch.locale ? { ...current.locale, ...parsedPatch.locale } : current.locale,
    sources: parsedPatch.sources
      ? {
          ...current.sources,
          ...parsedPatch.sources,
        }
      : current.sources,
    prompts: parsedPatch.prompts ? { ...current.prompts, ...parsedPatch.prompts } : current.prompts,
    test: parsedPatch.test
      ? { ...current.test, ...parsedPatch.test }
      : current.test,
    meta: parsedPatch.meta?.note
      ? { ...current.meta, note: parsedPatch.meta.note }
      : current.meta,
  }))
}

export async function saveDraftRuntimeConfig(
  env: RuntimeConfigEnv,
  config: RuntimeConfigBundle,
  options?: {
    updatedBy?: string
    note?: string
    podcastId?: string
  },
) {
  const podcastIdInput = options?.podcastId || podcastId
  const keys = getRuntimeConfigKeys(podcastIdInput)
  const updatedAt = new Date().toISOString()
  const payload = runtimeConfigBundleSchema.parse(normalizeTtsConfig({
    ...config,
    meta: {
      ...config.meta,
      podcastId: podcastIdInput,
      updatedAt,
      updatedBy: options?.updatedBy || config.meta.updatedBy || 'admin',
      version: 'latest',
      note: options?.note ?? config.meta.note,
      checksum: config.meta.checksum || 'pending',
    },
  }))

  const checksum = await sha256(stableJsonStringify({
    ...payload,
    meta: { ...payload.meta, checksum: '' },
  }))
  payload.meta.checksum = checksum
  await writeBundle(env, keys.draft, payload)
  return payload
}
