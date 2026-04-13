/**
 * Renderer entry point — bootstraps the React application inside Electron's
 * BrowserWindow (or a regular browser in dev/test mode).
 *
 * Boot sequence:
 *  1. `resolveInitialLocale` — fetches the user's persisted locale from the
 *     main process via the ordicabAPI bridge before any component renders, so
 *     the very first paint is already in the correct language.
 *     Falls back to 'en' if the bridge is unavailable (e.g. browser/test env).
 *  2. `initializeI18n` — initialises i18next with the resolved locale.
 *  3. React root is created and the component tree is rendered wrapped in
 *     StrictMode and I18nextProvider.
 *
 * The `ordicabAPI` object on `globalThis` is injected by the preload script
 * (src/preload/index.ts) via contextBridge. It is the sole communication
 * channel between this renderer process and the Electron main process.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'

import App from './App'
import { getOrdicabApi } from './stores/ipc'
import { initializeI18n, normalizeAppLocale } from './i18n'
import './styles.css'

async function resolveInitialLocale(): Promise<ReturnType<typeof normalizeAppLocale>> {
  const api = getOrdicabApi()

  if (!api?.app.getLocale) {
    return 'en'
  }

  const result = await api.app.getLocale()
  if (!result.success) {
    return 'en'
  }

  return normalizeAppLocale(result.data.locale)
}

async function boot(): Promise<void> {
  const i18n = await initializeI18n(await resolveInitialLocale())

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </StrictMode>
  )
}

void boot()
