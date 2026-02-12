'use client'

import { useStore } from '@tanstack/react-store'
import { Settings } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemeToggle } from '@/components/theme/toggle'
import { getPodcastStore } from '@/stores/podcast-store'

export function PodcastAside() {
  const { t } = useTranslation()
  const podcastStore = getPodcastStore()
  const podcastInfo = useStore(podcastStore, state => state.podcastInfo)
  const hosts = podcastInfo?.hosts || []

  return (
    <aside className={`
      flex h-full flex-col items-center justify-between px-4 py-8
    `}
    >
      <section className={`
        sticky top-0 flex items-center gap-6 py-4 whitespace-nowrap
        [writing-mode:vertical-rl]
      `}
      >
        <span className="font-mono text-muted-foreground">{t('aside.hostedBy')}</span>
        <span className="flex gap-6 font-bold">
          {hosts.map((host, index) => (
            <Fragment key={host.name}>
              {index !== 0 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
              )}
              <span>{host.name}</span>
            </Fragment>
          ))}
        </span>
      </section>
      <section className="flex flex-col items-center gap-5">
        <Link
          href="/admin"
          className={`
            cursor-pointer text-muted-foreground transition-colors
            hover:text-foreground
          `}
          title={t('aside.adminLinkTitle')}
          aria-label={t('aside.adminLinkTitle')}
        >
          <Settings className="size-6" />
        </Link>
        <ThemeToggle />
      </section>
    </aside>
  )
}
