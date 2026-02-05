'use client'

import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'
import { getUIStore, setEpisodeFullscreen, toggleEpisodeFullscreen } from '@/stores/ui-store'

interface UseEpisodeFullscreenOptions {
  manageBodyLock?: boolean
  resetOnMount?: boolean
}

export function useEpisodeFullscreen({ manageBodyLock = false, resetOnMount = false }: UseEpisodeFullscreenOptions = {}) {
  const uiStore = getUIStore()
  const isFullscreen = useStore(uiStore, state => state.isEpisodeFullscreen)

  useEffect(() => {
    if (!resetOnMount)
      return

    setEpisodeFullscreen(false)

    return () => {
      setEpisodeFullscreen(false)
    }
  }, [resetOnMount])

  useEffect(() => {
    if (!manageBodyLock)
      return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEpisodeFullscreen(false)
      }
    }

    if (isFullscreen) {
      document.body.classList.add('episode-fullscreen-locked')
      document.addEventListener('keydown', handleKeyDown)
    }
    else {
      document.body.classList.remove('episode-fullscreen-locked')
    }

    return () => {
      document.body.classList.remove('episode-fullscreen-locked')
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFullscreen, manageBodyLock])

  const enterFullscreen = () => setEpisodeFullscreen(true)
  const exitFullscreen = () => setEpisodeFullscreen(false)
  const toggleFullscreenState = () => toggleEpisodeFullscreen()

  return {
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen: toggleFullscreenState,
  }
}
