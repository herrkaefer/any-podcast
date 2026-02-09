'use client'

import type { RuntimeConfigBundle } from '@/types/runtime-config'
import { useMemo, useRef, useState } from 'react'

import { findUnknownTemplateVariables, getTemplateVariables, renderTemplate } from '@/lib/template'

type EditableSection = 'site' | 'hosts' | 'tts' | 'locale' | 'sources' | 'prompts'

type EditableSiteConfig = RuntimeConfigBundle['site']

type EditableTtsConfig = Pick<
  RuntimeConfigBundle['tts'],
  'provider' | 'language' | 'model' | 'voices' | 'geminiPrompt' | 'introMusic' | 'audioQuality'
>

type PromptKey = keyof RuntimeConfigBundle['prompts']

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

const sections: EditableSection[] = ['site', 'hosts', 'tts', 'locale', 'sources', 'prompts']
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
    label: '文章摘要与相关性',
    description: '用于单篇文章与评论整理，并判断是否和播客主题相关。',
  },
  summarizePodcast: {
    label: '播客对话生成',
    description: '用于把多条摘要整合为双人对话播客稿。',
  },
  summarizeBlog: {
    label: '博客正文生成',
    description: '用于产出 SEO 友好的 Markdown 博客正文。',
  },
  intro: {
    label: '节目简介生成',
    description: '用于生成每期节目在页面展示的短简介。',
  },
  title: {
    label: '标题生成',
    description: '用于生成并推荐单集标题。',
  },
  extractNewsletterLinks: {
    label: 'Newsletter 链接提取',
    description: '用于从 Newsletter 文本中筛选可用文章链接。',
  },
}

function toJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function getEditableSiteConfig(site: RuntimeConfigBundle['site']): EditableSiteConfig {
  return { ...site }
}

function getSectionEditorValue(draft: RuntimeConfigBundle, section: EditableSection) {
  if (section === 'site') {
    return getEditableSiteConfig(draft.site)
  }
  if (section === 'tts') {
    return {
      provider: draft.tts.provider,
      language: draft.tts.language,
      model: draft.tts.model,
      voices: draft.tts.voices,
      geminiPrompt: draft.tts.geminiPrompt,
      introMusic: draft.tts.introMusic,
      audioQuality: draft.tts.audioQuality,
    } satisfies EditableTtsConfig
  }
  return draft[section]
}

function setPromptValue(
  current: RuntimeConfigBundle['prompts'],
  key: PromptKey,
  value: string,
): RuntimeConfigBundle['prompts'] {
  return {
    ...current,
    [key]: value,
  }
}

function confirmAction(message: string) {
  // eslint-disable-next-line no-alert -- admin confirmation dialog
  return globalThis.confirm(message)
}

