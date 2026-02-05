import { Store } from '@tanstack/store'

export type Theme = 'light' | 'dark' | 'system'

export interface ThemeStoreState {
  theme: Theme
  storageKey: string
}

let themeStore: Store<ThemeStoreState> | null = null

function createThemeStore(defaultTheme: Theme, storageKey: string) {
  const getInitialTheme = (): Theme => {
    if (typeof window === 'undefined') {
      return defaultTheme
    }
    try {
      const stored = localStorage.getItem(storageKey) as Theme | null
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored
      }
    }
    catch (error) {
      console.error('Failed to read stored theme', error)
    }
    return defaultTheme
  }

  return new Store<ThemeStoreState>({
    theme: getInitialTheme(),
    storageKey,
  })
}

export function initThemeStore(
  defaultTheme: Theme = 'system',
  storageKey = 'next-ui-theme',
): Store<ThemeStoreState> {
  if (!themeStore) {
    themeStore = createThemeStore(defaultTheme, storageKey)
  }
  return themeStore
}

export function getThemeStore(): Store<ThemeStoreState> {
  if (!themeStore) {
    throw new Error('Theme store has not been initialized')
  }
  return themeStore
}
