import { z } from 'zod'

const themeColorSchema = z.enum(['blue', 'pink', 'purple', 'green', 'yellow', 'orange', 'red'])

const linkRulesSchema = z.object({
  excludeText: z.array(z.string()).optional(),
  includeDomains: z.array(z.string()).optional(),
  excludeDomains: z.array(z.string()).optional(),
  includePathKeywords: z.array(z.string()).optional(),
  excludePathKeywords: z.array(z.string()).optional(),
  minArticleScore: z.number().optional(),
  minTextLength: z.number().optional(),
  debug: z.boolean().optional(),
  debugMaxLinks: z.number().int().optional(),
  resolveTrackingLinks: z.boolean().optional(),
  preferOnlineVersion: z.boolean().optional(),
}).strict()

const sourceTypeSchema = z.enum(['rss', 'url', 'gmail'])

const sourceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: sourceTypeSchema,
  url: z.string().min(1),
  enabled: z.boolean().optional(),
  lookbackDays: z.number().int().positive().optional(),
  label: z.string().optional(),
  maxMessages: z.number().int().positive().optional(),
  linkRules: linkRulesSchema.optional(),
}).strict()

const siteSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  coverLogoUrl: z.string().min(1),
  contactEmail: z.string().min(1),
  themeColor: themeColorSchema,
  pageSize: z.number().int().positive(),
  defaultDescriptionLength: z.number().int().positive(),
  keepDays: z.number().int().positive(),
  favicon: z.string().min(1),
  seo: z.object({
    locale: z.string().min(1),
    defaultImage: z.string().min(1),
  }).strict(),
  externalLinks: z.array(z.object({
    platform: z.string().min(1),
    url: z.string().min(1),
    icon: z.string().optional(),
  }).strict()),
  rss: z.object({
    language: z.string().min(1),
    categories: z.array(z.string().min(1)),
    itunesCategories: z.array(z.object({
      text: z.string().min(1),
      subcategory: z.string().optional(),
    }).strict()),
    feedDays: z.number().int().positive(),
    relatedLinksLabel: z.string().min(1),
  }).strict(),
}).strict()

const editableSitePatchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  coverLogoUrl: z.string().min(1).optional(),
  contactEmail: z.string().min(1).optional(),
  themeColor: themeColorSchema.optional(),
  pageSize: z.number().int().positive().optional(),
  defaultDescriptionLength: z.number().int().positive().optional(),
  keepDays: z.number().int().positive().optional(),
  favicon: z.string().min(1).optional(),
  externalLinks: z.array(z.object({
    platform: z.string().min(1),
    url: z.string().min(1),
    icon: z.string().optional(),
  }).strict()).optional(),
  seo: z.object({
    locale: z.string().min(1).optional(),
    defaultImage: z.string().min(1).optional(),
  }).strict().optional(),
  rss: z.object({
    language: z.string().min(1).optional(),
    categories: z.array(z.string().min(1)).optional(),
    itunesCategories: z.array(z.object({
      text: z.string().min(1),
      subcategory: z.string().optional(),
    }).strict()).optional(),
    feedDays: z.number().int().positive().optional(),
    relatedLinksLabel: z.string().min(1).optional(),
  }).strict().optional(),
}).strict()

const hostSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  speakerMarker: z.string().min(1),
  gender: z.enum(['male', 'female']).optional(),
  persona: z.string().optional(),
  link: z.string().optional(),
}).strict()

const aiSchema = z.object({
  provider: z.enum(['openai', 'gemini']),
  model: z.string().min(1),
  thinkingModel: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  baseUrl: z.string().optional(),
}).strict()

const editableAiPatchSchema = z.object({
  provider: z.enum(['openai', 'gemini']).optional(),
  model: z.string().min(1).optional(),
  thinkingModel: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  baseUrl: z.string().optional(),
}).strict()

const ttsSchema = z.object({
  provider: z.enum(['edge', 'minimax', 'murf', 'gemini']),
  language: z.string().min(1),
  languageBoost: z.enum(['auto', 'Chinese', 'English']).optional(),
  model: z.string().optional(),
  voices: z.record(z.string(), z.string()),
  speed: z.union([z.string(), z.number()]).optional(),
  geminiPrompt: z.string().optional(),
  introMusic: z.object({
    url: z.string().optional(),
    fadeOutStart: z.number().nonnegative(),
    fadeOutDuration: z.number().nonnegative(),
    podcastDelay: z.number().nonnegative(),
  }).strict(),
  audioQuality: z.number().optional(),
  skipTts: z.boolean().optional(),
  apiUrl: z.string().optional(),
}).strict()

