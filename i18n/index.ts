'use client'

import type { Locale } from '@/i18n/config'
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { defaultLocale, locales } from '@/i18n/config'
import zhTranslations from '@/messages/zh.json'

const resources = {
  zh: {
    translation: zhTranslations,
  },
}

const languageDetectorOptions = {
  order: ['localStorage', 'navigator', 'htmlTag'],
  lookupLocalStorage: 'i18nextLng',
  caches: ['localStorage'],
  excludeCacheFor: ['cimode'],
  convertDetectedLanguage: (_lng: string): Locale => {
    return 'zh'
  },
}

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: defaultLocale,
      supportedLngs: locales,
      detection: languageDetectorOptions,
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    })
}

export default i18n
