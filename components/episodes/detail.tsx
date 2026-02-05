'use client'

import type { Components } from 'react-markdown'

import type { Episode } from '@/types/podcast'
import { useStore } from '@tanstack/react-store'
import { ChevronLeft, Pause, Play } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Waveform } from '@/components/common/waveform'
import { EpisodeFullscreenToggle } from '@/components/episodes/fullscreen-toggle'
import { ImageLightbox, ImageWithLightbox } from '@/components/image-lightbox'
import { useEpisodeFullscreen } from '@/hooks/use-episode-fullscreen'
import { useLightbox } from '@/hooks/use-lightbox'
import { extractImagesFromMarkdown } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { getPageStore } from '@/stores/page-store'
import { getPlayerStore, pause, play, setCurrentEpisode } from '@/stores/player-store'
import '@/styles/episode.css'

interface EpisodeDetailProps {
  episode: Episode
  initialPage?: number
}

interface EpisodeBackLinkProps {
  href: string
  ariaLabel: string
  label: string
  className?: string
}

export function EpisodeDetail({ episode, initialPage }: EpisodeDetailProps) {
  const lightbox = useLightbox()
  const { t } = useTranslation()
  const content = episode.content ?? episode.description ?? ''

  const images = useMemo(() => extractImagesFromMarkdown(content), [content])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    if (typeof initialPage === 'number') {
      const pageStore = getPageStore()
      pageStore.setState(() => ({ currentPage: initialPage }))
    }
  }, [initialPage])

  const externalLinkTitle = t('common.externalLinkTitle')

  const markdownComponents: Partial<Components> = {
    a: ({ href, children }: { href?: string, children?: React.ReactNode }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`
          font-medium text-theme underline transition-colors
          hover:text-theme-hover
        `}
        title={externalLinkTitle}
        aria-label={externalLinkTitle}
      >
        {children}
      </a>
    ),
    img: ({ src, alt }: { src?: string, alt?: string }) => {
      if (!src)
        return null
      const index = images.findIndex(img => img.src === src)
      return (
        <ImageWithLightbox
          src={src}
          alt={alt}
          index={index >= 0 ? index : 0}
          onOpen={lightbox.open}
        />
      )
    },
  }

  return (
    <>
      <EpisodeDetailContent
        episode={episode}
        initialPage={initialPage}
        markdownComponents={markdownComponents}
      />
      <ImageLightbox
        images={images}
        open={lightbox.isOpen}
        index={lightbox.currentIndex}
        onClose={lightbox.close}
        onViewChange={lightbox.setIndex}
      />
    </>
  )
}

interface EpisodeDetailContentProps extends EpisodeDetailProps {
  markdownComponents: Partial<Components>
}

