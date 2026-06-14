import { safeLocalStorageGet, safeLocalStorageSet } from '@renderer/stores/ipc'

import {
  CALENDAR_VIEW_MODES,
  SURFACE_VIEWS,
  type CalendarViewMode,
  type SurfaceView
} from './calendarTypes'

/**
 * Granularité calendrier partagée entre toutes les surfaces : la préférence
 * de l'utilisateur (ex. « toujours en mensuel ») s'applique partout.
 */
const CAL_MODE_STORAGE_KEY = 'ordicab.chronology.calMode'

export function getStoredCalendarMode(): CalendarViewMode | null {
  const value = safeLocalStorageGet(CAL_MODE_STORAGE_KEY)
  return CALENDAR_VIEW_MODES.includes(value as CalendarViewMode)
    ? (value as CalendarViewMode)
    : null
}

export function setStoredCalendarMode(mode: CalendarViewMode): void {
  safeLocalStorageSet(CAL_MODE_STORAGE_KEY, mode)
}

export function getStoredSurfaceView(storageKey: string): SurfaceView | null {
  const value = safeLocalStorageGet(storageKey)
  return SURFACE_VIEWS.includes(value as SurfaceView) ? (value as SurfaceView) : null
}

export function setStoredSurfaceView(storageKey: string, view: SurfaceView): void {
  safeLocalStorageSet(storageKey, view)
}
