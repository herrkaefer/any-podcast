import type { PodcastInfo } from '@/types/podcast'
import { Store } from '@tanstack/store'

export interface PodcastStoreState {
  podcastInfo: PodcastInfo | null
}

let podcastStore: Store<PodcastStoreState> | null = null

function createStore() {
  return new Store<PodcastStoreState>({
    podcastInfo: null,
  })
}

export function initPodcastStore(): Store<PodcastStoreState> {
  if (!podcastStore) {
    podcastStore = createStore()
  }
  return podcastStore
}

export function getPodcastStore(): Store<PodcastStoreState> {
  if (!podcastStore) {
    throw new Error('Podcast store has not been initialized')
  }
  return podcastStore
}

export function setPodcastInfo(info: PodcastInfo) {
  const store = getPodcastStore()
  store.setState(() => ({ podcastInfo: info }))
}
