'use client'

import type { PodcastInfo } from '@/types/podcast'
import { useStore } from '@tanstack/react-store'
import { PodcastLayout } from '@/components/podcast/layout'
import { getPodcastStore, setPodcastInfo } from '@/stores/podcast-store'

interface PodcastScaffoldProps {
  children: React.ReactNode
  podcastInfo: PodcastInfo
}

export function PodcastScaffold({ children, podcastInfo }: PodcastScaffoldProps) {
  const podcastStore = getPodcastStore()
  const storeInfo = useStore(podcastStore, state => state.podcastInfo)

  if (!storeInfo || storeInfo.title !== podcastInfo.title) {
    setPodcastInfo(podcastInfo)
  }

  return <PodcastLayout>{children}</PodcastLayout>
}
