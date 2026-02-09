'use client'

import type { RuntimeConfigBundle } from '@/types/runtime-config'
import { useMemo, useState } from 'react'

type EditableSection = 'site' | 'hosts' | 'tts' | 'locale' | 'sources' | 'prompts'

type EditableSiteConfig = RuntimeConfigBundle['site']

type EditableTtsConfig = Pick<
  RuntimeConfigBundle['tts'],
  'provider' | 'language' | 'model' | 'voices' | 'geminiPrompt' | 'introMusic' | 'audioQuality'
>

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

export function AdminWorkbench({ initialDraft }: { initialDraft: RuntimeConfigBundle }) {
  const [draft, setDraft] = useState(initialDraft)
  const [section, setSection] = useState<EditableSection>('site')
  const [content, setContent] = useState(() => toJson(getSectionEditorValue(initialDraft, 'site')))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(false)
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeDetail | null>(null)
  const [episodeBusy, setEpisodeBusy] = useState(false)

  const sectionValue = useMemo(() => {
    return getSectionEditorValue(draft, section)
  }, [draft, section])

  async function refreshDraft() {
    const response = await fetch('/api/admin/config/draft')
    const body = (await response.json()) as { draft: RuntimeConfigBundle, error?: string }
    if (!response.ok) {
      throw new Error(body.error || '刷新草稿失败')
    }
    setDraft(body.draft)
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
    // eslint-disable-next-line no-alert -- admin delete confirmation
    if (!globalThis.confirm(`确定删除 ${date} 的节目吗？此操作不可撤销，音频文件也会被删除。`)) {
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
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => setContent(toJson(sectionValue))}
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
      </div>

      <textarea
        className="min-h-72 w-full rounded border p-3 font-mono text-xs"
        value={content}
        onChange={event => setContent(event.target.value)}
      />

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
