'use client'

import type { MediaPlayerInstance } from '@vidstack/react'
import { useStore } from '@tanstack/react-store'
import {
  MediaPlayer,

  MediaProvider,
  useMediaPlayer,
  useMediaState,
} from '@vidstack/react'
import { useEffect, useRef } from 'react'
import { PlayerLayout } from '@/components/player/layout'
import { useEpisodeFullscreen } from '@/hooks/use-episode-fullscreen'
import { cn } from '@/lib/utils'
import { getPlayerStore, registerPlayerInstance, setIsPlaying } from '@/stores/player-store'

function PlayerContent() {
  const player = useMediaPlayer()
  const playerStore = getPlayerStore()
  const currentEpisode = useStore(playerStore, state => state.currentEpisode)
  const isPlaying = useStore(playerStore, state => state.isPlaying)
  const canPlay = useMediaState('canPlay')
  const paused = useMediaState('paused')
  const previousEpisodeRef = useRef(currentEpisode)
  const isEpisodeChanging = useRef(false)

  useEffect(() => {
    if (player) {
      registerPlayerInstance(player)
    }
  }, [player])

  useEffect(() => {
    if (!player)
      return

    const handlePlay = () => {
      if (!isEpisodeChanging.current) {
        setIsPlaying(true)
      }
    }
    const handlePause = () => {
      if (!isEpisodeChanging.current) {
        setIsPlaying(false)
      }
    }
    const handleEnded = () => setIsPlaying(false)

    player.addEventListener('play', handlePlay)
    player.addEventListener('pause', handlePause)
    player.addEventListener('ended', handleEnded)

    return () => {
      player.removeEventListener('play', handlePlay)
      player.removeEventListener('pause', handlePause)
      player.removeEventListener('ended', handleEnded)
    }
  }, [player])

  useEffect(() => {
    if (currentEpisode?.id !== previousEpisodeRef.current?.id) {
      isEpisodeChanging.current = true
      previousEpisodeRef.current = currentEpisode
    }
  }, [currentEpisode])

  useEffect(() => {
    if (!player || !canPlay)
      return
    if (isEpisodeChanging.current) {
      isEpisodeChanging.current = false
    }
    if (isPlaying && player.paused) {
      player.play().catch((error) => {
        console.error('Failed to play:', error)
        setIsPlaying(false)
      })
    }
  }, [player, canPlay, isPlaying])

  useEffect(() => {
    if (!player || !currentEpisode || isEpisodeChanging.current)
      return
    if (isPlaying && player.paused) {
      player.play().catch((error) => {
        console.error('Failed to play:', error)
        setIsPlaying(false)
      })
    }
    else if (!isPlaying && !player.paused) {
      player.pause()
    }
  }, [player, currentEpisode, isPlaying])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat)
        return
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.isContentEditable
      ) {
        return
      }
      event.preventDefault()
      if (player && currentEpisode && canPlay) {
        if (paused) {
          player.play()
        }
        else {
          player.pause()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [player, currentEpisode, paused, canPlay])

  return null
}

export function Player() {
  const playerRef = useRef<MediaPlayerInstance>(null)
  const playerStore = getPlayerStore()
  const currentEpisode = useStore(playerStore, state => state.currentEpisode)
  const { isFullscreen: isEpisodeFullscreen } = useEpisodeFullscreen()
  const hasPlayer = currentEpisode !== null
  const shouldShowPlayer = hasPlayer && !isEpisodeFullscreen

  return (
    <div
      className={cn(
        'episode-player fixed right-0 bottom-0 left-0 z-50',
        isEpisodeFullscreen
          ? `
            md:left-0
            lg:left-0
          `
          : `
            md:left-[24rem]
            lg:left-[28rem]
          `,
        `
          border-t bg-background/95 backdrop-blur
          supports-[backdrop-filter]:bg-background/60
        `,
        'transition-opacity duration-300',
        shouldShowPlayer
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none opacity-0',
      )}
    >
      <MediaPlayer
        ref={playerRef}
        src={currentEpisode?.audio.src || ''}
        viewType="audio"
        streamType="on-demand"
        logLevel="warn"
        playsInline
        title={currentEpisode?.title || ''}
      >
        <MediaProvider />
        <PlayerContent />
        <PlayerLayout />
      </MediaPlayer>
    </div>
  )
}
