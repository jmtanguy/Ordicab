import { create } from 'zustand'

import {
  DEFAULT_REMINDER_PREFERENCES,
  KEY_DATE_TAG_VALUES,
  REMINDER_LEAD_DAYS_VALUES,
  type KeyDateTag,
  type NotificationClickedEvent,
  type NotifyInput,
  type OrdicabEventUnsubscribe,
  type ReminderLeadDays,
  type ReminderPreferences
} from '@shared/types'

import { getOrdicabApi, safeLocalStorageGet, safeLocalStorageSet } from './ipc'

const REMINDER_PREFERENCES_STORAGE_KEY = 'reminders-preferences'

function sanitizePreferences(raw: unknown): ReminderPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_REMINDER_PREFERENCES }
  const value = raw as Partial<ReminderPreferences>

  const enabled =
    typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_REMINDER_PREFERENCES.enabled

  const leadDays = Array.isArray(value.leadDays)
    ? ([...new Set(value.leadDays)].filter((d): d is ReminderLeadDays =>
        (REMINDER_LEAD_DAYS_VALUES as readonly number[]).includes(d as number)
      ) as ReminderLeadDays[])
    : [...DEFAULT_REMINDER_PREFERENCES.leadDays]

  const triggerTags = Array.isArray(value.triggerTags)
    ? ([...new Set(value.triggerTags)].filter((tag): tag is KeyDateTag =>
        (KEY_DATE_TAG_VALUES as readonly string[]).includes(tag as string)
      ) as KeyDateTag[])
    : [...DEFAULT_REMINDER_PREFERENCES.triggerTags]

  return { enabled, leadDays, triggerTags }
}

function loadStoredPreferences(): ReminderPreferences {
  const raw = safeLocalStorageGet(REMINDER_PREFERENCES_STORAGE_KEY)
  if (!raw) return { ...DEFAULT_REMINDER_PREFERENCES }
  try {
    return sanitizePreferences(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_REMINDER_PREFERENCES }
  }
}

function persistPreferences(preferences: ReminderPreferences): void {
  safeLocalStorageSet(REMINDER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
}

interface ReminderStoreState {
  preferences: ReminderPreferences
  /** Per-day dedupe keys for reminders already surfaced this session. */
  notifiedKeys: Set<string>
}

interface ReminderStoreActions {
  setPreferences: (preferences: ReminderPreferences) => void
  hasNotified: (dedupeKey: string) => boolean
  markNotified: (dedupeKey: string) => void
  /** Surfaces a native OS notification. No-op when the IPC bridge is absent. */
  notify: (input: NotifyInput) => Promise<void>
  /** Subscribes to native notification clicks. Returns an unsubscribe fn. */
  subscribeToNotificationClicked: (
    listener: (event: NotificationClickedEvent) => void
  ) => OrdicabEventUnsubscribe
}

type ReminderStore = ReminderStoreState & ReminderStoreActions

export const useReminderStore = create<ReminderStore>()((set, get) => ({
  preferences: loadStoredPreferences(),
  notifiedKeys: new Set<string>(),
  setPreferences: (preferences) => {
    const sanitized = sanitizePreferences(preferences)
    persistPreferences(sanitized)
    set({ preferences: sanitized })
  },
  hasNotified: (dedupeKey) => get().notifiedKeys.has(dedupeKey),
  markNotified: (dedupeKey) => {
    set((state) => {
      const next = new Set(state.notifiedKeys)
      next.add(dedupeKey)
      return { notifiedKeys: next }
    })
  },
  notify: async (input) => {
    const api = getOrdicabApi()
    if (!api) return
    await api.app.notify(input)
  },
  subscribeToNotificationClicked: (listener) => {
    const api = getOrdicabApi()
    if (!api || typeof api.app.onNotificationClicked !== 'function') return () => {}
    return api.app.onNotificationClicked(listener)
  }
}))
