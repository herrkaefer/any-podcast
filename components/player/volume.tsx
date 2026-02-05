'use client'

import { MuteButton, Tooltip, useMediaState, VolumeSlider } from '@vidstack/react'
import { Volume2, VolumeIcon, VolumeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function Mute() {
  const { t } = useTranslation()
  const volume = useMediaState('volume')
  const isMuted = useMediaState('muted')

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <MuteButton className={`
          group ring-media-focus relative inline-flex h-10 w-10 cursor-pointer
          items-center justify-center rounded-md outline-none ring-inset
          hover:bg-white/20
          data-[focus]:ring-4
        `}
        >
          {isMuted || volume === 0
            ? (
                <VolumeOff className="size-5" />
              )
            : volume < 0.5
              ? (
                  <VolumeIcon className="size-5" />
                )
              : (
                  <Volume2 className="size-5" />
                )}
        </MuteButton>
      </Tooltip.Trigger>
      <Tooltip.Content className={`
        parent-data-[open]:hidden
        z-10 animate-out rounded-sm bg-black/90 px-2 py-0.5 text-sm font-medium
        text-white fade-out slide-out-to-bottom-2
        data-[visible]:animate-in data-[visible]:fade-in
        data-[visible]:slide-in-from-bottom-4
      `}
      >
        {isMuted ? t('player.unmute') : t('player.mute')}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function Volume() {
  return (
    <VolumeSlider.Root className={`
      volume-slider group relative mx-2 inline-flex h-10 w-32 cursor-pointer
      touch-none items-center outline-none select-none
      aria-hidden:hidden
    `}
    >
      <VolumeSlider.Track className={`
        ring-media-focus relative z-0 h-1 w-full rounded-sm bg-black/40
        transition-colors
        group-data-[focus]:ring-[3px]
        dark:bg-white/40
      `}
      >
        <VolumeSlider.TrackFill className={`
          absolute h-full w-[var(--slider-fill)] rounded-sm bg-gradient-to-r
          from-black to-black/40 transition-[width] duration-200
          will-change-[width]
          dark:from-white dark:to-white/40
        `}
        />
      </VolumeSlider.Track>

      <VolumeSlider.Preview
        className={`
          pointer-events-none flex -translate-y-4 flex-col items-center
          opacity-0 transition-opacity duration-200
          data-[visible]:opacity-100
        `}
        noClamp
      >
        <VolumeSlider.Value className={`
          rounded-sm border bg-white px-2 py-px text-[13px] font-medium
          text-black
          dark:bg-black dark:text-white
        `}
        />
      </VolumeSlider.Preview>
      <VolumeSlider.Thumb className={`
        absolute top-1/2 left-[var(--slider-fill)] z-20 h-4 w-4 -translate-x-1/2
        -translate-y-1/2 rounded-full border border-gray-300 bg-white opacity-0
        shadow-md ring-white/40 transition-all duration-200 will-change-[left]
        group-data-[active]:opacity-100
        group-data-[dragging]:bg-gray-100 group-data-[dragging]:ring-4
      `}
      />
    </VolumeSlider.Root>
  )
}
