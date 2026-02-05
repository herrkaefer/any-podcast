'use client'

import { Github } from 'lucide-react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemeToggle } from '@/components/theme/toggle'
import { externalLinks, podcast } from '@/config'

export function PodcastAside() {
  const { t } = useTranslation()

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
          {podcast.hosts.map((host, index) => (
            <Fragment key={host.name}>
              {index !== 0 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
              )}
              <a
                href={host.link}
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-pointer"
                title={t('aside.hostLinkTitle', { name: host.name })}
                aria-label={t('aside.hostLinkTitle', { name: host.name })}
              >
                {host.name}
              </a>
            </Fragment>
          ))}
        </span>
      </section>
      <section className="flex flex-col items-center gap-5">
        <a
          href={externalLinks.github}
          target="_blank"
          rel="noopener noreferrer"
          className="cursor-pointer"
          title={t('aside.githubLinkTitle')}
          aria-label={t('aside.githubLinkTitle')}
        >
          <Github className="size-6" />
        </a>
        <ThemeToggle />
      </section>
    </aside>
  )
}
