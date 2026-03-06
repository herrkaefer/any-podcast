'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'

interface EpisodeListItem {
  date: string
  title: string
  publishedAt?: string
  updatedAt?: number
  audio?: string
}

interface EpisodeDetail extends EpisodeListItem {
  podcastContent?: string
  blogContent?: string
  introContent?: string
}

interface EpisodeListResponse {
  items?: EpisodeListItem[]
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
  error?: string
}

const PAGE_SIZE = 10

function confirmAction(message: string) {
  // eslint-disable-next-line no-alert -- admin confirmation dialog
  return globalThis.confirm(message)
}

function getEpisodeSortTime(item: EpisodeListItem): number {
  if (item.publishedAt) {
    const publishedAt = Date.parse(item.publishedAt)
    if (!Number.isNaN(publishedAt)) {
      return publishedAt
    }
  }

  const dateValue = Date.parse(`${item.date}T00:00:00Z`)
  if (!Number.isNaN(dateValue)) {
    return dateValue
  }

  return item.updatedAt ?? 0
}

function sortEpisodes(items: EpisodeListItem[]): EpisodeListItem[] {
  return [...items].sort((left, right) => getEpisodeSortTime(right) - getEpisodeSortTime(left))
}

export function EpisodeManagement() {
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(false)
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeDetail | null>(null)
  const [episodeBusy, setEpisodeBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalEpisodes, setTotalEpisodes] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const loadEpisodes = useCallback(async (page = 1) => {
    setLoadingEpisodes(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/episodes?page=${page}&pageSize=${PAGE_SIZE}`)
      const body = (await response.json()) as EpisodeListResponse
      if (!response.ok || !body.items) {
        throw new Error(body.error || 'Failed to load episodes')
      }
      setEpisodes(sortEpisodes(body.items))
      setCurrentPage(body.page || page)
      setTotalEpisodes(body.total || 0)
      setTotalPages(body.totalPages || 1)
      setSelectedEpisode(prev => (prev && !body.items.some(item => item.date === prev.date) ? null : prev))
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load episodes')
    }
    finally {
      setLoadingEpisodes(false)
    }
  }, [])

  useEffect(() => {
    void loadEpisodes(1)
  }, [loadEpisodes])

  async function openEpisodeEditor(date: string) {
    console.info('[episode-edit] loading', date)
    setEpisodeBusy(true)
    setMessage('')
    try {
      const url = `/api/admin/episodes/${date}`
      console.info('[episode-edit] GET', url)
      const response = await fetch(url)
      console.info('[episode-edit] response status:', response.status)
      const text = await response.text()
      console.info('[episode-edit] response body:', text.slice(0, 300))
      let body: { item?: EpisodeDetail, error?: string }
      try {
        body = JSON.parse(text)
      }
      catch {
        throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 100)}`)
      }
      if (!response.ok || !body.item) {
        throw new Error(body.error || `Failed to load episode details (${response.status})`)
      }
      setSelectedEpisode(body.item)
    }
    catch (error) {
      console.error('[episode-edit] ERROR:', error)
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
      setEpisodes(prev => sortEpisodes(prev.map(item => item.date === nextItem.date
        ? {
            date: nextItem.date,
            title: nextItem.title,
            publishedAt: nextItem.publishedAt,
            updatedAt: nextItem.updatedAt,
            audio: nextItem.audio,
          }
        : item)))
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
    setEpisodeBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/episodes/${date}`, {
        method: 'DELETE',
      })
      const body = (await response.json()) as { ok?: boolean, error?: string }
      if (!response.ok || !body.ok) {
        throw new Error(body.error || 'Delete failed')
      }
      if (selectedEpisode?.date === date) {
        setSelectedEpisode(null)
      }
      const nextPage = episodes.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage
      await loadEpisodes(nextPage)
      setMessage(`Deleted ${date}`)
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : 'Delete failed')
    }
    finally {
      setEpisodeBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Episode Management</h2>
          <p className="text-sm text-gray-500">
            Page
            {' '}
            {currentPage}
            {' '}
            of
            {' '}
            {totalPages}
            {' '}
            ·
            {' '}
            {totalEpisodes}
            {' '}
            episodes total
          </p>
        </div>
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => void loadEpisodes(currentPage)}
          disabled={loadingEpisodes || episodeBusy}
        >
          {loadingEpisodes ? 'Loading...' : 'Refresh episode list'}
        </button>
      </div>

      <ul className="space-y-2">
        {episodes.map(item => (
          <Fragment key={item.date}>
            <li
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
                  disabled={episodeBusy}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs text-red-700"
                  onClick={() => deleteEpisode(item.date)}
                  disabled={episodeBusy}
                >
                  Delete
                </button>
              </div>
            </li>

            {selectedEpisode?.date === item.date
              ? (
                  <li className="rounded border border-t-0 p-4">
                    <div className="space-y-3">
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
                        className={`
                          rounded bg-black px-3 py-1.5 text-sm text-white
                        `}
                        onClick={saveEpisode}
                        disabled={episodeBusy}
                      >
                        {episodeBusy ? 'Saving...' : 'Save episode changes'}
                      </button>
                    </div>
                  </li>
                )
              : null}
          </Fragment>
        ))}
      </ul>

      <div
        className={`
          flex items-center justify-between gap-3 border-t pt-4 text-sm
        `}
      >
        <button
          type="button"
          className="rounded border px-3 py-1.5"
          onClick={() => void loadEpisodes(currentPage - 1)}
          disabled={loadingEpisodes || episodeBusy || currentPage <= 1}
        >
          Previous
        </button>

        <p className="text-gray-500">
          Showing
          {' '}
          {episodes.length}
          {' '}
          items per page
        </p>

        <button
          type="button"
          className="rounded border px-3 py-1.5"
          onClick={() => void loadEpisodes(currentPage + 1)}
          disabled={loadingEpisodes || episodeBusy || currentPage >= totalPages}
        >
          Next
        </button>
      </div>

      {message ? <p className="text-sm">{message}</p> : null}
    </section>
  )
}
