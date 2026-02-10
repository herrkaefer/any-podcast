'use client'

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { defaultLocale, locales } from '@/i18n/config'
import enTranslations from '@/messages/en.json'
import zhTranslations from '@/messages/zh.json'

const resources = {
  en: {
    translation: enTranslations,
  },
  zh: {
    translation: zhTranslations,
  },
}

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: defaultLocale,
      fallbackLng: 'en',
      supportedLngs: locales,
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    })
}

export default i18n
