export type Locale = 'en' | 'zh'

export const locales: Locale[] = ['en', 'zh']

export const defaultLocale: Locale = 'en'

export const localeNames: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
}

export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale)
}

export function toLocale(language: string): Locale {
  if (isValidLocale(language)) {
    return language
  }
  const prefix = language.split('-')[0]
  if (isValidLocale(prefix)) {
    return prefix
  }
  return defaultLocale
}
