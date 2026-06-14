import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useDossierStore, useReminderStore } from '@renderer/stores'
import { GENERAL_EVENT_DOSSIER_ID } from '@renderer/stores/dossierStore'

import { scanDueReminders, type DueReminder, type ReminderScanEntry } from './reminderScan'

/** Re-scan cadence. Catches day-boundary crossings without a hard refresh. */
const REMINDER_SCAN_INTERVAL_MS = 30 * 60 * 1000

/** Hard cap on individual notifications per scan; the rest collapse to a summary. */
const MAX_INDIVIDUAL_NOTIFICATIONS = 5

function leadDaysLabel(reminder: DueReminder, t: ReturnType<typeof useTranslation>['t']): string {
  if (reminder.leadDays === 0) {
    return t('reminders.notification_body_today', { defaultValue: "Aujourd'hui" })
  }
  if (reminder.leadDays === 1) {
    return t('reminders.notification_body_tomorrow', { defaultValue: 'Demain' })
  }
  return t('reminders.notification_body_in_days', {
    count: reminder.leadDays,
    defaultValue: 'Dans {{count}} jours'
  })
}

/**
 * Watches the aggregated chronology and surfaces native OS notifications for
 * upcoming key dates, according to the user's reminder preferences. Each
 * reminder fires at most once per lead-time bucket per day (deduped in the
 * reminder store), so re-scans and app relaunches stay quiet.
 */
export function useDeadlineReminders(): void {
  const { t } = useTranslation()
  const chronologyEntries = useDossierStore((state) => state.chronologyEntries)

  const runScan = useCallback(() => {
    const { preferences, hasNotified, markNotified, notify } = useReminderStore.getState()
    if (!preferences.enabled) return

    const entries = useDossierStore.getState().chronologyEntries
    if (!entries || entries.length === 0) return

    const scanEntries: ReminderScanEntry[] = entries.map((entry) => ({
      dossierId: entry.dossierId,
      dossierName: entry.dossierName,
      keyDate: entry.keyDate
    }))

    const due = scanDueReminders(scanEntries, preferences, new Date())
    const fresh = due.filter((reminder) => !hasNotified(reminder.dedupeKey))
    if (fresh.length === 0) return

    // Mark everything up-front so a re-entrant scan can't double-fire.
    for (const reminder of fresh) markNotified(reminder.dedupeKey)

    if (fresh.length <= MAX_INDIVIDUAL_NOTIFICATIONS) {
      for (const reminder of fresh) {
        const isGeneral = reminder.dossierId === GENERAL_EVENT_DOSSIER_ID
        void notify({
          title: isGeneral
            ? t('reminders.notification_title_general', {
                defaultValue: 'Échéance — Hors dossier'
              })
            : t('reminders.notification_title', {
                dossier: reminder.dossierName,
                defaultValue: 'Échéance — {{dossier}}'
              }),
          body: `${reminder.label} · ${leadDaysLabel(reminder, t)}`,
          dossierId: isGeneral ? undefined : reminder.dossierId
        })
      }
      return
    }

    // Too many at once — collapse into a single summary that opens the home view.
    void notify({
      title: t('reminders.notification_summary_title', {
        count: fresh.length,
        defaultValue: '{{count}} échéances à venir'
      }),
      body: t('reminders.notification_summary_body', {
        defaultValue: 'Ouvrez Ordicab pour voir vos échéances.'
      })
    })
  }, [t])

  // Initial scan once the chronology has loaded, plus whenever it changes.
  useEffect(() => {
    if (!chronologyEntries) return
    runScan()
  }, [chronologyEntries, runScan])

  // Periodic re-scan to catch day-boundary crossings while the app stays open.
  const runScanRef = useRef(runScan)
  useEffect(() => {
    runScanRef.current = runScan
  }, [runScan])
  useEffect(() => {
    const timer = setInterval(() => runScanRef.current(), REMINDER_SCAN_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])
}
