'use client'

import type { ComponentType, ReactNode, SVGProps } from 'react'
import type { PodcastInfo as PodcastInfoData } from '@/types/podcast'
import { useStore } from '@tanstack/react-store'
import { Podcast, Rss, Youtube } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Waveform } from '@/components/common/waveform'
import { TinyWaveFormIcon } from '@/components/common/waveform-icon'
import { SpotifyIcon } from '@/components/icons/spotify'
import { XYZIcon } from '@/components/icons/xyz'
import { podcast, site } from '@/config'
import { cn } from '@/lib/utils'
import { getPodcastStore } from '@/stores/podcast-store'

interface PlatformConfig {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  colorClass: string
}

const platformIcons: Record<string, PlatformConfig> = {
  youtube: {
    icon: Youtube,
    colorClass: 'text-red-500 hover:text-red-600',
  },
  apple: {
    icon: Podcast,
    colorClass: 'text-purple-500 hover:text-purple-600',
  },
  rss: {
    icon: Rss,
    colorClass: 'text-orange-500 hover:text-orange-600',
  },
  xiaoyuzhou: {
    icon: XYZIcon,
    colorClass: 'text-[#25b4e1] hover:text-[#25b4e1]',
  },
  spotify: {
    icon: SpotifyIcon,
    colorClass: 'text-green-500 hover:text-green-600',
  },
}

interface PodcastInfoContentProps {
  podcastInfo: PodcastInfoData
}

export function PodcastInfo() {
  const podcastStore = getPodcastStore()
  const podcastInfo = useStore(podcastStore, state => state.podcastInfo)

  if (!podcastInfo) {
    return null
  }

  return <PodcastInfoContent podcastInfo={podcastInfo} />
}

function PodcastInfoContent({ podcastInfo }: PodcastInfoContentProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const titleId = useId()
  const aboutSectionId = useId()
  const listenSectionId = useId()
  const descriptionId = useId()
  const { title, description, cover } = podcastInfo
  const coverAlt = t('podcastInfo.coverAlt', { title })
  const homeLinkTitle = t('podcastInfo.homeLinkTitle', { title })
  const externalLinkTitle = t('common.externalLinkTitle')
  const shouldTruncate = description.length > site.defaultDescriptionLength
  const displayDescription = isExpanded
    ? description
    : shouldTruncate
      ? `${description.slice(0, site.defaultDescriptionLength)}...`
      : description
  const markdownComponents = useMemo(() => ({
    p: ({ children }: { children?: ReactNode }) => (
      <p className="leading-relaxed">{children}</p>
    ),
    a: ({ href, children }: { href?: string, children?: ReactNode }) => (
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
  }), [externalLinkTitle])

  return (
    <article
      className={cn(
        `
          relative flex flex-col gap-8 px-4 pt-16 pb-10
          sm:px-8
        `,
        `
          md:gap-12 md:px-8 md:py-12
          lg:px-12
        `,
      )}
      aria-labelledby={titleId}
      itemScope
      itemType="https://schema.org/PodcastSeries"
    >
      <meta itemProp="url" content={podcast.base.link} />
      <Waveform
        className={`
          absolute inset-x-0 top-0 w-full
          md:hidden
        `}
        aria-hidden="true"
      />

      <figure className={`
        flex justify-center pt-4
        md:pt-0
      `}
      >
        <Link
          href="/"
          aria-label={homeLinkTitle}
          title={homeLinkTitle}
          className={`
            block aspect-square w-40
            md:w-full md:max-w-sm
            lg:max-w-md
          `}
        >
          <Image
            className="h-full w-full rounded-2xl object-cover"
            src={cover}
            alt={coverAlt}
            width={640}
            height={640}
            referrerPolicy="no-referrer"
            itemProp="image"
          />
        </Link>
        <figcaption className="sr-only">{title}</figcaption>
      </figure>

      <h2
        id={titleId}
        className={`
          text-center text-2xl font-bold
          md:text-left md:text-xl
        `}
        itemProp="name"
      >
        {title}
      </h2>

      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-5" aria-labelledby={aboutSectionId}>
          <div
            className={`
              flex items-center justify-center gap-2 font-mono text-xs
              tracking-wide text-muted-foreground uppercase
              md:justify-start md:text-sm md:font-medium md:normal-case
            `}
            id={aboutSectionId}
          >
            <TinyWaveFormIcon
              colors={['fill-violet-300', 'fill-pink-300']}
              className="h-2.5 w-2.5"
              aria-hidden="true"
            />
            <span>{t('podcastInfo.about')}</span>
          </div>

          <div className="flex flex-col gap-2" id={descriptionId} itemProp="description">
            <div className={`
              line-clamp-6
              md:hidden
            `}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {description}
              </ReactMarkdown>
            </div>

            <div className={`
              hidden
              md:flex md:flex-col md:gap-2
            `}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {displayDescription}
              </ReactMarkdown>
              {shouldTruncate && (
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className={`
                    cursor-pointer self-start font-medium text-theme
                    transition-colors
                    hover:text-theme-hover
                  `}
                  aria-expanded={isExpanded}
                  aria-controls={descriptionId}
                >
                  {isExpanded ? t('podcastInfo.showLess') : t('podcastInfo.showMore')}
                </button>
              )}
            </div>
          </div>
        </section>

        {podcast.platforms?.length
          ? (
              <section className="flex flex-col gap-5" aria-labelledby={listenSectionId}>
                <div
                  className={`
                    flex items-center justify-center gap-2 font-mono text-xs
                    tracking-wide text-muted-foreground uppercase
                    md:justify-start md:text-sm md:font-medium md:normal-case
                  `}
                  id={listenSectionId}
                >
                  <TinyWaveFormIcon
                    colors={['fill-indigo-300', 'fill-blue-300']}
                    className="h-2.5 w-2.5"
                    aria-hidden="true"
                  />
                  <span>{t('podcastInfo.listen')}</span>
                </div>

                <ul className={`
                  flex items-center justify-center gap-6
                  md:flex-col md:items-start md:justify-start
                `}
                >
                  {podcast.platforms.map((platform) => {
                    const config = platformIcons[platform.id]
                    if (!config)
                      return null
                    const Icon = config.icon
                    const platformLinkTitle = t('podcastInfo.platformLinkTitle', { platform: platform.name })
                    return (
                      <li key={platform.id} className="list-none">
                        <a
                          href={platform.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`
                            flex cursor-pointer items-center gap-2
                            transition-opacity
                            hover:opacity-80
                          `}
                          aria-label={platformLinkTitle}
                          title={platformLinkTitle}
                          itemProp="sameAs"
                        >
                          <Icon
                            className={cn(`
                              h-8 w-8
                              md:h-6 md:w-6
                            `, config.colorClass)}
                            aria-hidden="true"
                          />
                          <span className={`
                            hidden
                            md:inline
                          `}
                          >
                            {platform.name}
                          </span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          : null}
      </div>

      <div
        className={`
          relative w-full py-4
          md:hidden
        `}
        aria-hidden="true"
      >
        <div className="absolute inset-0 flex items-center">
          <div className={`
            h-px w-full bg-gradient-to-r from-transparent via-border
            to-transparent
          `}
          />
        </div>
      </div>
    </article>
  )
}
