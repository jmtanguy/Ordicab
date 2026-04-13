import { readFile } from 'node:fs/promises'

import { APP_LOCALES, type AppLocale } from '@shared/types'

import en from '@renderer/i18n/locales/en.json'
import fr from '@renderer/i18n/locales/fr.json'

import { atomicWrite } from '../system/atomicWrite'

interface LocaleStateFile {
  locale?: string
  updatedAt?: string
}

type MainTranslationKey =
  | 'tray.tooltip_default'
  | 'tray.menu_open_window'
  | 'tray.menu_quit_app'
  | 'dialog.select_domain_title'
  | 'menu.app_about'
  | 'menu.app_hide'
  | 'menu.app_hide_others'
  | 'menu.app_show_all'
  | 'menu.edit'
  | 'menu.edit_undo'
  | 'menu.edit_redo'
  | 'menu.edit_cut'
  | 'menu.edit_copy'
  | 'menu.edit_paste'
  | 'menu.edit_select_all'

export interface MainI18nOptions {
  stateFilePath: string
  preferredSystemLanguages: string[]
  now?: () => Date
}

export interface MainI18n {
  getLocale(): AppLocale
  setLocale(locale: AppLocale): Promise<void>
  t(key: MainTranslationKey): string
  getTrayLabels(): {
    tooltip: string
    openWindow: string
    quit: string
  }
}

const resources = {
  en,
  fr
} as const satisfies Record<AppLocale, Record<MainTranslationKey, string>>

function normalizeLocale(locale: string | undefined): AppLocale | null {
  if (typeof locale !== 'string') {
    return null
  }

  const normalized = locale.trim().toLowerCase()
  for (const supported of APP_LOCALES) {
    if (normalized.startsWith(supported)) {
      return supported
    }
  }

  return null
}

async function loadPersistedLocale(stateFilePath: string): Promise<AppLocale | null> {
  try {
    const raw = await readFile(stateFilePath, 'utf8')
    const parsed = JSON.parse(raw) as LocaleStateFile
    return normalizeLocale(parsed.locale)
  } catch {
    return null
  }
}

async function persistLocale(
  stateFilePath: string,
  locale: AppLocale,
  now: () => Date
): Promise<void> {
  const state: LocaleStateFile = {
    locale,
    updatedAt: now().toISOString()
  }
  await atomicWrite(stateFilePath, `${JSON.stringify(state, null, 2)}\n`)
}

export function detectSupportedLocale(preferredSystemLanguages: readonly string[]): AppLocale {
  for (const locale of preferredSystemLanguages) {
    const normalized = normalizeLocale(locale)
    if (normalized) {
      return normalized
    }
  }

  return 'en'
}

export async function createMainI18n(options: MainI18nOptions): Promise<MainI18n> {
  const now = options.now ?? (() => new Date())
  let locale =
    (await loadPersistedLocale(options.stateFilePath)) ??
    detectSupportedLocale(options.preferredSystemLanguages)

  return {
    getLocale(): AppLocale {
      return locale
    },
    async setLocale(nextLocale: AppLocale): Promise<void> {
      locale = nextLocale
      await persistLocale(options.stateFilePath, nextLocale, now)
    },
    t(key: MainTranslationKey): string {
      return resources[locale][key] ?? resources.en[key]
    },
    getTrayLabels() {
      return {
        tooltip: resources[locale]['tray.tooltip_default'],
        openWindow: resources[locale]['tray.menu_open_window'],
        quit: resources[locale]['tray.menu_quit_app']
      }
    }
  }
}
