import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from '@shared/i18n/locales/en.json'
import fr from '@shared/i18n/locales/fr.json'

const SUPPORTED_LOCALES = ['en', 'fr'] as const

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

const resources = {
  en: { translation: en },
  fr: { translation: fr }
} as const

export function normalizeAppLocale(locale: string | null | undefined): SupportedLocale {
  if (typeof locale !== 'string') {
    return 'en'
  }

  const normalized = locale.trim().toLowerCase()
  for (const supported of SUPPORTED_LOCALES) {
    if (normalized.startsWith(supported)) {
      return supported
    }
  }

  return 'en'
}

export async function createRendererI18n(
  locale: SupportedLocale | string = 'en'
): Promise<typeof i18n> {
  const normalizedLocale = normalizeAppLocale(locale)

  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng: normalizedLocale,
      fallbackLng: 'en',
      supportedLngs: [...SUPPORTED_LOCALES],
      interpolation: {
        escapeValue: false
      },
      returnNull: false
    })

    return i18n
  }

  if (i18n.resolvedLanguage !== normalizedLocale) {
    await i18n.changeLanguage(normalizedLocale)
  }

  return i18n
}

export { i18n }