const editableTtsPatchSchema = z.object({
  provider: z.enum(['edge', 'minimax', 'murf', 'gemini']).optional(),
  language: z.string().min(1).optional(),
  languageBoost: z.enum(['auto', 'Chinese', 'English']).optional(),
  model: z.string().optional(),
  speed: z.union([z.string(), z.number()]).optional(),
  voices: z.record(z.string(), z.string()).optional(),
  geminiPrompt: z.string().optional(),
  introMusic: z.object({
    url: z.string().optional(),
    fadeOutStart: z.number().nonnegative().optional(),
    fadeOutDuration: z.number().nonnegative().optional(),
    podcastDelay: z.number().nonnegative().optional(),
  }).strict().optional(),
  audioQuality: z.number().optional(),
  skipTts: z.boolean().optional(),
  apiUrl: z.string().optional(),
}).strict()

const localeSchema = z.object({
  language: z.string().min(1),
  timezone: z.string().min(1),
  dateFormat: z.string().optional(),
}).strict()

const sourcesSchema = z.object({
  lookbackDays: z.number().int().positive(),
  items: z.array(sourceConfigSchema),
  newsletterHosts: z.array(z.string().min(1)),
  archiveLinkKeywords: z.array(z.string().min(1)),
}).strict()

const promptsSchema = z.object({
  summarizeStory: z.string().min(1),
  summarizePodcast: z.string().min(1),
  summarizeBlog: z.string().min(1),
  intro: z.string().min(1),
  title: z.string().min(1),
  extractNewsletterLinks: z.string().min(1),
}).strict()

const workflowTestStepSchema = z.enum([
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

const testSchema = z.object({
  workflowTestStep: workflowTestStepSchema,
  workflowTestInput: z.string(),
  workflowTestInstructions: z.string(),
  workflowTtsInput: z.string(),
}).strict()

const metaSchema = z.object({
  podcastId: z.string().min(1),
  updatedAt: z.string().min(1),
  updatedBy: z.string().min(1),
  version: z.string().min(1),
  note: z.string(),
  checksum: z.string().min(1),
}).strict()

export const runtimeConfigBundleSchema = z.object({
  site: siteSchema,
  hosts: z.array(hostSchema).min(2),
  ai: aiSchema,
  tts: ttsSchema,
  locale: localeSchema,
  sources: sourcesSchema,
  prompts: promptsSchema,
  test: testSchema,
  meta: metaSchema,
}).strict()

export const runtimeConfigPatchSchema = z.object({
  site: editableSitePatchSchema.optional(),
  hosts: z.array(hostSchema).min(2).optional(),
  ai: editableAiPatchSchema.optional(),
  tts: editableTtsPatchSchema.optional(),
  locale: localeSchema.partial().optional(),
  sources: z.object({
    lookbackDays: z.number().int().positive().optional(),
    items: z.array(sourceConfigSchema).optional(),
    newsletterHosts: z.array(z.string().min(1)).optional(),
    archiveLinkKeywords: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
  prompts: promptsSchema.partial().optional(),
  test: testSchema.partial().optional(),
  meta: z.object({
    note: z.string().optional(),
  }).strict().optional(),
}).strict()

export const adminSessionSchema = z.object({
  sid: z.string().min(1),
  user: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
}).strict()

export const adminLoginSchema = z.object({
  token: z.string().min(1),
}).strict()

export const episodePatchSchema = z.object({
  title: z.string().min(1).optional(),
  publishedAt: z.string().min(1).optional(),
  stories: z.array(z.object({
    id: z.string().min(1).optional(),
    title: z.string().optional(),
    url: z.string().optional(),
    sourceName: z.string().optional(),
    sourceUrl: z.string().optional(),
    publishedAt: z.string().optional(),
    sourceItemId: z.string().optional(),
    sourceItemTitle: z.string().optional(),
  }).strict()).optional(),
  podcastContent: z.string().optional(),
  blogContent: z.string().optional(),
  introContent: z.string().optional(),
  audio: z.string().optional(),
}).strict()

export const workflowTriggerSchema = z.object({
  nowIso: z.string().optional(),
}).strict()
