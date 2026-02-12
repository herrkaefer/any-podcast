'use client'

import type { PodcastInfo } from '@/types/podcast'
import { useStore } from '@tanstack/react-store'
import { PodcastLayout } from '@/components/podcast/layout'
import { getPodcastStore, setPodcastInfo } from '@/stores/podcast-store'

interface PodcastScaffoldProps {
  children: React.ReactNode
  podcastInfo: PodcastInfo
}

function isSamePodcastInfo(left: PodcastInfo | null, right: PodcastInfo) {
  if (!left) {
    return false
  }
  return left.title === right.title
    && left.description === right.description
    && left.link === right.link
    && left.cover === right.cover
    && JSON.stringify(left.platforms) === JSON.stringify(right.platforms)
    && JSON.stringify(left.hosts) === JSON.stringify(right.hosts)
}

export function PodcastScaffold({ children, podcastInfo }: PodcastScaffoldProps) {
  const podcastStore = getPodcastStore()
  const storeInfo = useStore(podcastStore, state => state.podcastInfo)

  if (!isSamePodcastInfo(storeInfo, podcastInfo)) {
    setPodcastInfo(podcastInfo)
  }

  return <PodcastLayout>{children}</PodcastLayout>
}