function EpisodeDetailContent({ episode, markdownComponents, initialPage }: EpisodeDetailContentProps) {
  const { t, i18n } = useTranslation()
  const publishedDate = new Date(episode.published)
  const isoPublishedDate = publishedDate.toISOString()
  const headlineId = useId()
  const pageStore = getPageStore()
  const currentPage = useStore(pageStore, state => state.currentPage)
  const playerStore = getPlayerStore()
  const currentEpisode = useStore(playerStore, state => state.currentEpisode)
  const isPlaying = useStore(playerStore, state => state.isPlaying)
  const { isFullscreen } = useEpisodeFullscreen({ manageBodyLock: true, resetOnMount: true })

  const isCurrentEpisodePlaying = currentEpisode?.id === episode.id && isPlaying

  const handlePlayPause = () => {
    if (isCurrentEpisodePlaying) {
      pause()
    }
    else if (currentEpisode?.id === episode.id) {
      play()
    }
    else {
      setCurrentEpisode(episode)
    }
  }

  const resolvedPage = initialPage ?? currentPage
  const href = resolvedPage > 1 ? `/?page=${resolvedPage}` : '/'
  const articlePath = `/episode/${episode.id}`
  const backLinkTitle = t('episodes.backLinkTitle')
  const detailHeaderClass = cn(
    `
      -mx-4 flex items-center gap-4 border-b border-border/60 px-4 py-6
      md:-mx-10 md:gap-6 md:px-10 md:py-8
      lg:-mx-20 lg:px-20
    `,
    isFullscreen
      ? `
        relative top-auto z-10 bg-background pt-0 shadow-none
        md:top-auto md:pt-0
      `
      : `
        sticky top-14 z-20 bg-background/95 backdrop-blur
        supports-[backdrop-filter]:bg-background/80
        md:top-24
      `,
  )

  return (
    <section
      className={cn(
        'flex w-full flex-col',
        isFullscreen && 'episode-fullscreen',
      )}
      aria-labelledby={headlineId}
      data-fullscreen={isFullscreen}
    >
      <header className={`
        episode-page-header sticky top-0 z-10 border-b border-border
        bg-background/95 backdrop-blur-md
        md:backdrop-blur-0 md:bg-background
      `}
      >
        <div className={`
          flex h-14 w-full items-center justify-center px-4
          md:hidden
        `}
        >
          <EpisodeBackLink
            href={href}
            ariaLabel={backLinkTitle}
            label={t('episodes.back')}
            className="justify-center text-sm"
          />
        </div>
        <div className={`
          relative hidden h-24 w-full items-center
          md:flex
        `}
        >
          <Waveform className="absolute inset-0 h-full w-full" aria-hidden="true" />
          <nav
            aria-label={backLinkTitle}
            className="absolute inset-0 flex items-center"
          >
            <EpisodeBackLink
              href={href}
              ariaLabel={backLinkTitle}
              label={t('episodes.back')}
              className={`
                px-10 text-base
                lg:px-20
              `}
            />
          </nav>
        </div>
      </header>

      <article
        className={cn(`
          px-4 py-8
          md:px-10 md:py-16
          lg:px-20
        `, isFullscreen && `mx-auto w-full max-w-5xl`)}
        itemScope
        itemType="https://schema.org/Article"
        aria-labelledby={headlineId}
      >
        <meta itemProp="url" content={articlePath} />
        <meta itemProp="inLanguage" content={i18n.language} />
        <header className={detailHeaderClass}>
          <button
            type="button"
            onClick={handlePlayPause}
            className={cn(
              `
                group mt-2 flex h-14 w-14 flex-shrink-0 items-center
                justify-center rounded-full bg-theme
              `,
              `
                shadow-lg shadow-theme/20 transition-all
                hover:scale-105 hover:bg-theme-hover hover:shadow-xl
                hover:shadow-theme/30
              `,
              `
                cursor-pointer
                focus:ring-2 focus:ring-theme focus:ring-offset-2
                focus:outline-none
                md:h-18 md:w-18
              `,
            )}
            aria-label={isCurrentEpisodePlaying ? t('episodes.pauseEpisode') : t('episodes.playEpisode')}
          >
            {isCurrentEpisodePlaying
              ? (
                  <Pause className={`
                    h-6 w-6 fill-white text-white
                    md:h-8 md:w-8
                  `}
                  />
                )
              : (
                  <Play className={`
                    h-6 w-6 fill-white text-white
                    md:h-8 md:w-8
                  `}
                  />
                )}
          </button>

          <div className="flex w-full items-start gap-4">
            <div className="flex min-w-0 flex-1 flex-col">
              <h1
                id={headlineId}
                className={`
                  mt-2 text-2xl font-bold break-words text-foreground
                  md:text-4xl
                `}
                itemProp="headline"
              >
                {episode.title}
              </h1>
              <time
                className={`
                  order-first font-mono text-xs leading-7 text-muted-foreground
                  md:text-sm
                `}
                dateTime={isoPublishedDate}
                itemProp="datePublished"
              >
                {publishedDate.toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </time>
            </div>
            <EpisodeFullscreenToggle className="flex-shrink-0 self-center" />
          </div>
        </header>

        <div
          className={cn(
            `
              episode-content text-[1.05rem] leading-[1.85]
              md:text-[1.1rem] md:leading-[1.95]
            `,
            'tracking-wide',
          )}
          itemProp="articleBody"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {episode.content ?? episode.description ?? ''}
          </ReactMarkdown>
        </div>
      </article>
    </section>
  )
}

function EpisodeBackLink({ href, ariaLabel, label, className }: EpisodeBackLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        `
          flex w-full items-center gap-2 text-foreground transition-colors
          hover:text-muted-foreground
        `,
        className,
      )}
      title={ariaLabel}
      aria-label={ariaLabel}
    >
      <ChevronLeft className="size-4" />
      <span className="font-bold">{label}</span>
    </Link>
  )
}
