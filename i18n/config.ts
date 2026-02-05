export type Locale = 'zh'

export const locales: Locale[] = ['zh']

export const defaultLocale: Locale = 'zh'

export const localeNames: Record<Locale, string> = {
  zh: '中文',
}

export function isValidLocale(locale: string): locale is Locale {
  return locale === 'zh'
}

export function detectLocale(_acceptLanguage?: string | null): Locale {
  return defaultLocale
}
