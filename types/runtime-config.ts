import type { SourceConfig } from '@/workflow/sources/types'

export type RuntimeThemeColor
  = | 'blue'
    | 'pink'
    | 'purple'
    | 'green'
    | 'yellow'
    | 'orange'
    | 'red'

export interface RuntimeExternalLink {
  platform: string
  url: string
  icon?: string
}

export interface RuntimeRssCategory {
  text: string
  subcategory?: string
}

export interface RuntimeRssConfig {
  language: string
  categories: string[]
  itunesCategories: RuntimeRssCategory[]
  feedDays: number
  relatedLinksLabel: string
}

export interface RuntimeSeoConfig {
  locale: string
  defaultImage: string
}

export interface RuntimeSiteConfig {
  title: string
  description: string
  coverLogoUrl: string
  contactEmail: string
  themeColor: RuntimeThemeColor
  pageSize: number
  defaultDescriptionLength: number
  keepDays: number
  favicon: string
  seo: RuntimeSeoConfig
  externalLinks: RuntimeExternalLink[]
  rss: RuntimeRssConfig
}

export interface RuntimeHostConfig {
  id: string
  name: string
  speakerMarker: string
  gender?: 'male' | 'female'
  persona?: string
  link?: string
}

export interface RuntimeTtsIntroMusicConfig {
  url?: string
  fadeOutStart: number
  fadeOutDuration: number
  podcastDelay: number
}

export interface RuntimeTtsConfig {
  provider: 'edge' | 'minimax' | 'murf' | 'gemini'
  language: string
  model?: string
  voices: Record<string, string>
  speed?: string | number
  geminiPrompt?: string
  introMusic: RuntimeTtsIntroMusicConfig
  audioQuality?: number
}

export interface RuntimeLocaleConfig {
  language: string
  timezone: string
  dateFormat?: string
}

export interface RuntimeSourcesConfig {
  lookbackDays: number
  items: SourceConfig[]
  newsletterHosts: string[]
  archiveLinkKeywords: string[]
}

export interface RuntimePromptsConfig {
  summarizeStory: string
  summarizePodcast: string
  summarizeBlog: string
  intro: string
  title: string
  extractNewsletterLinks: string
}

export interface RuntimeConfigMeta {
  podcastId: string
  updatedAt: string
  updatedBy: string
  version: string
  note: string
  checksum: string
}

export interface RuntimeConfigBundle {
  site: RuntimeSiteConfig
  hosts: RuntimeHostConfig[]
  tts: RuntimeTtsConfig
  locale: RuntimeLocaleConfig
  sources: RuntimeSourcesConfig
  prompts: RuntimePromptsConfig
  meta: RuntimeConfigMeta
}

export interface RuntimeConfigState {
  config: RuntimeConfigBundle
  source: 'kv' | 'default'
  version: string
}

export interface AdminSession {
  sid: string
  user: string
  createdAt: string
  expiresAt: string
}
