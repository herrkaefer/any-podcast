'use client'

import { Maximize2, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useEpisodeFullscreen } from '@/hooks/use-episode-fullscreen'
import { cn } from '@/lib/utils'

interface EpisodeFullscreenToggleProps {
  className?: string
}

export function EpisodeFullscreenToggle({ className }: EpisodeFullscreenToggleProps) {
  const { t } = useTranslation()
  const { isFullscreen, toggleFullscreen } = useEpisodeFullscreen()
  const label = isFullscreen ? t('episodes.exitFullscreen') : t('episodes.enterFullscreen')

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={toggleFullscreen}
      aria-label={label}
      title={label}
      className={cn(
        `
          h-10 w-10 rounded-full border border-border/80 text-muted-foreground
          hover:border-theme hover:text-theme
          md:h-12 md:w-12
        `,
        isFullscreen && `
          border-theme text-theme
          hover:text-theme-hover
        `,
        className,
      )}
    >
      {isFullscreen
        ? (
            <Minimize2 className={`
              size-4
              md:size-5
            `}
            />
          )
        : (
            <Maximize2 className={`
              size-4
              md:size-5
            `}
            />
          )}
    </Button>
  )
}
