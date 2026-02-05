'use client'

import type { Theme } from '@/stores/theme-store'
import { useStore } from '@tanstack/react-store'
import { getThemeStore } from '@/stores/theme-store'

export function useTheme() {
  const themeStore = getThemeStore()
  const theme = useStore(themeStore, state => state.theme)

  const setTheme = (newTheme: Theme) => {
    try {
      localStorage.setItem(themeStore.state.storageKey, newTheme)
    }
    catch (error) {
      console.error('Failed to persist theme', error)
    }

    themeStore.setState(state => ({ ...state, theme: newTheme }))
  }

  return { theme, setTheme }
}
