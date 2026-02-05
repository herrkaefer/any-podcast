'use client'

import type { ReactNode } from 'react'
import type { Episode } from '@/types/podcast'
import { useStore } from '@tanstack/react-store'
import { Pause, Play } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { getPageStore } from '@/stores/page-store'
import { getPlayerStore, pause, play, setCurrentEpisode } from '@/stores/player-store'

interface EpisodeItemProps {
  episode: Episode
}

export function EpisodeItem({ episode }: EpisodeItemProps) {
  const { t, i18n } = useTranslation()
  const pageStore = getPageStore()
  const currentPage = useStore(pageStore, state => state.currentPage)
  const playerStore = getPlayerStore()
  const currentEpisode = useStore(playerStore, state => state.currentEpisode)
  const isPlaying = useStore(playerStore, state => state.isPlaying)

  const isCurrentEpisode = currentEpisode?.id === episode.id
  const isCurrentlyPlaying = isCurrentEpisode && isPlaying

  const handlePlayPause = () => {
    if (isCurrentlyPlaying) {
      pause()
    }
    else if (isCurrentEpisode) {
      play()
    }
    else {
      setCurrentEpisode(episode)
    }
  }

  const publishedDate = new Date(episode.published)
  const dateFormatter = publishedDate.toLocaleDateString(
    i18n.language === 'zh' ? 'zh-CN' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  )
  const isoPublishedDate = publishedDate.toISOString()

  const linkHref = currentPage > 1 ? `/episode/${episode.id}?page=${currentPage}` : `/episode/${episode.id}`
  const episodeLinkTitle = t('episodes.openEpisodeTitle', { title: episode.title })
  const episodeDescriptionTitle = t('episodes.readEpisodeDescription', { title: episode.title })
  const showNotesTitle = t('episodes.showNotesLinkTitle', { title: episode.title })
  const externalLinkTitle = t('common.externalLinkTitle')

  return (
    <li className="list-none">
      <article
        className={cn(
          `
            flex flex-col gap-3 border-b border-border px-4 py-8
            sm:px-6
          `,
          `
            md:px-10 md:py-12
            lg:px-20
          `,
        )}
        itemScope
        itemType="https://schema.org/PodcastEpisode"
      >
        <meta itemProp="url" content={linkHref} />
        <time
          dateTime={isoPublishedDate}
          className={`
            text-xs text-muted-foreground
            md:text-sm
          `}
          itemProp="datePublished"
        >
          {dateFormatter}
        </time>
        <h3 className={`
          text-xl leading-tight font-bold text-foreground
          md:text-2xl
        `}
        >
          <Link
            href={linkHref}
            className={`
              cursor-pointer transition-colors
              hover:text-theme
            `}
            itemProp="url"
            title={episodeLinkTitle}
            aria-label={episodeLinkTitle}
          >
            <span itemProp="name">{episode.title}</span>
          </Link>
        </h3>
        {episode.description && (
          <Link
            href={linkHref}
            className={cn(
              `
                line-clamp-2 cursor-pointer leading-relaxed text-foreground/80
                transition-colors
                hover:text-theme
              `,
              `
                text-sm
                md:text-base
              `,
            )}
            title={episodeDescriptionTitle}
            aria-label={episodeDescriptionTitle}
          >
            <div itemProp="description">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }: { href?: string, children?: ReactNode }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      title={externalLinkTitle}
                      aria-label={externalLinkTitle}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {episode.description}
              </ReactMarkdown>
            </div>
          </Link>
        )}
        <div
          className={cn(
            `
              mt-2 flex flex-wrap items-center font-medium text-theme
              hover:text-theme-hover
            `,
            `
              gap-3 text-xs
              md:gap-4 md:text-sm
            `,
          )}
        >
          <button
            type="button"
            onClick={handlePlayPause}
            className={`
              flex cursor-pointer items-center gap-1.5 font-medium text-theme
              transition-colors
              hover:text-theme-hover
              md:gap-2
            `}
            aria-label={isCurrentlyPlaying ? t('episodes.pauseEpisode') : t('episodes.playEpisode')}
          >
            {isCurrentlyPlaying
              ? (
                  <Pause className={`
                    size-3.5
                    md:size-4
                  `}
                  />
                )
              : (
                  <Play className={`
                    size-3.5
                    md:size-4
                  `}
                  />
                )}
            <span>{isCurrentlyPlaying ? t('episodes.pause') : t('episodes.listen')}</span>
          </button>
          <span className="text-muted-foreground">/</span>
          <Link
            href={linkHref}
            className={`
              cursor-pointer font-medium text-theme
              hover:text-theme-hover
            `}
            title={showNotesTitle}
            aria-label={showNotesTitle}
          >
            {t('episodes.showNotes')}
          </Link>
        </div>
      </article>
    </li>
  )
}
