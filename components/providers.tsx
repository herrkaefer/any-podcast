'use client'

import type { Locale } from '@/i18n/config'
import { CommandMenu } from '@/components/cmdk/command-menu'
import { LanguageProvider } from '@/components/language/provider'
import { Player } from '@/components/player'
import { ThemeProvider } from '@/components/theme/provider'
import { initPageStore } from '@/stores/page-store'
import { initPlayerStore } from '@/stores/player-store'
import { initPodcastStore } from '@/stores/podcast-store'
import { initThemeStore } from '@/stores/theme-store'
import { initUIStore } from '@/stores/ui-store'

initThemeStore()
initPlayerStore()
initPodcastStore()
initPageStore()
initUIStore()

interface ProvidersProps {
  children: React.ReactNode
  detectedLocale: Locale
}

export function Providers({ children, detectedLocale }: ProvidersProps) {
  return (
    <LanguageProvider language={detectedLocale}>
      <ThemeProvider storageKey="next-ui-theme">
        {children}
        <Player />
        <CommandMenu />
      </ThemeProvider>
    </LanguageProvider>
  )
}
