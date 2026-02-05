'use client'

import type { TooltipPlacement } from '@vidstack/react'
import { PlayButton, Tooltip, useMediaState } from '@vidstack/react'
import { PauseIcon, PlayIcon } from '@vidstack/react/icons'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface MediaButtonProps {
  tooltipPlacement: TooltipPlacement
  className?: string
}

export function Play({ tooltipPlacement, className }: MediaButtonProps) {
  const { t } = useTranslation()
  const isPaused = useMediaState('paused')

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <PlayButton
          className={cn(
            `
              group ring-media-focus relative inline-flex size-12 cursor-pointer
              items-center justify-center rounded-full bg-[#262626] text-white
              outline-none ring-inset
              data-[focus]:ring-4
              dark:bg-white dark:text-black
            `,
            className,
          )}
          data-umami-event="episode-audio-play"
        >
          {isPaused
            ? <PlayIcon className="size-6" />
            : (
                <PauseIcon className="size-6" />
              )}
        </PlayButton>
      </Tooltip.Trigger>
      <Tooltip.Content
        className={`
          parent-data-[open]:hidden
          z-10 animate-out rounded-sm bg-black/90 px-2 py-0.5 text-sm
          font-medium text-white fade-out slide-out-to-bottom-2
          data-[visible]:animate-in data-[visible]:fade-in
          data-[visible]:slide-in-from-bottom-4
        `}
        placement={tooltipPlacement}
      >
        {isPaused ? t('player.play') : t('player.pause')}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
