'use client'

import { SeekButton, Tooltip } from '@vidstack/react'
import { SeekBackward15Icon, SeekForward15Icon } from '@vidstack/react/icons'
import { useTranslation } from 'react-i18next'

export function SeekForward() {
  const { t } = useTranslation()

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <SeekButton
          className={`
            relative inline-flex size-8 cursor-pointer items-center
            justify-center rounded-md ring-sky-400 outline-none ring-inset
            hover:bg-white/20
            aria-hidden:hidden
            data-[focus]:ring-4
          `}
          seconds={15}
          data-umami-event="seek-forward"
        >
          <SeekForward15Icon className="size-6" />
        </SeekButton>
      </Tooltip.Trigger>
      <Tooltip.Content className={`
        parent-data-[open]:hidden
        z-10 animate-out rounded-sm bg-black/90 px-2 py-0.5 text-sm font-medium
        text-white fade-out slide-out-to-bottom-2
        data-[visible]:animate-in data-[visible]:fade-in
        data-[visible]:slide-in-from-bottom-4
      `}
      >
        {t('player.seekForward')}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function SeekBackward() {
  const { t } = useTranslation()

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <SeekButton
          className={`
            relative inline-flex size-8 cursor-pointer items-center
            justify-center rounded-md ring-sky-400 outline-none ring-inset
            hover:bg-white/20
            aria-hidden:hidden
            data-[focus]:ring-4
          `}
          seconds={-15}
          data-umami-event="seek-backward"
        >
          <SeekBackward15Icon className="size-6" />
        </SeekButton>
      </Tooltip.Trigger>
      <Tooltip.Content className={`
        parent-data-[open]:hidden
        z-10 animate-out rounded-sm bg-black/90 px-2 py-0.5 text-sm font-medium
        text-white fade-out slide-out-to-bottom-2
        data-[visible]:animate-in data-[visible]:fade-in
        data-[visible]:slide-in-from-bottom-4
      `}
      >
        {t('player.seekBackward')}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
