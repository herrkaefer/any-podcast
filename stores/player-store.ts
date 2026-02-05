import type { MediaPlayerElement } from 'vidstack'
import type { Episode } from '@/types/podcast'
import { Store } from '@tanstack/store'

export interface PlayerStoreState {
  currentEpisode: Episode | null
  isPlaying: boolean
}

let playerStore: Store<PlayerStoreState> | null = null
let playerInstance: MediaPlayerElement | null = null

function createPlayerStore() {
  return new Store<PlayerStoreState>({
    currentEpisode: null,
    isPlaying: false,
  })
}

export function initPlayerStore(): Store<PlayerStoreState> {
  if (!playerStore) {
    playerStore = createPlayerStore()
  }
  return playerStore
}

export function getPlayerStore(): Store<PlayerStoreState> {
  if (!playerStore) {
    throw new Error('Player store has not been initialized')
  }
  return playerStore
}

export function registerPlayerInstance(instance: MediaPlayerElement) {
  playerInstance = instance
}

export function setCurrentEpisode(episode: Episode) {
  const store = getPlayerStore()
  store.setState(() => ({ currentEpisode: episode, isPlaying: true }))
  if (playerInstance) {
    playerInstance.src = episode.audio.src
  }
}

export function clearPlayerEpisode() {
  const store = getPlayerStore()
  store.setState(() => ({ currentEpisode: null, isPlaying: false }))
}

export function setIsPlaying(isPlaying: boolean) {
  const store = getPlayerStore()
  store.setState(state => ({ ...state, isPlaying }))
}

export function play() {
  const store = getPlayerStore()
  store.setState(state => ({ ...state, isPlaying: true }))
  playerInstance?.play()
}

export function pause() {
  const store = getPlayerStore()
  store.setState(state => ({ ...state, isPlaying: false }))
  playerInstance?.pause()
}
