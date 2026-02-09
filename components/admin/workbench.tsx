'use client'

import type { RuntimeConfigBundle } from '@/types/runtime-config'
import { useMemo, useRef, useState } from 'react'

import { findUnknownTemplateVariables, getTemplateVariables, renderTemplate } from '@/lib/template'

type EditableSection = 'site' | 'hosts' | 'ai' | 'tts' | 'locale' | 'sources' | 'prompts'
type PromptKey = keyof RuntimeConfigBundle['prompts']
type SourceItem = RuntimeConfigBundle['sources']['items'][number]
type SourceLinkRules = NonNullable<SourceItem['linkRules']>

interface PromptMeta {
  label: string
  description: string
}

interface EpisodeListItem {
  date: string
  title: string
  publishedAt?: string
  audio?: string
}

interface EpisodeDetail extends EpisodeListItem {
  podcastContent?: string
  blogContent?: string
  introContent?: string
}

const sections: EditableSection[] = ['site', 'hosts', 'ai', 'tts', 'locale', 'sources', 'prompts']

const sectionLabelMap: Record<EditableSection, string> = {
  site: 'Site',
  hosts: 'Hosts',
  ai: 'AI',
  tts: 'TTS',
  locale: 'Locale',
  sources: 'Sources',
  prompts: 'Prompts',
}

const promptKeys: PromptKey[] = [
  'summarizeStory',
  'summarizePodcast',
  'summarizeBlog',
  'intro',
  'title',
  'extractNewsletterLinks',
]

const promptMetaMap: Record<PromptKey, PromptMeta> = {
  summarizeStory: {
    label: 'Story Summary & Relevance',
    description: 'Summarize a single article and comments, and judge whether it matches the podcast theme.',
  },
  summarizePodcast: {
    label: 'Podcast Dialogue Generation',
    description: 'Combine multiple summaries into a two-host podcast dialogue script.',
  },
  summarizeBlog: {
    label: 'Blog Content Generation',
    description: 'Generate SEO-friendly Markdown blog content.',
  },
  intro: {
    label: 'Episode Description Generation',
    description: 'Generate a short episode description for page display.',
  },
  title: {
    label: 'Title Generation',
    description: 'Generate and suggest episode titles.',
  },
  extractNewsletterLinks: {
    label: 'Newsletter Link Extraction',
    description: 'Extract usable article links from newsletter text.',
  },
}

const themeColorOptions: RuntimeConfigBundle['site']['themeColor'][] = ['blue', 'pink', 'purple', 'green', 'yellow', 'orange', 'red']
const aiProviderOptions: RuntimeConfigBundle['ai']['provider'][] = ['gemini', 'openai']
const ttsProviderOptions: RuntimeConfigBundle['tts']['provider'][] = ['edge', 'minimax', 'murf', 'gemini']
const sourceTypeOptions: SourceItem['type'][] = ['rss', 'url', 'gmail']

function confirmAction(message: string) {
  // eslint-disable-next-line no-alert -- admin confirmation dialog
  return globalThis.confirm(message)
}

function splitMultiline(value: string) {
  return value
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
}

function toMultiline(values: string[] | undefined) {
  return (values || []).join('\n')
}

