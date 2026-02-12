'use client'

import type { RuntimeConfigBundle } from '@/types/runtime-config'
import { useMemo, useRef, useState } from 'react'

import { CONFIGURABLE_PLATFORM_OPTIONS } from '@/lib/podcast-platforms'
import { findUnknownTemplateVariables, getTemplateVariables, renderTemplate } from '@/lib/template'

type EditableSection = 'site' | 'hosts' | 'ai' | 'tts' | 'introMusic' | 'locale' | 'sources' | 'prompts' | 'test'
type PromptKey = keyof RuntimeConfigBundle['prompts']
type WorkflowTestStep = RuntimeConfigBundle['test']['workflowTestStep']
type SourceItem = RuntimeConfigBundle['sources']['items'][number]
type SourceLinkRules = NonNullable<SourceItem['linkRules']>

interface PromptMeta {
  label: string
  description: string
}

interface WorkflowTriggerResponse {
  ok?: boolean
  endpoint?: string
  mode?: 'local' | 'production'
  nowIso?: string | null
  result?: string
  error?: string
}

const sections: EditableSection[] = ['site', 'hosts', 'ai', 'tts', 'introMusic', 'locale', 'sources', 'prompts', 'test']

const sectionLabelMap: Record<EditableSection, string> = {
  site: 'Site',
  hosts: 'Hosts',
  ai: 'AI',
  tts: 'TTS',
  introMusic: 'Intro Music',
  locale: 'Locale',
  sources: 'Sources',
  prompts: 'Prompts',
  test: 'Testing',
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
const minimaxLanguageBoostOptions: NonNullable<RuntimeConfigBundle['tts']['languageBoost']>[] = ['auto', 'Chinese', 'English']
const sourceTypeOptions: SourceItem['type'][] = ['rss', 'url', 'gmail']
const workflowTestStepOptions: Array<{ value: WorkflowTestStep, label: string }> = [
  { value: '', label: '(None - run full workflow)' },
  { value: 'openai', label: 'openai' },
  { value: 'responses', label: 'responses' },
  { value: 'tts', label: 'tts' },
  { value: 'tts-intro', label: 'tts-intro' },
  { value: 'story', label: 'story' },
  { value: 'podcast', label: 'podcast' },
  { value: 'blog', label: 'blog' },
  { value: 'intro', label: 'intro' },
  { value: 'stories', label: 'stories' },
]
const externalPlatformOptions: ReadonlyArray<{
  value: RuntimeConfigBundle['site']['externalLinks'][number]['platform']
  label: string
}> = CONFIGURABLE_PLATFORM_OPTIONS.map(option => ({
  value: option.id,
  label: option.name,
}))

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

function getDefaultGmailLinkRules(): SourceLinkRules {
  return {
    debug: true,
    resolveTrackingLinks: true,
    preferOnlineVersion: true,
  }
}

function getSectionPatchPayload(config: RuntimeConfigBundle, section: EditableSection): Record<string, unknown> {
  if (section === 'site')
    return { site: config.site }
  if (section === 'hosts')
    return { hosts: config.hosts }
  if (section === 'ai')
    return { ai: config.ai }
  if (section === 'tts')
    return { tts: config.tts }
  if (section === 'introMusic') {
    return {
      tts: {
        introMusic: config.tts.introMusic,
      },
    }
  }
  if (section === 'locale')
    return { locale: config.locale }
  if (section === 'sources')
    return { sources: config.sources }
  if (section === 'test') {
    return {
      test: config.test,
      tts: {
        skipTts: config.tts.skipTts,
      },
    }
  }
  return { prompts: config.prompts }
}

export function AdminWorkbench({ initialDraft }: { initialDraft: RuntimeConfigBundle }) {
  const [serverDraft, setServerDraft] = useState(initialDraft)
  const [workingDraft, setWorkingDraft] = useState(initialDraft)
  const [section, setSection] = useState<EditableSection>('site')
  const [activePrompt, setActivePrompt] = useState<PromptKey>('summarizeStory')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [busy, setBusy] = useState(false)
  const [triggerBusy, setTriggerBusy] = useState(false)
  const [triggerNowIso, setTriggerNowIso] = useState('')
  const [triggerMessage, setTriggerMessage] = useState('')
  const [collapsedSourcePanels, setCollapsedSourcePanels] = useState<Record<string, boolean>>({})
  const [logoPreviewVersion, setLogoPreviewVersion] = useState<number | null>(null)
  const hostPanelKeysRef = useRef<string[]>(initialDraft.hosts.map(() => buildLocalId('host-panel')))
  const sourcePanelKeysRef = useRef<string[]>(initialDraft.sources.items.map(() => buildLocalId('source-panel')))
  const promptEditorRef = useRef<HTMLTextAreaElement | null>(null)
  const logoUploadInputRef = useRef<HTMLInputElement | null>(null)
  const musicUploadInputRef = useRef<HTMLInputElement | null>(null)

  if (hostPanelKeysRef.current.length < workingDraft.hosts.length) {
    const missing = workingDraft.hosts.length - hostPanelKeysRef.current.length
    for (let i = 0; i < missing; i += 1) {
      hostPanelKeysRef.current.push(buildLocalId('host-panel'))
    }
  }
  if (hostPanelKeysRef.current.length > workingDraft.hosts.length) {
    hostPanelKeysRef.current = hostPanelKeysRef.current.slice(0, workingDraft.hosts.length)
  }
  if (sourcePanelKeysRef.current.length < workingDraft.sources.items.length) {
    const missing = workingDraft.sources.items.length - sourcePanelKeysRef.current.length
    for (let i = 0; i < missing; i += 1) {
      sourcePanelKeysRef.current.push(buildLocalId('source-panel'))
    }
  }
  if (sourcePanelKeysRef.current.length > workingDraft.sources.items.length) {
    sourcePanelKeysRef.current = sourcePanelKeysRef.current.slice(0, workingDraft.sources.items.length)
  }

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

  const hasPromptChanges = useMemo(() => {
    return JSON.stringify(workingDraft.prompts) !== JSON.stringify(serverDraft.prompts)
  }, [workingDraft.prompts, serverDraft.prompts])

  const hasActivePromptChanges = useMemo(() => {
    return workingDraft.prompts[activePrompt] !== serverDraft.prompts[activePrompt]
  }, [workingDraft.prompts, serverDraft.prompts, activePrompt])

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

  async function saveCurrentSection() {
    setBusy(true)
    setMessage('')
    setMessageType('success')
    try {
      const payload = getSectionPatchPayload(workingDraft, section)
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
      const savedAt = new Date(body.draft.meta.updatedAt).toLocaleString()
      setMessage(`Saved ${sectionLabelMap[section]} at ${savedAt}`)
      setMessageType('success')
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed')
      setMessageType('error')
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
      if (section === 'introMusic') {
        return {
          ...prev,
          tts: {
            ...prev.tts,
            introMusic: serverDraft.tts.introMusic,
          },
        }
      }
      if (section === 'locale') {
        return { ...prev, locale: serverDraft.locale }
      }
      if (section === 'sources') {
        return { ...prev, sources: serverDraft.sources }
      }
      if (section === 'test') {
        return {
          ...prev,
          test: serverDraft.test,
          tts: {
            ...prev.tts,
            skipTts: serverDraft.tts.skipTts,
          },
        }
      }
      return { ...prev, prompts: serverDraft.prompts }
    })
  }

  function resetActivePrompt() {
    if (!hasActivePromptChanges) {
      return
    }
    if (!confirmAction('Reset unsaved changes in the current prompt?')) {
      return
    }
    setPromptValue(activePrompt, serverDraft.prompts[activePrompt])
  }

  function resetAllPrompts() {
    if (!hasPromptChanges) {
      return
    }
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

  async function uploadAsset(kind: 'logo' | 'music', file: File, onUploaded?: (url: string) => void) {
    setBusy(true)
    setMessage('')
    setMessageType('success')
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
      if (onUploaded) {
        onUploaded(body.url)
      }
      setMessage(`${kind} uploaded: ${body.url}`)
      setMessageType('success')
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed')
      setMessageType('error')
    }
    finally {
      setBusy(false)
    }
  }

  async function triggerWorkflow() {
    setTriggerBusy(true)
    setTriggerMessage('')
    try {
      const rawNow = triggerNowIso.trim()
      let nowIso: string | undefined
      if (rawNow) {
        const parsed = new Date(rawNow)
        if (Number.isNaN(parsed.getTime())) {
          throw new TypeError('now must be a valid datetime')
        }
        nowIso = parsed.toISOString()
      }
      const triggerUrl = '/api/admin/workflow/trigger'
      const fullUrl = new URL(triggerUrl, window.location.origin).toString()
      console.info('[trigger] ---- START ----')
      console.info('[trigger] page origin:', window.location.origin)
      console.info('[trigger] POST', fullUrl, { nowIso })
      const response = await fetch(triggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nowIso,
        }),
      })
      const responseText = await response.text()
      console.info('[trigger] response status:', response.status, response.statusText)
      console.info('[trigger] response headers:', Object.fromEntries(response.headers.entries()))
      console.info('[trigger] response body:', responseText.slice(0, 500))
      let body: WorkflowTriggerResponse = {}
      if (responseText.trim()) {
        try {
          body = JSON.parse(responseText) as WorkflowTriggerResponse
        }
        catch {
          body = {
            error: responseText.trim(),
          }
        }
      }
      console.info('[trigger] parsed body:', body)
      if (!response.ok || !body.ok) {
        console.error('[trigger] FAILED -', 'status:', response.status, 'body.error:', body.error, 'body:', body)
        throw new Error(body.error || `Failed to trigger workflow (HTTP ${response.status})`)
      }
      const modeLabel = body.mode === 'local' ? 'local worker' : 'production worker'
      const nowLabel = body.nowIso ? `, now=${body.nowIso}` : ''
      console.info('[trigger] SUCCESS -', modeLabel, body.endpoint)
      setTriggerMessage(`Triggered ${modeLabel} at ${body.endpoint}${nowLabel}`)
    }
    catch (error) {
      console.error('[trigger] ERROR:', error)
      setTriggerMessage(error instanceof Error ? error.message : 'Failed to trigger workflow')
    }
    finally {
      console.info('[trigger] ---- END ----')
      setTriggerBusy(false)
    }
  }

  const logoPreviewSrc = useMemo(() => {
    const base = workingDraft.site.coverLogoUrl
    if (!base) {
      return ''
    }
    if (logoPreviewVersion === null) {
      return base
    }
    const separator = base.includes('?') ? '&' : '?'
    return `${base}${separator}v=${logoPreviewVersion}`
  }, [workingDraft.site.coverLogoUrl, logoPreviewVersion])

  function renderSiteSection() {
    const site = workingDraft.site
    const externalPlatformOrder = new Map(externalPlatformOptions.map((option, index) => [option.value, index]))

    function sortExternalLinks(
      links: RuntimeConfigBundle['site']['externalLinks'],
    ): RuntimeConfigBundle['site']['externalLinks'] {
      return [...links].sort((a, b) => {
        const left = externalPlatformOrder.get(a.platform) ?? Number.MAX_SAFE_INTEGER
        const right = externalPlatformOrder.get(b.platform) ?? Number.MAX_SAFE_INTEGER
        return left - right
      })
    }

    function updateExternalLinkUrl(
      platform: RuntimeConfigBundle['site']['externalLinks'][number]['platform'],
      url: string,
    ) {
      setWorkingDraft((prev) => {
        const normalizedUrl = url.trim()
        const existing = prev.site.externalLinks.find(item => item.platform === platform)
        const filtered = prev.site.externalLinks.filter(item => item.platform !== platform)
        const nextLinks = normalizedUrl
          ? sortExternalLinks([
              ...filtered,
              { platform, url: normalizedUrl, icon: existing?.icon },
            ])
          : filtered
        return {
          ...prev,
          site: {
            ...prev.site,
            externalLinks: nextLinks,
          },
        }
      })
    }

    return (
      <div className="space-y-4">
        <div className={`
          grid gap-4
          md:grid-cols-2
        `}
        >
          <label className="text-sm">
            Podcast title
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
            Podcast description
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

          <div className={`
            space-y-3 rounded border p-3
            md:col-span-2
          `}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Cover logo upload</p>
              <input
                ref={logoUploadInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) {
                    return
                  }
                  uploadAsset('logo', file, (url) => {
                    setWorkingDraft(prev => ({
                      ...prev,
                      site: {
                        ...prev.site,
                        coverLogoUrl: url,
                      },
                    }))
                    setLogoPreviewVersion(Date.now())
                  })
                }}
                disabled={busy}
              />
              <button
                type="button"
                className={`
                  rounded border px-3 py-1.5 text-xs font-medium
                  hover:bg-gray-50
                  disabled:cursor-not-allowed disabled:opacity-60
                `}
                onClick={() => logoUploadInputRef.current?.click()}
                disabled={busy}
              >
                Upload logo
              </button>
            </div>

            {site.coverLogoUrl
              ? (
                  <div className="space-y-2">
                    {/* eslint-disable-next-line next/no-img-element -- admin preview supports arbitrary logo URLs */}
                    <img
                      src={logoPreviewSrc}
                      alt="Cover logo preview"
                      className={`
                        h-20 w-20 rounded border bg-white object-contain p-1
                      `}
                    />
                    <p className="text-xs break-all text-gray-500">{site.coverLogoUrl}</p>
                  </div>
                )
              : (
                  <p className="text-xs text-gray-500">No cover logo URL set.</p>
                )}
          </div>

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
          <p className="text-sm font-semibold">External links</p>

          {externalPlatformOptions.map((option) => {
            const existing = site.externalLinks.find(item => item.platform === option.value)
            return (
              <div
                key={option.value}
                className={`
                  grid gap-2 rounded border p-2
                  md:grid-cols-3
                `}
              >
                <label className="text-xs">
                  platform
                  <input
                    className="mt-1 w-full rounded border px-2 py-1"
                    value={option.label}
                    disabled
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
                    value={existing?.url ?? ''}
                    placeholder="https://..."
                    onChange={event => updateExternalLinkUrl(option.value, event.target.value)}
                  />
                </label>
              </div>
            )
          })}
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
            onClick={() => {
              setWorkingDraft(prev => ({
                ...prev,
                hosts: [...prev.hosts, getDefaultHost(prev.hosts.length)],
              }))
              hostPanelKeysRef.current = [...hostPanelKeysRef.current, buildLocalId('host-panel')]
            }}
          >
            Add host
          </button>
        </div>

        {workingDraft.hosts.map((host, index) => (
          <div
            key={hostPanelKeysRef.current[index] || `host-row-fallback-${index}`}
            className="space-y-3 rounded border p-3"
          >
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
                  hostPanelKeysRef.current = hostPanelKeysRef.current.filter((_, itemIndex) => itemIndex !== index)
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
    const provider = tts.provider
    const isGemini = provider === 'gemini'
    const isMinimax = provider === 'minimax'
    const isEdge = provider === 'edge'
    const isMurf = provider === 'murf'
    const showLanguage = isEdge || isMurf
    const showLanguageBoost = isMinimax
    const showModel = isGemini || isMinimax || isMurf
    const showSpeed = isEdge || isMinimax || isMurf
    const showApiUrl = isMinimax || isMurf
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

          {showLanguageBoost
            ? (
                <label className="text-sm">
                  language_boost
                  <select
                    className="mt-1 w-full rounded border px-3 py-2"
                    value={tts.languageBoost || 'Chinese'}
                    onChange={event => setWorkingDraft(prev => ({
                      ...prev,
                      tts: {
                        ...prev.tts,
                        languageBoost: event.target.value as NonNullable<RuntimeConfigBundle['tts']['languageBoost']>,
                      },
                    }))}
                  >
                    {minimaxLanguageBoostOptions.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
              )
            : null}

          {showLanguage
            ? (
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
              )
            : null}

          {showModel
            ? (
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
              )
            : null}

          {showSpeed
            ? (
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
              )
            : null}

          {showApiUrl
            ? (
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
              )
            : null}

          {isGemini
            ? (
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
              )
            : null}
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

  function renderIntroMusicSection() {
    const introMusic = workingDraft.tts.introMusic
    return (
      <div className="space-y-4">
        <div className="space-y-3 rounded border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Theme music file</p>
            <input
              ref={musicUploadInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) {
                  return
                }
                uploadAsset('music', file, (url) => {
                  setWorkingDraft(prev => ({
                    ...prev,
                    tts: {
                      ...prev.tts,
                      introMusic: {
                        ...prev.tts.introMusic,
                        url,
                      },
                    },
                  }))
                })
              }}
              disabled={busy}
            />
            <button
              type="button"
              className={`
                rounded border px-3 py-1.5 text-xs font-medium
                hover:bg-gray-50
                disabled:cursor-not-allowed disabled:opacity-60
              `}
              onClick={() => musicUploadInputRef.current?.click()}
              disabled={busy}
            >
              Upload theme music
            </button>
          </div>

          <label className="block text-sm">
            url
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={introMusic.url || ''}
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

          {introMusic.url
            ? (
                <audio controls className="w-full" src={introMusic.url} />
              )
            : (
                <p className="text-xs text-gray-500">No intro music URL set.</p>
              )}
        </div>

        <div className={`
          grid gap-4
          md:grid-cols-2
        `}
        >
          <label className="text-sm">
            fadeOutStart
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded border px-3 py-2"
              value={introMusic.fadeOutStart}
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
              value={introMusic.fadeOutDuration}
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
          <label className={`
            text-sm
            md:col-span-2
          `}
          >
            podcastDelay(ms)
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded border px-3 py-2"
              value={introMusic.podcastDelay}
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
          Language (UI &amp; content)
          <select
            className="mt-1 w-full rounded border px-3 py-2"
            value={locale.language}
            onChange={event => setWorkingDraft(prev => ({
              ...prev,
              locale: {
                ...prev.locale,
                language: event.target.value,
              },
            }))}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="de">Deutsch</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
          </select>
        </label>

        <label className="text-sm">
          Timezone
          <select
            className="mt-1 w-full rounded border px-3 py-2"
            value={locale.timezone}
            onChange={event => setWorkingDraft(prev => ({
              ...prev,
              locale: {
                ...prev.locale,
                timezone: event.target.value,
              },
            }))}
          >
            {Intl.supportedValuesOf('timeZone').map(tz => (
              <option key={tz} value={tz}>{tz.replaceAll('_', ' ')}</option>
            ))}
          </select>
        </label>

        <label className={`
          text-sm
          md:col-span-2
        `}
        >
          Date format
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
            Fetch frequency (days)
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
            <p className="mt-1 text-xs text-gray-500">
              Timezone-aware full-day window. `1` = previous local day (00:00-23:59:59), `2` = previous 2 full local days.
            </p>
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
              onClick={() => {
                const nextSource = getDefaultSource()
                const panelKey = buildLocalId('source-panel')
                sourcePanelKeysRef.current = [...sourcePanelKeysRef.current, panelKey]
                setCollapsedSourcePanels(prev => ({
                  ...prev,
                  [panelKey]: true,
                }))
                setWorkingDraft(prev => ({
                  ...prev,
                  sources: {
                    ...prev.sources,
                    items: [...prev.sources.items, nextSource],
                  },
                }))
              }}
            >
              Add source
            </button>
          </div>

          {sources.items.map((item, index) => {
            const panelKey = sourcePanelKeysRef.current[index] || `source-panel-fallback-${index}`
            const isCollapsed = collapsedSourcePanels[panelKey] ?? true
            const sourceName = item.name.trim() || `Source ${index + 1}`

            return (
              <div key={panelKey} className="rounded border">
                <button
                  type="button"
                  className={`
                    flex w-full items-center justify-between px-3 py-2 text-left
                  `}
                  onClick={() => setCollapsedSourcePanels(prev => ({
                    ...prev,
                    [panelKey]: !isCollapsed,
                  }))}
                >
                  <span className="truncate text-sm font-medium">{sourceName}</span>
                  <span aria-hidden className="ml-2 text-xs text-gray-500">{isCollapsed ? '▸' : '▾'}</span>
                </button>

                {isCollapsed
                  ? null
                  : (
                      <div className="space-y-3 border-t p-3">
                        <div className="flex items-center justify-end">
                          <button
                            type="button"
                            className={`
                              rounded border px-2 py-1 text-xs text-red-700
                            `}
                            onClick={() => {
                              if (!confirmAction('Delete this source?')) {
                                return
                              }
                              setCollapsedSourcePanels((prev) => {
                                const next = { ...prev }
                                delete next[panelKey]
                                return next
                              })
                              sourcePanelKeysRef.current = sourcePanelKeysRef.current.filter((_, itemIndex) => itemIndex !== index)
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
                              onChange={(event) => {
                                const nextType = event.target.value as SourceItem['type']
                                updateSourceItem(index, (current) => {
                                  if (nextType !== 'gmail') {
                                    return {
                                      ...current,
                                      type: nextType,
                                    }
                                  }
                                  return {
                                    ...current,
                                    type: nextType,
                                    linkRules: {
                                      ...getDefaultGmailLinkRules(),
                                      ...(current.linkRules || {}),
                                    },
                                  }
                                })
                              }}
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

                          {item.type === 'gmail'
                            ? (
                                <>
                                  <label className="text-sm">
                                    maxMessages
                                    <input
                                      type="number"
                                      min={1}
                                      className={`
                                        mt-1 w-full rounded border px-3 py-2
                                      `}
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
                                      className={`
                                        mt-1 w-full rounded border px-3 py-2
                                      `}
                                      value={item.label || ''}
                                      onChange={event => updateSourceItem(index, current => ({
                                        ...current,
                                        label: event.target.value,
                                      }))}
                                    />
                                  </label>
                                </>
                              )
                            : null}
                        </div>

                        {item.type === 'gmail'
                          ? (
                              <div className="space-y-2 rounded border p-3">
                                <div className={`
                                  flex items-center justify-between
                                `}
                                >
                                  <p className="text-sm font-medium">linkRules</p>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      className={`
                                        rounded border px-2 py-1 text-xs
                                      `}
                                      onClick={() => updateSourceItem(index, current => ({
                                        ...current,
                                        linkRules: {
                                          ...getDefaultGmailLinkRules(),
                                          ...(current.linkRules || {}),
                                        },
                                      }))}
                                    >
                                      Enable
                                    </button>
                                    <button
                                      type="button"
                                      className={`
                                        rounded border px-2 py-1 text-xs
                                        text-red-700
                                      `}
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
                                              mt-1 min-h-20 w-full rounded
                                              border px-3 py-2
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
                                              mt-1 min-h-20 w-full rounded
                                              border px-3 py-2
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
                                              mt-1 min-h-20 w-full rounded
                                              border px-3 py-2
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
                                              mt-1 min-h-20 w-full rounded
                                              border px-3 py-2
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
                                              mt-1 min-h-20 w-full rounded
                                              border px-3 py-2
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
                                            className={`
                                              mt-1 w-full rounded border px-3
                                              py-2
                                            `}
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
                                            className={`
                                              mt-1 w-full rounded border px-3
                                              py-2
                                            `}
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
                                            className={`
                                              mt-1 w-full rounded border px-3
                                              py-2
                                            `}
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
                                          <label className={`
                                            flex items-center gap-2 text-sm
                                          `}
                                          >
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

                                          <label className={`
                                            flex items-center gap-2 text-sm
                                          `}
                                          >
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

                                          <label className={`
                                            flex items-center gap-2 text-sm
                                          `}
                                          >
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
                            )
                          : null}
                      </div>
                    )}
              </div>
            )
          })}
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

  function renderTestSection() {
    const test = workingDraft.test
    const skipTts = workingDraft.tts.skipTts === true
    return (
      <div className="space-y-4">
        <div className="space-y-3 rounded border bg-gray-50 p-3">
          <div>
            <p className="text-sm font-semibold">Manual workflow trigger</p>
            <p className="text-xs text-gray-600">
              Trigger the worker from Admin without curl. Leave now empty to use current time.
            </p>
          </div>
          <div className={`
            grid gap-3
            md:grid-cols-[minmax(0,1fr)_auto]
          `}
          >
            <label className="text-sm">
              now (optional, ISO datetime)
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border px-3 py-2"
                value={triggerNowIso}
                onChange={event => setTriggerNowIso(event.target.value)}
                disabled={triggerBusy}
              />
            </label>
            <button
              type="button"
              className={`
                self-end rounded bg-black px-3 py-2 text-sm text-white
                transition
                hover:bg-gray-900
                active:scale-[0.98] active:bg-gray-800
                disabled:cursor-not-allowed disabled:opacity-60
              `}
              onClick={triggerWorkflow}
              disabled={triggerBusy}
            >
              {triggerBusy ? 'Triggering...' : 'Trigger Workflow'}
            </button>
          </div>
          {triggerMessage ? <p className="text-xs text-gray-700">{triggerMessage}</p> : null}
        </div>

        <p className="text-sm text-gray-600">
          Configure workflow test variables without editing worker env. Empty step means normal full workflow.
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={skipTts}
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

        <div className={`
          grid gap-4
          md:grid-cols-2
        `}
        >
          <label className="text-sm">
            WORKFLOW_TEST_STEP
            <select
              className="mt-1 w-full rounded border px-3 py-2"
              value={test.workflowTestStep}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                test: {
                  ...prev.test,
                  workflowTestStep: event.target.value as WorkflowTestStep,
                },
              }))}
            >
              {workflowTestStepOptions.map(option => (
                <option key={option.value || '__none__'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

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
            WORKFLOW_TEST_INPUT
            <textarea
              className="mt-1 min-h-28 w-full rounded border px-3 py-2"
              value={test.workflowTestInput}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                test: {
                  ...prev.test,
                  workflowTestInput: event.target.value,
                },
              }))}
            />
          </label>

          <label className={`
            text-sm
            md:col-span-2
          `}
          >
            WORKFLOW_TEST_INSTRUCTIONS
            <textarea
              className="mt-1 min-h-28 w-full rounded border px-3 py-2"
              value={test.workflowTestInstructions}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                test: {
                  ...prev.test,
                  workflowTestInstructions: event.target.value,
                },
              }))}
            />
          </label>

          <label className={`
            text-sm
            md:col-span-2
          `}
          >
            WORKFLOW_TTS_INPUT
            <textarea
              className="mt-1 min-h-28 w-full rounded border px-3 py-2"
              value={test.workflowTtsInput}
              onChange={event => setWorkingDraft(prev => ({
                ...prev,
                test: {
                  ...prev.test,
                  workflowTtsInput: event.target.value,
                },
              }))}
            />
          </label>
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
          className={`
            rounded bg-black px-3 py-1.5 text-sm text-white transition
            hover:bg-gray-900
            active:scale-[0.98] active:bg-gray-800
            disabled:cursor-not-allowed disabled:opacity-60
          `}
          onClick={saveCurrentSection}
          disabled={busy}
        >
          Save Current Section
        </button>
      </div>

      {message
        ? (
            <p className={messageType === 'error'
              ? 'text-sm text-red-700'
              : 'text-sm text-green-700'}
            >
              {message}
            </p>
          )
        : null}

      <div className="rounded border p-4">
        {section === 'site' && renderSiteSection()}
        {section === 'hosts' && renderHostsSection()}
        {section === 'ai' && renderAiSection()}
        {section === 'tts' && renderTtsSection()}
        {section === 'introMusic' && renderIntroMusicSection()}
        {section === 'locale' && renderLocaleSection()}
        {section === 'sources' && renderSourcesSection()}
        {section === 'prompts' && renderPromptsSection()}
        {section === 'test' && renderTestSection()}
      </div>
    </section>
  )
}
