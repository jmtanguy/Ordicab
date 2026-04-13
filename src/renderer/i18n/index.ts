import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import fr from './locales/fr.json'

export const SUPPORTED_LOCALES = ['en', 'fr'] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export type TranslationKey = keyof typeof en

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

export const resolveSupportedLocale = normalizeAppLocale
export const initializeI18n = createRendererI18n

export { i18n }