export function AdminWorkbench({ initialDraft }: { initialDraft: RuntimeConfigBundle }) {
  const [draft, setDraft] = useState(initialDraft)
  const [section, setSection] = useState<EditableSection>('site')
  const [content, setContent] = useState(() => toJson(getSectionEditorValue(initialDraft, 'site')))
  const [promptDrafts, setPromptDrafts] = useState(initialDraft.prompts)
  const [activePrompt, setActivePrompt] = useState<PromptKey>('summarizeStory')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(false)
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeDetail | null>(null)
  const [episodeBusy, setEpisodeBusy] = useState(false)
  const promptEditorRef = useRef<HTMLTextAreaElement | null>(null)

  const sectionValue = useMemo(() => {
    return getSectionEditorValue(draft, section)
  }, [draft, section])

  const templateVariables = useMemo(() => {
    return getTemplateVariables(draft)
  }, [draft])

  const templateVariableNames = useMemo(() => {
    return Object.keys(templateVariables).sort()
  }, [templateVariables])

  const activePromptTemplate = promptDrafts[activePrompt]
  const activePromptPreview = useMemo(() => {
    return renderTemplate(activePromptTemplate, templateVariables)
  }, [activePromptTemplate, templateVariables])

  const activePromptUnknownVariables = useMemo(() => {
    return findUnknownTemplateVariables(activePromptTemplate, templateVariables)
  }, [activePromptTemplate, templateVariables])

  async function refreshDraft() {
    const response = await fetch('/api/admin/config/draft')
    const body = (await response.json()) as { draft: RuntimeConfigBundle, error?: string }
    if (!response.ok) {
      throw new Error(body.error || '刷新草稿失败')
    }
    setDraft(body.draft)
    setPromptDrafts(body.draft.prompts)
    return body.draft
  }

  async function saveSection() {
    setBusy(true)
    setMessage('')
    try {
      const parsed = JSON.parse(content) as unknown
      const payload = { [section]: parsed }
      const response = await fetch('/api/admin/config/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json()) as { draft?: RuntimeConfigBundle, error?: string }
      if (!response.ok || !body.draft) {
        throw new Error(body.error || '保存失败')
      }
      setDraft(body.draft)
      setPromptDrafts(body.draft.prompts)
      setContent(toJson(getSectionEditorValue(body.draft, section)))
      setMessage(`已保存 ${section}`)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    }
    finally {
      setBusy(false)
    }
  }

  async function savePrompts() {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/config/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: promptDrafts }),
      })
      const body = (await response.json()) as { draft?: RuntimeConfigBundle, error?: string }
      if (!response.ok || !body.draft) {
        throw new Error(body.error || '保存 prompts 失败')
      }
      setDraft(body.draft)
      setPromptDrafts(body.draft.prompts)
      setMessage('已保存 prompts')
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : '保存 prompts 失败')
    }
    finally {
      setBusy(false)
    }
  }

  function resetActivePrompt() {
    if (!confirmAction('确定重置当前 Prompt 的未保存修改吗？')) {
      return
    }
    setPromptDrafts(prev => setPromptValue(prev, activePrompt, draft.prompts[activePrompt]))
  }

  function resetAllPrompts() {
    if (!confirmAction('确定重置全部 Prompt 的未保存修改吗？')) {
      return
    }
    setPromptDrafts(draft.prompts)
  }

  function resetCurrentSection() {
    if (!confirmAction(`确定重置当前区块 ${section} 的未保存修改吗？`)) {
      return
    }
    setContent(toJson(sectionValue))
  }

  function insertTemplateVariable(name: string) {
    const token = `{{${name}}}`
    const editor = promptEditorRef.current
    const current = promptDrafts[activePrompt]

    if (!editor) {
      setPromptDrafts(prev => setPromptValue(prev, activePrompt, `${current}${token}`))
      return
    }

    const start = editor.selectionStart ?? current.length
    const end = editor.selectionEnd ?? current.length
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`
    const caret = start + token.length

    setPromptDrafts(prev => setPromptValue(prev, activePrompt, next))

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
        throw new Error(body.error || `上传 ${kind} 失败`)
      }
      setMessage(`${kind} 上传成功: ${body.url}`)
      await refreshDraft()
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : '上传失败')
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
        throw new Error(body.error || '加载节目失败')
      }
      setEpisodes(body.items)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : '加载节目失败')
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
        throw new Error(body.error || '加载节目详情失败')
      }
      setSelectedEpisode(body.item)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : '加载节目详情失败')
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
        throw new Error(body.error || '保存节目失败')
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
      setMessage(`已更新 ${nextItem.date}`)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : '保存节目失败')
    }
    finally {
      setEpisodeBusy(false)
    }
  }

  async function deleteEpisode(date: string) {
    if (!confirmAction(`确定删除 ${date} 的节目吗？此操作不可撤销，音频文件也会被删除。`)) {
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
        throw new Error(body.error || '删除失败')
      }
      setEpisodes(prev => prev.filter(item => item.date !== date))
      if (selectedEpisode?.date === date) {
        setSelectedEpisode(null)
      }
      setMessage(`已删除 ${date}`)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败')
    }
    finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Admin 工作台</h2>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          配置区块
          <select
            className="ml-2 rounded border px-2 py-1"
            value={section}
            onChange={(event) => {
              const next = event.target.value as EditableSection
              setSection(next)
              setContent(toJson(getSectionEditorValue(draft, next)))
            }}
          >
            {sections.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        {section === 'prompts'
          ? (
              <>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-sm"
                  onClick={resetActivePrompt}
                  disabled={busy}
                >
                  重置当前 Prompt
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-sm"
                  onClick={resetAllPrompts}
                  disabled={busy}
                >
                  重置全部 Prompt
                </button>
                <button
                  type="button"
                  className="rounded bg-black px-3 py-1.5 text-sm text-white"
                  onClick={savePrompts}
                  disabled={busy}
                >
                  保存 prompts
                </button>
              </>
            )
          : (
              <>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-sm"
                  onClick={resetCurrentSection}
                  disabled={busy}
                >
                  重置当前区块
                </button>
                <button
                  type="button"
                  className="rounded bg-black px-3 py-1.5 text-sm text-white"
                  onClick={saveSection}
                  disabled={busy}
                >
                  保存当前区块
                </button>
              </>
            )}
      </div>

      {section === 'prompts'
        ? (
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
                    <p className="text-sm font-semibold">模板编辑（会保存）</p>
                    <p className="text-xs text-gray-600">
                      当前 Prompt:
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
                        title={`插入 {{${name}}}`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>

                  <textarea
                    ref={promptEditorRef}
                    className={`
                      min-h-80 w-full rounded border p-3 font-mono text-xs
                    `}
                    value={activePromptTemplate}
                    onChange={event => setPromptDrafts(prev => setPromptValue(prev, activePrompt, event.target.value))}
                  />

                  {activePromptUnknownVariables.length > 0
                    ? (
                        <p className="text-xs text-amber-700">
                          未知模板变量:
                          {' '}
                          {activePromptUnknownVariables.join(', ')}
                        </p>
                      )
                    : (
                        <p className="text-xs text-gray-500">模板变量校验通过。</p>
                      )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold">渲染预览（仅预览，不保存）</p>
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
        : (
            <textarea
              className="min-h-72 w-full rounded border p-3 font-mono text-xs"
              value={content}
              onChange={event => setContent(event.target.value)}
            />
          )}

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-semibold">资源上传</h3>
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
            <span>主题音乐</span>
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
          <h3 className="text-sm font-semibold">节目管理</h3>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            onClick={loadEpisodes}
            disabled={loadingEpisodes || busy}
          >
            {loadingEpisodes ? '加载中...' : '刷新节目列表'}
          </button>
        </div>
        <ul className="space-y-2">
          {episodes.map(item => (
            <li
              key={item.date}
              className={[
                'flex items-center justify-between gap-2 rounded border px-3 py-2',
                'text-sm',
              ].join(' ')}
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
                  编辑
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs text-red-700"
                  onClick={() => deleteEpisode(item.date)}
                  disabled={busy || episodeBusy}
                >
                  删除
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
                  编辑节目
                  {selectedEpisode.date}
                </h3>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => setSelectedEpisode(null)}
                  disabled={episodeBusy}
                >
                  关闭
                </button>
              </div>

              <label className="block text-sm">
                标题
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={selectedEpisode.title}
                  onChange={event => setSelectedEpisode(prev => (prev
                    ? { ...prev, title: event.target.value }
                    : prev))}
                />
              </label>

              <label className="block text-sm">
                发布时间 (ISO)
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={selectedEpisode.publishedAt || ''}
                  onChange={event => setSelectedEpisode(prev => (prev
                    ? { ...prev, publishedAt: event.target.value }
                    : prev))}
                />
              </label>

              <label className="block text-sm">
                音频 Key
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
                {episodeBusy ? '保存中...' : '保存节目修改'}
              </button>
            </div>
          )
        : null}

      {message ? <p className="text-sm">{message}</p> : null}
    </section>
  )
}