function parseOptionalInt(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalNumber(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function buildLocalId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function getDefaultHost(index: number): RuntimeConfigBundle['hosts'][number] {
  return {
    id: buildLocalId(`host${index + 1}`),
    name: `Host ${index + 1}`,
    speakerMarker: index % 2 === 0 ? 'A' : 'B',
    gender: index % 2 === 0 ? 'male' : 'female',
    persona: '',
    link: '',
  }
}

function getDefaultSource(): SourceItem {
  return {
    id: buildLocalId('source'),
    name: 'New Source',
    type: 'rss',
    url: 'https://example.com/rss.xml',
    enabled: true,
  }
}

function getSectionPayload(config: RuntimeConfigBundle, section: EditableSection) {
  if (section === 'site')
    return config.site
  if (section === 'hosts')
    return config.hosts
  if (section === 'ai')
    return config.ai
  if (section === 'tts')
    return config.tts
  if (section === 'locale')
    return config.locale
  if (section === 'sources')
    return config.sources
  return config.prompts
}

export function AdminWorkbench({ initialDraft }: { initialDraft: RuntimeConfigBundle }) {
  const [serverDraft, setServerDraft] = useState(initialDraft)
  const [workingDraft, setWorkingDraft] = useState(initialDraft)
  const [section, setSection] = useState<EditableSection>('site')
  const [activePrompt, setActivePrompt] = useState<PromptKey>('summarizeStory')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(false)
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeDetail | null>(null)
  const [episodeBusy, setEpisodeBusy] = useState(false)
  const promptEditorRef = useRef<HTMLTextAreaElement | null>(null)

  const templateVariables = useMemo(() => {
    return getTemplateVariables(workingDraft)
  }, [workingDraft])

  const templateVariableNames = useMemo(() => {
    return Object.keys(templateVariables).sort()
  }, [templateVariables])

  const activePromptTemplate = workingDraft.prompts[activePrompt]

  const activePromptPreview = useMemo(() => {
    return renderTemplate(activePromptTemplate, templateVariables)
  }, [activePromptTemplate, templateVariables])

  const activePromptUnknownVariables = useMemo(() => {
    return findUnknownTemplateVariables(activePromptTemplate, templateVariables)
  }, [activePromptTemplate, templateVariables])

  const extraVoiceEntries = useMemo(() => {
    const hostIds = new Set(workingDraft.hosts.map(host => host.id))
    return Object.entries(workingDraft.tts.voices).filter(([hostId]) => !hostIds.has(hostId))
  }, [workingDraft.hosts, workingDraft.tts.voices])

  function setPromptValue(key: PromptKey, value: string) {
    setWorkingDraft(prev => ({
      ...prev,
      prompts: {
        ...prev.prompts,
        [key]: value,
      },
    }))
  }

  function updateSourceItem(index: number, updater: (item: SourceItem) => SourceItem) {
    setWorkingDraft((prev) => {
      const items = prev.sources.items.map((item, itemIndex) => {
        return itemIndex === index ? updater(item) : item
      })
      return {
        ...prev,
        sources: {
          ...prev.sources,
          items,
        },
      }
    })
  }

  function updateSourceLinkRules(index: number, updater: (rules: SourceLinkRules) => SourceLinkRules) {
    updateSourceItem(index, (item) => {
      const currentRules: SourceLinkRules = item.linkRules ? { ...item.linkRules } : {}
      return {
        ...item,
        linkRules: updater(currentRules),
      }
    })
  }

  async function refreshDraft() {
    const response = await fetch('/api/admin/config/draft')
    const body = (await response.json()) as { draft: RuntimeConfigBundle, error?: string }
    if (!response.ok) {
      throw new Error(body.error || 'Failed to refresh draft')
    }
    setServerDraft(body.draft)
    setWorkingDraft(body.draft)
    return body.draft
  }

  async function saveCurrentSection() {
    setBusy(true)
    setMessage('')
    try {
      const payload = {
        [section]: getSectionPayload(workingDraft, section),
      }
      const response = await fetch('/api/admin/config/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json()) as { draft?: RuntimeConfigBundle, error?: string }
      if (!response.ok || !body.draft) {
        throw new Error(body.error || 'Save failed')
      }
      setServerDraft(body.draft)
      setWorkingDraft(body.draft)
      setMessage(`Saved ${sectionLabelMap[section]}`)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed')
    }
    finally {
      setBusy(false)
    }
  }

  function resetCurrentSection() {
    if (!confirmAction(`Reset unsaved changes in ${sectionLabelMap[section]}?`)) {
      return
    }

    setWorkingDraft((prev) => {
      if (section === 'site') {
        return { ...prev, site: serverDraft.site }
      }
      if (section === 'hosts') {
        return { ...prev, hosts: serverDraft.hosts }
      }
      if (section === 'ai') {
        return { ...prev, ai: serverDraft.ai }
      }
      if (section === 'tts') {
        return { ...prev, tts: serverDraft.tts }
      }
      if (section === 'locale') {
        return { ...prev, locale: serverDraft.locale }
      }
      if (section === 'sources') {
        return { ...prev, sources: serverDraft.sources }
      }
      return { ...prev, prompts: serverDraft.prompts }
    })
  }

  function resetActivePrompt() {
    if (!confirmAction('Reset unsaved changes in the current prompt?')) {
      return
    }
    setPromptValue(activePrompt, serverDraft.prompts[activePrompt])
  }

  function resetAllPrompts() {
    if (!confirmAction('Reset unsaved changes in all prompts?')) {
      return
    }
    setWorkingDraft(prev => ({
      ...prev,
      prompts: serverDraft.prompts,
    }))
  }

  function insertTemplateVariable(name: string) {
    const token = `{{${name}}}`
    const editor = promptEditorRef.current
    const current = workingDraft.prompts[activePrompt]

    if (!editor) {
      setPromptValue(activePrompt, `${current}${token}`)
      return
    }

    const start = editor.selectionStart ?? current.length
    const end = editor.selectionEnd ?? current.length
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`
    const caret = start + token.length

    setPromptValue(activePrompt, next)

    queueMicrotask(() => {
      editor.focus()
      editor.setSelectionRange(caret, caret)
    })
  }

  async function uploadAsset(kind: 'logo' | 'music', file: File) {
    setBusy(true)
    setMessage('')
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(`/api/admin/assets/${kind}`, {
        method: 'POST',
        body: form,
      })
      const body = (await response.json()) as { url?: string, error?: string }
      if (!response.ok || !body.url) {
        throw new Error(body.error || `Failed to upload ${kind}`)
      }
      setMessage(`${kind} uploaded: ${body.url}`)
      await refreshDraft()
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed')
    }
    finally {
      setBusy(false)
    }
  }

  async function loadEpisodes() {
    setLoadingEpisodes(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/episodes?limit=30')
      const body = (await response.json()) as { items?: EpisodeListItem[], error?: string }
      if (!response.ok || !body.items) {
        throw new Error(body.error || 'Failed to load episodes')
      }
      setEpisodes(body.items)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load episodes')
    }
    finally {
      setLoadingEpisodes(false)
    }
  }

  async function openEpisodeEditor(date: string) {
    setEpisodeBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/episodes/${date}`)
      const body = (await response.json()) as { item?: EpisodeDetail, error?: string }
      if (!response.ok || !body.item) {
        throw new Error(body.error || 'Failed to load episode details')
      }
      setSelectedEpisode(body.item)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load episode details')
    }
    finally {
      setEpisodeBusy(false)
    }
  }

  async function saveEpisode() {
    if (!selectedEpisode) {
      return
    }

    setEpisodeBusy(true)
    setMessage('')
    try {
      const payload: Record<string, string> = {
        title: selectedEpisode.title.trim(),
        audio: (selectedEpisode.audio || '').trim(),
      }
      const publishedAt = (selectedEpisode.publishedAt || '').trim()
      if (publishedAt) {
        payload.publishedAt = publishedAt
      }

      const response = await fetch(`/api/admin/episodes/${selectedEpisode.date}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json()) as { ok?: boolean, item?: EpisodeDetail, error?: string }
      if (!response.ok || !body.ok || !body.item) {
        throw new Error(body.error || 'Failed to save episode')
      }
      const nextItem = body.item

      setSelectedEpisode(nextItem)
      setEpisodes(prev => prev.map(item => item.date === nextItem.date
        ? {
            date: nextItem.date,
            title: nextItem.title,
            publishedAt: nextItem.publishedAt,
            audio: nextItem.audio,
          }
        : item))
      setMessage(`Updated ${nextItem.date}`)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save episode')
    }
    finally {
      setEpisodeBusy(false)
    }
  }

  async function deleteEpisode(date: string) {
    if (!confirmAction(`Delete episode ${date}? This action cannot be undone and the audio file will also be deleted.`)) {
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/episodes/${date}`, {
        method: 'DELETE',
      })
      const body = (await response.json()) as { ok?: boolean, error?: string }
      if (!response.ok || !body.ok) {
        throw new Error(body.error || 'Delete failed')
      }
      setEpisodes(prev => prev.filter(item => item.date !== date))
      if (selectedEpisode?.date === date) {
        setSelectedEpisode(null)
      }
      setMessage(`Deleted ${date}`)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'Delete failed')
    }
    finally {
      setBusy(false)
    }
  }

  function renderSiteSection() {
    const site = workingDraft.site
    return (
      <div className="space-y-4">
        <div className={`
          grid gap-4
          md:grid-cols-2
        `}
        >
          <label className="text-sm">
            Site title
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={site.title}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                site: {
                  ...prev.site,
                  title: event.target.value,
                },
              }))}
            />
          </label>

          <label className="text-sm">
            Contact email
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={site.contactEmail}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                site: {
                  ...prev.site,
                  contactEmail: event.target.value,
                },
              }))}
            />
          </label>

          <label className={`
            text-sm
            md:col-span-2
          `}
          >
            Site description
            <textarea
              className="mt-1 min-h-28 w-full rounded border px-3 py-2"
              value={site.description}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                site: {
                  ...prev.site,
                  description: event.target.value,
                },
              }))}
            />
          </label>

          <label className="text-sm">
            Cover logo URL
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={site.coverLogoUrl}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                site: {
                  ...prev.site,
                  coverLogoUrl: event.target.value,
                },
              }))}
            />
          </label>

          <label className="text-sm">
            Favicon URL
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={site.favicon}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                site: {
                  ...prev.site,
                  favicon: event.target.value,
                },
              }))}
            />
          </label>

          <label className="text-sm">
            Theme color
            <select
              className="mt-1 w-full rounded border px-3 py-2"
              value={site.themeColor}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                site: {
                  ...prev.site,
                  themeColor: event.target.value as RuntimeConfigBundle['site']['themeColor'],
                },
              }))}
            >
              {themeColorOptions.map(color => (
                <option key={color} value={color}>{color}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Items per page
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded border px-3 py-2"
              value={site.pageSize}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                site: {
                  ...prev.site,
                  pageSize: Math.max(1, Number(event.target.value || 1)),
                },
              }))}
            />
          </label>

          <label className="text-sm">
            Default summary length
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded border px-3 py-2"
              value={site.defaultDescriptionLength}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                site: {
                  ...prev.site,
                  defaultDescriptionLength: Math.max(1, Number(event.target.value || 1)),
                },
              }))}
            />
          </label>

          <label className="text-sm">
            Retention days
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded border px-3 py-2"
              value={site.keepDays}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                site: {
                  ...prev.site,
                  keepDays: Math.max(1, Number(event.target.value || 1)),
                },
              }))}
            />
          </label>
        </div>

        <div className="space-y-3 rounded border p-3">
          <p className="text-sm font-semibold">SEO</p>
          <div className={`
            grid gap-4
            md:grid-cols-2
          `}
          >
            <label className="text-sm">
              locale
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={site.seo.locale}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  site: {
                    ...prev.site,
                    seo: {
                      ...prev.site.seo,
                      locale: event.target.value,
                    },
                  },
                }))}
              />
            </label>
            <label className="text-sm">
              defaultImage
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={site.seo.defaultImage}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  site: {
                    ...prev.site,
                    seo: {
                      ...prev.site.seo,
                      defaultImage: event.target.value,
                    },
                  },
                }))}
              />
            </label>
          </div>
        </div>

        <div className="space-y-3 rounded border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">External links</p>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              onClick={() => setWorkingDraft(prev => ({
                ...prev,
                site: {
                  ...prev.site,
                  externalLinks: [...prev.site.externalLinks, { platform: '', url: '', icon: '' }],
                },
              }))}
            >
              Add link
            </button>
          </div>

          {site.externalLinks.map((link, index) => (
            <div
              key={`${link.platform}-${link.url}-${link.icon || ''}`}
              className={`
                grid gap-2 rounded border p-2
                md:grid-cols-4
              `}
            >
              <label className="text-xs">
                platform
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={link.platform}
                  onChange={event => setWorkingDraft(prev => ({
                    ...prev,
                    site: {
                      ...prev.site,
                      externalLinks: prev.site.externalLinks.map((item, itemIndex) => {
                        if (itemIndex !== index)
                          return item
                        return { ...item, platform: event.target.value }
                      }),
                    },
                  }))}
                />
              </label>
              <label className={`
                text-xs
                md:col-span-2
              `}
              >
                url
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={link.url}
                  onChange={event => setWorkingDraft(prev => ({
                    ...prev,
                    site: {
                      ...prev.site,
                      externalLinks: prev.site.externalLinks.map((item, itemIndex) => {
                        if (itemIndex !== index)
                          return item
                        return { ...item, url: event.target.value }
                      }),
                    },
                  }))}
                />
              </label>
              <div className="flex items-end gap-2">
                <label className="text-xs">
                  icon
                  <input
                    className="mt-1 w-full rounded border px-2 py-1"
                    value={link.icon || ''}
                    onChange={event => setWorkingDraft(prev => ({
                      ...prev,
                      site: {
                        ...prev.site,
                        externalLinks: prev.site.externalLinks.map((item, itemIndex) => {
                          if (itemIndex !== index)
                            return item
                          return { ...item, icon: event.target.value }
                        }),
                      },
                    }))}
                  />
                </label>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs text-red-700"
                  onClick={() => {
                    if (!confirmAction('Delete this external link?')) {
                      return
                    }
                    setWorkingDraft(prev => ({
                      ...prev,
                      site: {
                        ...prev.site,
                        externalLinks: prev.site.externalLinks.filter((_, itemIndex) => itemIndex !== index),
                      },
                    }))
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 rounded border p-3">
          <p className="text-sm font-semibold">RSS</p>
          <div className={`
            grid gap-4
            md:grid-cols-2
          `}
          >
            <label className="text-sm">
              Language
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={site.rss.language}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  site: {
                    ...prev.site,
                    rss: {
                      ...prev.site.rss,
                      language: event.target.value,
                    },
                  },
                }))}
              />
            </label>
            <label className="text-sm">
              feedDays
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded border px-3 py-2"
                value={site.rss.feedDays}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  site: {
                    ...prev.site,
                    rss: {
                      ...prev.site.rss,
                      feedDays: Math.max(1, Number(event.target.value || 1)),
                    },
                  },
                }))}
              />
            </label>
            <label className={`
              text-sm
              md:col-span-2
            `}
            >
              Related links label
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={site.rss.relatedLinksLabel}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  site: {
                    ...prev.site,
                    rss: {
                      ...prev.site.rss,
                      relatedLinksLabel: event.target.value,
                    },
                  },
                }))}
              />
            </label>

            <label className={`
              text-sm
              md:col-span-2
            `}
            >
              categories (one per line)
              <textarea
                className="mt-1 min-h-20 w-full rounded border px-3 py-2"
                value={toMultiline(site.rss.categories)}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  site: {
                    ...prev.site,
                    rss: {
                      ...prev.site.rss,
                      categories: splitMultiline(event.target.value),
                    },
                  },
                }))}
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">itunesCategories</p>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs"
                onClick={() => setWorkingDraft(prev => ({
                  ...prev,
                  site: {
                    ...prev.site,
                    rss: {
                      ...prev.site.rss,
                      itunesCategories: [...prev.site.rss.itunesCategories, { text: '', subcategory: '' }],
                    },
                  },
                }))}
              >
                Add category
              </button>
            </div>

            {site.rss.itunesCategories.map((item, index) => (
              <div
                key={`${item.text}-${item.subcategory || ''}`}
                className={`
                  grid gap-2 rounded border p-2
                  md:grid-cols-3
                `}
              >
                <label className="text-xs">
                  text
                  <input
                    className="mt-1 w-full rounded border px-2 py-1"
                    value={item.text}
                    onChange={event => setWorkingDraft(prev => ({
                      ...prev,
                      site: {
                        ...prev.site,
                        rss: {
                          ...prev.site.rss,
                          itunesCategories: prev.site.rss.itunesCategories.map((current, itemIndex) => {
                            if (itemIndex !== index)
                              return current
                            return { ...current, text: event.target.value }
                          }),
                        },
                      },
                    }))}
                  />
                </label>
                <label className="text-xs">
                  subcategory
                  <input
                    className="mt-1 w-full rounded border px-2 py-1"
                    value={item.subcategory || ''}
                    onChange={event => setWorkingDraft(prev => ({
                      ...prev,
                      site: {
                        ...prev.site,
                        rss: {
                          ...prev.site.rss,
                          itunesCategories: prev.site.rss.itunesCategories.map((current, itemIndex) => {
                            if (itemIndex !== index)
                              return current
                            return { ...current, subcategory: event.target.value }
                          }),
                        },
                      },
                    }))}
                  />
                </label>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-xs text-red-700"
                    onClick={() => {
                      if (!confirmAction('Delete this iTunes category?')) {
                        return
                      }
                      setWorkingDraft(prev => ({
                        ...prev,
                        site: {
                          ...prev.site,
                          rss: {
                            ...prev.site.rss,
                            itunesCategories: prev.site.rss.itunesCategories.filter((_, itemIndex) => itemIndex !== index),
                          },
                        },
                      }))
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderHostsSection() {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">Keep at least 2 hosts. Unique speakerMarker values are recommended.</p>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={() => setWorkingDraft(prev => ({
              ...prev,
              hosts: [...prev.hosts, getDefaultHost(prev.hosts.length)],
            }))}
          >
            Add host
          </button>
        </div>

        {workingDraft.hosts.map((host, index) => (
          <div key={host.id || index} className="space-y-3 rounded border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                Host
                {index + 1}
              </p>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs text-red-700"
                disabled={workingDraft.hosts.length <= 2}
                onClick={() => {
                  if (workingDraft.hosts.length <= 2) {
                    return
                  }
                  if (!confirmAction('Delete this host?')) {
                    return
                  }
                  setWorkingDraft((prev) => {
                    const removedHost = prev.hosts[index]
                    const nextHosts = prev.hosts.filter((_, itemIndex) => itemIndex !== index)
                    const nextVoices = { ...prev.tts.voices }
                    if (removedHost?.id) {
                      delete nextVoices[removedHost.id]
                    }
                    return {
                      ...prev,
                      hosts: nextHosts,
                      tts: {
                        ...prev.tts,
                        voices: nextVoices,
                      },
                    }
                  })
                }}
              >
                Delete host
              </button>
            </div>

            <div className={`
              grid gap-4
              md:grid-cols-2
            `}
            >
              <label className="text-sm">
                id
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={host.id}
                  onChange={(event) => {
                    const nextId = event.target.value
                    setWorkingDraft((prev) => {
                      const oldHost = prev.hosts[index]
                      const nextHosts = prev.hosts.map((item, itemIndex) => {
                        if (itemIndex !== index)
                          return item
                        return { ...item, id: nextId }
                      })
                      const nextVoices = { ...prev.tts.voices }
                      const oldId = oldHost?.id || ''
                      if (oldId && oldId !== nextId && oldId in nextVoices) {
                        nextVoices[nextId] = nextVoices[oldId]
                        delete nextVoices[oldId]
                      }
                      return {
                        ...prev,
                        hosts: nextHosts,
                        tts: {
                          ...prev.tts,
                          voices: nextVoices,
                        },
                      }
                    })
                  }}
                />
              </label>

              <label className="text-sm">
                name
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={host.name}
                  onChange={event => setWorkingDraft(prev => ({
                    ...prev,
                    hosts: prev.hosts.map((item, itemIndex) => {
                      if (itemIndex !== index)
                        return item
                      return { ...item, name: event.target.value }
                    }),
                  }))}
                />
              </label>

              <label className="text-sm">
                speakerMarker
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={host.speakerMarker}
                  onChange={event => setWorkingDraft(prev => ({
                    ...prev,
                    hosts: prev.hosts.map((item, itemIndex) => {
                      if (itemIndex !== index)
                        return item
                      return { ...item, speakerMarker: event.target.value }
                    }),
                  }))}
                />
              </label>

              <label className="text-sm">
                gender
                <select
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={host.gender || ''}
                  onChange={event => setWorkingDraft(prev => ({
                    ...prev,
                    hosts: prev.hosts.map((item, itemIndex) => {
                      if (itemIndex !== index)
                        return item
                      const gender = event.target.value as RuntimeConfigBundle['hosts'][number]['gender'] | ''
                      return { ...item, gender: gender || undefined }
                    }),
                  }))}
                >
                  <option value="">(Not set)</option>
                  <option value="male">male</option>
                  <option value="female">female</option>
                </select>
              </label>

              <label className={`
                text-sm
                md:col-span-2
              `}
              >
                persona
                <textarea
                  className="mt-1 min-h-20 w-full rounded border px-3 py-2"
                  value={host.persona || ''}
                  onChange={event => setWorkingDraft(prev => ({
                    ...prev,
                    hosts: prev.hosts.map((item, itemIndex) => {
                      if (itemIndex !== index)
                        return item
                      return { ...item, persona: event.target.value }
                    }),
                  }))}
                />
              </label>

              <label className={`
                text-sm
                md:col-span-2
              `}
              >
                link
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={host.link || ''}
                  onChange={event => setWorkingDraft(prev => ({
                    ...prev,
                    hosts: prev.hosts.map((item, itemIndex) => {
                      if (itemIndex !== index)
                        return item
                      return { ...item, link: event.target.value }
                    }),
                  }))}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    )
  }

  function renderAiSection() {
    const ai = workingDraft.ai
    return (
      <div className={`
        grid gap-4
        md:grid-cols-2
      `}
      >
        <label className="text-sm">
          provider
          <select
            className="mt-1 w-full rounded border px-3 py-2"
            value={ai.provider}
            onChange={event => setWorkingDraft(prev => ({
              ...prev,
              ai: {
                ...prev.ai,
                provider: event.target.value as RuntimeConfigBundle['ai']['provider'],
              },
            }))}
          >
            {aiProviderOptions.map(provider => (
              <option key={provider} value={provider}>{provider}</option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          model
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={ai.model}
            onChange={event => setWorkingDraft(prev => ({
              ...prev,
              ai: {
                ...prev.ai,
                model: event.target.value,
              },
            }))}
          />
        </label>

        <label className="text-sm">
          thinkingModel
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={ai.thinkingModel || ''}
            onChange={event => setWorkingDraft(prev => ({
              ...prev,
              ai: {
                ...prev.ai,
                thinkingModel: event.target.value,
              },
            }))}
          />
        </label>

        <label className="text-sm">
          maxTokens
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded border px-3 py-2"
            value={ai.maxTokens ?? ''}
            onChange={event => setWorkingDraft(prev => ({
              ...prev,
              ai: {
                ...prev.ai,
                maxTokens: parseOptionalInt(event.target.value),
              },
            }))}
          />
        </label>

        <label className={`
          text-sm
          md:col-span-2
        `}
        >
          baseUrl
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={ai.baseUrl || ''}
            onChange={event => setWorkingDraft(prev => ({
              ...prev,
              ai: {
                ...prev.ai,
                baseUrl: event.target.value,
              },
            }))}
          />
        </label>
      </div>
    )
  }

  function renderTtsSection() {
    const tts = workingDraft.tts
    return (
      <div className="space-y-4">
        <div className={`
          grid gap-4
          md:grid-cols-2
        `}
        >
          <label className="text-sm">
            provider
            <select
              className="mt-1 w-full rounded border px-3 py-2"
              value={tts.provider}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                tts: {
                  ...prev.tts,
                  provider: event.target.value as RuntimeConfigBundle['tts']['provider'],
                },
              }))}
            >
              {ttsProviderOptions.map(provider => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            language
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={tts.language}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                tts: {
                  ...prev.tts,
                  language: event.target.value,
                },
              }))}
            />
          </label>

          <label className="text-sm">
            model
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={tts.model || ''}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                tts: {
                  ...prev.tts,
                  model: event.target.value,
                },
              }))}
            />
          </label>

          <label className="text-sm">
            speed
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={tts.speed === undefined ? '' : String(tts.speed)}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                tts: {
                  ...prev.tts,
                  speed: event.target.value,
                },
              }))}
            />
          </label>

          <label className="text-sm">
            apiUrl
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={tts.apiUrl || ''}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                tts: {
                  ...prev.tts,
                  apiUrl: event.target.value,
                },
              }))}
            />
          </label>

          <label className="text-sm">
            audioQuality
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded border px-3 py-2"
              value={tts.audioQuality ?? ''}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                tts: {
                  ...prev.tts,
                  audioQuality: parseOptionalNumber(event.target.value),
                },
              }))}
            />
          </label>

          <label className={`
            flex items-center gap-2 text-sm
            md:col-span-2
          `}
          >
            <input
              type="checkbox"
              checked={tts.skipTts === true}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                tts: {
                  ...prev.tts,
                  skipTts: event.target.checked,
                },
              }))}
            />
            <span>skipTts</span>
          </label>

          <label className={`
            text-sm
            md:col-span-2
          `}
          >
            geminiPrompt
            <textarea
              className="mt-1 min-h-24 w-full rounded border px-3 py-2"
              value={tts.geminiPrompt || ''}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                tts: {
                  ...prev.tts,
                  geminiPrompt: event.target.value,
                },
              }))}
            />
          </label>
        </div>

        <div className="space-y-3 rounded border p-3">
          <p className="text-sm font-semibold">introMusic</p>
          <div className={`
            grid gap-4
            md:grid-cols-2
          `}
          >
            <label className={`
              text-sm
              md:col-span-2
            `}
            >
              url
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={tts.introMusic.url || ''}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  tts: {
                    ...prev.tts,
                    introMusic: {
                      ...prev.tts.introMusic,
                      url: event.target.value,
                    },
                  },
                }))}
              />
            </label>
            <label className="text-sm">
              fadeOutStart
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded border px-3 py-2"
                value={tts.introMusic.fadeOutStart}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  tts: {
                    ...prev.tts,
                    introMusic: {
                      ...prev.tts.introMusic,
                      fadeOutStart: Math.max(0, Number(event.target.value || 0)),
                    },
                  },
                }))}
              />
            </label>
            <label className="text-sm">
              fadeOutDuration
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded border px-3 py-2"
                value={tts.introMusic.fadeOutDuration}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  tts: {
                    ...prev.tts,
                    introMusic: {
                      ...prev.tts.introMusic,
                      fadeOutDuration: Math.max(0, Number(event.target.value || 0)),
                    },
                  },
                }))}
              />
            </label>
            <label className="text-sm">
              podcastDelay(ms)
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded border px-3 py-2"
                value={tts.introMusic.podcastDelay}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  tts: {
                    ...prev.tts,
                    introMusic: {
                      ...prev.tts.introMusic,
                      podcastDelay: Math.max(0, Number(event.target.value || 0)),
                    },
                  },
                }))}
              />
            </label>
          </div>
        </div>

        <div className="space-y-3 rounded border p-3">
          <p className="text-sm font-semibold">voices (mapped by host.id)</p>
          {workingDraft.hosts.map(host => (
            <label key={host.id} className="block text-sm">
              {host.id}
              {' '}
              (
              {host.name}
              )
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={tts.voices[host.id] || ''}
                onChange={event => setWorkingDraft(prev => ({
                  ...prev,
                  tts: {
                    ...prev.tts,
                    voices: {
                      ...prev.tts.voices,
                      [host.id]: event.target.value,
                    },
                  },
                }))}
              />
            </label>
          ))}

          {extraVoiceEntries.length > 0
            ? (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs text-amber-700">The following voice keys do not match current hosts:</p>
                  {extraVoiceEntries.map(([hostId, voice]) => (
                    <div
                      key={hostId}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="rounded bg-gray-100 px-2 py-1">{hostId}</span>
                      <input
                        className="min-w-0 flex-1 rounded border px-2 py-1"
                        value={voice}
                        onChange={event => setWorkingDraft(prev => ({
                          ...prev,
                          tts: {
                            ...prev.tts,
                            voices: {
                              ...prev.tts.voices,
                              [hostId]: event.target.value,
                            },
                          },
                        }))}
                      />
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-red-700"
                        onClick={() => {
                          if (!confirmAction(`Delete extra voice mapping ${hostId}?`)) {
                            return
                          }
                          setWorkingDraft((prev) => {
                            const nextVoices = { ...prev.tts.voices }
                            delete nextVoices[hostId]
                            return {
                              ...prev,
                              tts: {
                                ...prev.tts,
                                voices: nextVoices,
                              },
                            }
                          })
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )
            : null}
        </div>
      </div>
    )
  }

  function renderLocaleSection() {
    const locale = workingDraft.locale
    return (
      <div className={`
        grid gap-4
        md:grid-cols-2
      `}
      >
        <label className="text-sm">
          language
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={locale.language}
            onChange={event => setWorkingDraft(prev => ({
              ...prev,
              locale: {
                ...prev.locale,
                language: event.target.value,
              },
            }))}
          />
        </label>

        <label className="text-sm">
          timezone
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={locale.timezone}
            onChange={event => setWorkingDraft(prev => ({
              ...prev,
              locale: {
                ...prev.locale,
                timezone: event.target.value,
              },
            }))}
          />
        </label>

        <label className={`
          text-sm
          md:col-span-2
        `}
        >
          dateFormat
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={locale.dateFormat || ''}
            onChange={event => setWorkingDraft(prev => ({
              ...prev,
              locale: {
                ...prev.locale,
                dateFormat: event.target.value,
              },
            }))}
          />
        </label>
      </div>
    )
  }

  function renderSourcesSection() {
    const sources = workingDraft.sources
    return (
      <div className="space-y-4">
        <div className={`
          grid gap-4
          md:grid-cols-2
        `}
        >
          <label className="text-sm">
            lookbackDays
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded border px-3 py-2"
              value={sources.lookbackDays}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                sources: {
                  ...prev.sources,
                  lookbackDays: Math.max(1, Number(event.target.value || 1)),
                },
              }))}
            />
          </label>

          <label className="text-sm">
            newsletterHosts (one per line)
            <textarea
              className="mt-1 min-h-24 w-full rounded border px-3 py-2"
              value={toMultiline(sources.newsletterHosts)}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                sources: {
                  ...prev.sources,
                  newsletterHosts: splitMultiline(event.target.value),
                },
              }))}
            />
          </label>

          <label className={`
            text-sm
            md:col-span-2
          `}
          >
            archiveLinkKeywords (one per line)
            <textarea
              className="mt-1 min-h-20 w-full rounded border px-3 py-2"
              value={toMultiline(sources.archiveLinkKeywords)}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                sources: {
                  ...prev.sources,
                  archiveLinkKeywords: splitMultiline(event.target.value),
                },
              }))}
            />
          </label>
        </div>

        <div className="space-y-3 rounded border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Source list</p>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              onClick={() => setWorkingDraft(prev => ({
                ...prev,
                sources: {
                  ...prev.sources,
                  items: [...prev.sources.items, getDefaultSource()],
                },
              }))}
            >
              Add source
            </button>
          </div>

          {sources.items.map((item, index) => (
            <div key={item.id || index} className="space-y-3 rounded border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Source
                  {index + 1}
                </p>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs text-red-700"
                  onClick={() => {
                    if (!confirmAction('Delete this source?')) {
                      return
                    }
                    setWorkingDraft(prev => ({
                      ...prev,
                      sources: {
                        ...prev.sources,
                        items: prev.sources.items.filter((_, itemIndex) => itemIndex !== index),
                      },
                    }))
                  }}
                >
                  Delete source
                </button>
              </div>

              <div className={`
                grid gap-4
                md:grid-cols-3
              `}
              >
                <label className="text-sm">
                  id
                  <input
                    className="mt-1 w-full rounded border px-3 py-2"
                    value={item.id}
                    onChange={event => updateSourceItem(index, current => ({
                      ...current,
                      id: event.target.value,
                    }))}
                  />
                </label>
                <label className="text-sm">
                  name
                  <input
                    className="mt-1 w-full rounded border px-3 py-2"
                    value={item.name}
                    onChange={event => updateSourceItem(index, current => ({
                      ...current,
                      name: event.target.value,
                    }))}
                  />
                </label>
                <label className="text-sm">
                  type
                  <select
                    className="mt-1 w-full rounded border px-3 py-2"
                    value={item.type}
                    onChange={event => updateSourceItem(index, current => ({
                      ...current,
                      type: event.target.value as SourceItem['type'],
                    }))}
                  >
                    {sourceTypeOptions.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </label>

                <label className={`
                  text-sm
                  md:col-span-3
                `}
                >
                  url
                  <input
                    className="mt-1 w-full rounded border px-3 py-2"
                    value={item.url}
                    onChange={event => updateSourceItem(index, current => ({
                      ...current,
                      url: event.target.value,
                    }))}
                  />
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item.enabled !== false}
                    onChange={event => updateSourceItem(index, current => ({
                      ...current,
                      enabled: event.target.checked,
                    }))}
                  />
                  <span>enabled</span>
                </label>

                <label className="text-sm">
                  lookbackDays
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded border px-3 py-2"
                    value={item.lookbackDays ?? ''}
                    onChange={event => updateSourceItem(index, current => ({
                      ...current,
                      lookbackDays: parseOptionalInt(event.target.value),
                    }))}
                  />
                </label>

                <label className="text-sm">
                  maxMessages
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded border px-3 py-2"
                    value={item.maxMessages ?? ''}
                    onChange={event => updateSourceItem(index, current => ({
                      ...current,
                      maxMessages: parseOptionalInt(event.target.value),
                    }))}
                  />
                </label>

                <label className={`
                  text-sm
                  md:col-span-3
                `}
                >
                  label
                  <input
                    className="mt-1 w-full rounded border px-3 py-2"
                    value={item.label || ''}
                    onChange={event => updateSourceItem(index, current => ({
                      ...current,
                      label: event.target.value,
                    }))}
                  />
                </label>
              </div>

              <div className="space-y-2 rounded border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">linkRules</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => updateSourceItem(index, current => ({
                        ...current,
                        linkRules: current.linkRules || {},
                      }))}
                    >
                      Enable
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs text-red-700"
                      onClick={() => {
                        if (!confirmAction('Clear linkRules for this source?')) {
                          return
                        }
                        updateSourceItem(index, current => ({
                          ...current,
                          linkRules: undefined,
                        }))
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {item.linkRules
                  ? (
                      <div className={`
                        grid gap-4
                        md:grid-cols-2
                      `}
                      >
                        <label className="text-sm">
                          includeDomains (one per line)
                          <textarea
                            className={`
                              mt-1 min-h-20 w-full rounded border px-3 py-2
                            `}
                            value={toMultiline(item.linkRules.includeDomains)}
                            onChange={event => updateSourceLinkRules(index, rules => ({
                              ...rules,
                              includeDomains: splitMultiline(event.target.value),
                            }))}
                          />
                        </label>

                        <label className="text-sm">
                          excludeDomains (one per line)
                          <textarea
                            className={`
                              mt-1 min-h-20 w-full rounded border px-3 py-2
                            `}
                            value={toMultiline(item.linkRules.excludeDomains)}
                            onChange={event => updateSourceLinkRules(index, rules => ({
                              ...rules,
                              excludeDomains: splitMultiline(event.target.value),
                            }))}
                          />
                        </label>

                        <label className="text-sm">
                          includePathKeywords (one per line)
                          <textarea
                            className={`
                              mt-1 min-h-20 w-full rounded border px-3 py-2
                            `}
                            value={toMultiline(item.linkRules.includePathKeywords)}
                            onChange={event => updateSourceLinkRules(index, rules => ({
                              ...rules,
                              includePathKeywords: splitMultiline(event.target.value),
                            }))}
                          />
                        </label>

                        <label className="text-sm">
                          excludePathKeywords (one per line)
                          <textarea
                            className={`
                              mt-1 min-h-20 w-full rounded border px-3 py-2
                            `}
                            value={toMultiline(item.linkRules.excludePathKeywords)}
                            onChange={event => updateSourceLinkRules(index, rules => ({
                              ...rules,
                              excludePathKeywords: splitMultiline(event.target.value),
                            }))}
                          />
                        </label>

                        <label className={`
                          text-sm
                          md:col-span-2
                        `}
                        >
                          excludeText (one per line)
                          <textarea
                            className={`
                              mt-1 min-h-20 w-full rounded border px-3 py-2
                            `}
                            value={toMultiline(item.linkRules.excludeText)}
                            onChange={event => updateSourceLinkRules(index, rules => ({
                              ...rules,
                              excludeText: splitMultiline(event.target.value),
                            }))}
                          />
                        </label>

                        <label className="text-sm">
                          minArticleScore
                          <input
                            type="number"
                            step="0.1"
                            className="mt-1 w-full rounded border px-3 py-2"
                            value={item.linkRules.minArticleScore ?? ''}
                            onChange={event => updateSourceLinkRules(index, rules => ({
                              ...rules,
                              minArticleScore: parseOptionalNumber(event.target.value),
                            }))}
                          />
                        </label>

                        <label className="text-sm">
                          minTextLength
                          <input
                            type="number"
                            min={0}
                            className="mt-1 w-full rounded border px-3 py-2"
                            value={item.linkRules.minTextLength ?? ''}
                            onChange={event => updateSourceLinkRules(index, rules => ({
                              ...rules,
                              minTextLength: parseOptionalNumber(event.target.value),
                            }))}
                          />
                        </label>

                        <label className="text-sm">
                          debugMaxLinks
                          <input
                            type="number"
                            min={0}
                            className="mt-1 w-full rounded border px-3 py-2"
                            value={item.linkRules.debugMaxLinks ?? ''}
                            onChange={event => updateSourceLinkRules(index, rules => ({
                              ...rules,
                              debugMaxLinks: parseOptionalInt(event.target.value),
                            }))}
                          />
                        </label>

                        <div className={`
                          flex flex-wrap items-center gap-4
                          md:col-span-2
                        `}
                        >
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={item.linkRules.debug === true}
                              onChange={event => updateSourceLinkRules(index, rules => ({
                                ...rules,
                                debug: event.target.checked,
                              }))}
                            />
                            <span>debug</span>
                          </label>

                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={item.linkRules.resolveTrackingLinks !== false}
                              onChange={event => updateSourceLinkRules(index, rules => ({
                                ...rules,
                                resolveTrackingLinks: event.target.checked,
                              }))}
                            />
                            <span>resolveTrackingLinks</span>
                          </label>

                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={item.linkRules.preferOnlineVersion === true}
                              onChange={event => updateSourceLinkRules(index, rules => ({
                                ...rules,
                                preferOnlineVersion: event.target.checked,
                              }))}
                            />
                            <span>preferOnlineVersion</span>
                          </label>
                        </div>
                      </div>
                    )
                  : <p className="text-xs text-gray-500">linkRules is currently disabled.</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function renderPromptsSection() {
    return (
      <div className="space-y-4">
        <div className={`
          grid gap-2
          lg:grid-cols-2
        `}
        >
          {promptKeys.map((key) => {
            const meta = promptMetaMap[key]
            const isActive = key === activePrompt
            return (
              <button
                key={key}
                type="button"
                className={[
                  'rounded border px-3 py-2 text-left',
                  isActive ? 'border-black bg-gray-100' : 'border-gray-300',
                ].join(' ')}
                onClick={() => setActivePrompt(key)}
              >
                <p className="text-sm font-medium">{meta.label}</p>
                <p className="text-xs text-gray-600">{meta.description}</p>
              </button>
            )
          })}
        </div>

        <div className={`
          grid gap-4
          xl:grid-cols-2
        `}
        >
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Template Editor (Saved)</p>
              <p className="text-xs text-gray-600">
                Current prompt:
                {' '}
                {promptMetaMap[activePrompt].label}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {templateVariableNames.map(name => (
                <button
                  key={name}
                  type="button"
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => insertTemplateVariable(name)}
                  disabled={busy}
                  title={`Insert {{${name}}}`}
                >
                  {name}
                </button>
              ))}
            </div>

            <textarea
              ref={promptEditorRef}
              className="min-h-80 w-full rounded border p-3 font-mono text-xs"
              value={activePromptTemplate}
              onChange={event => setPromptValue(activePrompt, event.target.value)}
            />

            {activePromptUnknownVariables.length > 0
              ? (
                  <p className="text-xs text-amber-700">
                    Unknown template variables:
                    {' '}
                    {activePromptUnknownVariables.join(', ')}
                  </p>
                )
              : (
                  <p className="text-xs text-gray-500">Template variable validation passed.</p>
                )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Render Preview (Preview only, not saved)</p>
            <pre className={`
              min-h-80 overflow-auto rounded border bg-gray-50 p-3 text-xs
              break-words whitespace-pre-wrap
            `}
            >
              {activePromptPreview}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Admin Workbench</h2>

      <div className="flex flex-wrap gap-2">
        {sections.map(name => (
          <button
            key={name}
            type="button"
            className={[
              'rounded border px-3 py-1.5 text-sm',
              section === name ? 'border-black bg-gray-100 font-medium' : 'border-gray-300',
            ].join(' ')}
            onClick={() => setSection(name)}
          >
            {sectionLabelMap[name]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm"
          onClick={resetCurrentSection}
          disabled={busy}
        >
          Reset Current Section
        </button>

        {section === 'prompts'
          ? (
              <>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-sm"
                  onClick={resetActivePrompt}
                  disabled={busy}
                >
                  Reset Current Prompt
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-sm"
                  onClick={resetAllPrompts}
                  disabled={busy}
                >
                  Reset All Prompts
                </button>
              </>
            )
          : null}

        <button
          type="button"
          className="rounded bg-black px-3 py-1.5 text-sm text-white"
          onClick={saveCurrentSection}
          disabled={busy}
        >
          Save Current Section
        </button>
      </div>

      <div className="rounded border p-4">
        {section === 'site' && renderSiteSection()}
        {section === 'hosts' && renderHostsSection()}
        {section === 'ai' && renderAiSection()}
        {section === 'tts' && renderTtsSection()}
        {section === 'locale' && renderLocaleSection()}
        {section === 'sources' && renderSourcesSection()}
        {section === 'prompts' && renderPromptsSection()}
      </div>

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-semibold">Asset Upload</h3>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span>Logo</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  uploadAsset('logo', file)
                }
              }}
              disabled={busy}
            />
          </label>
          <label className="flex items-center gap-2">
            <span>Theme music</span>
            <input
              type="file"
              accept="audio/*"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  uploadAsset('music', file)
                }
              }}
              disabled={busy}
            />
          </label>
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Episode Management</h3>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            onClick={loadEpisodes}
            disabled={loadingEpisodes || busy}
          >
            {loadingEpisodes ? 'Loading...' : 'Refresh episode list'}
          </button>
        </div>
        <ul className="space-y-2">
          {episodes.map(item => (
            <li
              key={item.date}
              className={`
                flex items-center justify-between gap-2 rounded border px-3 py-2
                text-sm
              `}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{item.title}</p>
                <p className="text-xs text-gray-500">{item.date}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => openEpisodeEditor(item.date)}
                  disabled={busy || episodeBusy}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs text-red-700"
                  onClick={() => deleteEpisode(item.date)}
                  disabled={busy || episodeBusy}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {selectedEpisode
        ? (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Edit episode
                  {' '}
                  {selectedEpisode.date}
                </h3>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => setSelectedEpisode(null)}
                  disabled={episodeBusy}
                >
                  Close
                </button>
              </div>

              <label className="block text-sm">
                Title
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={selectedEpisode.title}
                  onChange={event => setSelectedEpisode(prev => (prev
                    ? { ...prev, title: event.target.value }
                    : prev))}
                />
              </label>

              <label className="block text-sm">
                Publish time (ISO)
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={selectedEpisode.publishedAt || ''}
                  onChange={event => setSelectedEpisode(prev => (prev
                    ? { ...prev, publishedAt: event.target.value }
                    : prev))}
                />
              </label>

              <label className="block text-sm">
                Audio key
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={selectedEpisode.audio || ''}
                  onChange={event => setSelectedEpisode(prev => (prev
                    ? { ...prev, audio: event.target.value }
                    : prev))}
                />
              </label>

              <button
                type="button"
                className="rounded bg-black px-3 py-1.5 text-sm text-white"
                onClick={saveEpisode}
                disabled={episodeBusy}
              >
                {episodeBusy ? 'Saving...' : 'Save episode changes'}
              </button>
            </div>
          )
        : null}

      {message ? <p className="text-sm">{message}</p> : null}
    </section>
  )
}
