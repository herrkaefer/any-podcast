'use client'

import { PodcastAside } from '@/components/podcast/aside'
import { PodcastInfo } from '@/components/podcast/info'

interface PodcastLayoutProps {
  children: React.ReactNode
}

export function PodcastLayout({ children }: PodcastLayoutProps) {
  return (
    <div className={`
      flex min-h-screen flex-col
      md:fixed md:inset-0 md:flex-row md:overflow-hidden md:bg-background
    `}
    >
      <aside className={`
        hidden h-full w-16 shrink-0 flex-col overflow-y-auto
        overscroll-y-contain border-r border-border
        md:flex
      `}
      >
        <PodcastAside />
      </aside>

      <section className={`
        flex flex-col border-b border-border
        md:h-full md:w-80 md:shrink-0 md:overflow-y-auto md:overscroll-y-contain
        md:border-r md:border-b-0
        lg:w-96
      `}
      >
        <PodcastInfo />
      </section>

      <main
        id="main-scroll-container"
        className={`
          flex flex-1 flex-col pb-28
          md:overflow-y-auto md:overscroll-y-contain
        `}
      >
        {children}
      </main>
    </div>
  )
}
