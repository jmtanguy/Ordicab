import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, DialogShell, Field, Input } from '@renderer/components/ui'
import { useCalendarSyncStore } from '@renderer/stores/calendarSyncStore'

const DEFAULT_SERVER_URL = 'https://caldav.icloud.com'

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${checked ? 'bg-aurora' : 'bg-hairline-strong'}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

export function CalendarSyncDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const status = useCalendarSyncStore((s) => s.status)
  const isSaving = useCalendarSyncStore((s) => s.isSaving)
  const isSyncing = useCalendarSyncStore((s) => s.isSyncing)
  const error = useCalendarSyncStore((s) => s.error)
  const lastRunResult = useCalendarSyncStore((s) => s.lastRunResult)
  const loadStatus = useCalendarSyncStore((s) => s.loadStatus)
  const saveSettings = useCalendarSyncStore((s) => s.saveSettings)
  const deleteCredentials = useCalendarSyncStore((s) => s.deleteCredentials)
  const setOptions = useCalendarSyncStore((s) => s.setOptions)
  const syncNow = useCalendarSyncStore((s) => s.syncNow)
  const subscribeToStatus = useCalendarSyncStore((s) => s.subscribeToStatus)

  const [serverUrl, setServerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (!open) return
    void loadStatus()
    return subscribeToStatus()
  }, [open, loadStatus, subscribeToStatus])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPassword('')
  }, [open])

  if (!open) return null

  const configured = status?.configured ?? false
  const inProgress = isSyncing || (status?.inProgress ?? false)
  const serverValue = serverUrl || status?.serverUrl || ''
  const usernameValue = username || status?.username || ''

  async function handleSave(): Promise<void> {
    const ok = await saveSettings({
      serverUrl: serverValue.trim() || DEFAULT_SERVER_URL,
      username: usernameValue.trim(),
      password: password || undefined
    })
    if (ok) setPassword('')
  }

  const lastSyncLabel = status?.lastSyncAt
    ? new Date(status.lastSyncAt).toLocaleString(i18n.language)
    : t('calendar_sync.never_synced', { defaultValue: 'Jamais synchronisé' })

  return (
    <DialogShell
      aria-label={t('calendar_sync.dialog_aria', { defaultValue: 'Synchronisation calendrier' })}
      size="md"
      panelClassName="max-w-2xl"
    >
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">
          {t('calendar_sync.title', { defaultValue: 'Synchronisation calendrier' })}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink-muted transition hover:bg-parchment-dim hover:text-ink"
          aria-label={t('common.close', { defaultValue: 'Fermer' })}
        >
          ✕
        </button>
      </div>

      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-ink-muted">
          {t('calendar_sync.intro', {
            defaultValue:
              'Les échéances sont publiées dans un calendrier « Ordicab » sur votre compte iCloud (ou tout serveur CalDAV). Votre iPhone ou Android affiche ce calendrier automatiquement. Sens unique : Ordicab écrase les modifications faites sur le téléphone.'
          })}
        </p>

        <p className="rounded-lg border border-warning-border bg-warning-tint px-3 py-2 text-xs text-warning-deep">
          {t('calendar_sync.storage_notice', {
            defaultValue:
              'Pour iCloud, utilisez un « mot de passe d’application » généré sur account.apple.com (rubrique Connexion et sécurité). Les identifiants sont stockés localement et chiffrés, jamais dans les dossiers Ordicab.'
          })}
        </p>

        <Field label={t('calendar_sync.server_label', { defaultValue: 'Serveur CalDAV' })}>
          <Input
            value={serverValue}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder={DEFAULT_SERVER_URL}
            disabled={isSaving}
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label={t('calendar_sync.username_label', {
              defaultValue: 'Identifiant (e-mail Apple)'
            })}
          >
            <Input
              value={usernameValue}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="prenom.nom@icloud.com"
              disabled={isSaving}
            />
          </Field>
          <Field
            label={t('calendar_sync.password_label', {
              defaultValue: 'Mot de passe d’application'
            })}
          >
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={configured ? '••••••••' : 'xxxx-xxxx-xxxx-xxxx'}
              disabled={isSaving}
            />
          </Field>
        </div>

        {configured ? (
          <div className="flex items-center justify-between rounded-xl border border-hairline-strong bg-parchment p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-ink">
                {t('calendar_sync.enabled_label', { defaultValue: 'Synchronisation active' })}
              </span>
              <span className="text-xs text-ink-muted">
                {t('calendar_sync.last_sync', {
                  date: lastSyncLabel,
                  defaultValue: 'Dernière synchronisation : {{date}}'
                })}
              </span>
            </div>
            <ToggleSwitch
              checked={status?.enabled ?? false}
              onChange={(next) => void setOptions({ enabled: next })}
              ariaLabel={t('calendar_sync.enabled_label', {
                defaultValue: 'Synchronisation active'
              })}
            />
          </div>
        ) : null}

        {configured ? (
          <div className="flex items-center justify-between rounded-xl border border-hairline-strong bg-parchment p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-ink">
                {t('calendar_sync.future_only_label', {
                  defaultValue: 'Uniquement les événements à venir'
                })}
              </span>
              <span className="text-xs text-ink-muted">
                {t('calendar_sync.future_only_description', {
                  defaultValue:
                    'Le passé est limité à la semaine en cours ; les événements plus anciens sont retirés du téléphone.'
                })}
              </span>
            </div>
            <ToggleSwitch
              checked={status?.futureOnly ?? true}
              onChange={(next) => void setOptions({ futureOnly: next })}
              ariaLabel={t('calendar_sync.future_only_label', {
                defaultValue: 'Uniquement les événements à venir'
              })}
            />
          </div>
        ) : null}

        {status?.lastError ? (
          <p className="rounded-lg border border-warning-border bg-warning-tint px-3 py-2 text-xs text-warning-deep">
            {status.lastError}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        {lastRunResult ? (
          <p className="text-xs text-ink-muted">
            {t('calendar_sync.run_summary', {
              created: lastRunResult.created,
              updated: lastRunResult.updated,
              deleted: lastRunResult.deleted,
              defaultValue:
                'Synchronisation terminée : {{created}} créé(s), {{updated}} mis à jour, {{deleted}} supprimé(s).'
            })}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {configured ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={inProgress || !status?.enabled}
                  onClick={() => void syncNow()}
                >
                  {inProgress
                    ? t('calendar_sync.syncing_action', { defaultValue: 'Synchronisation…' })
                    : t('calendar_sync.sync_now_action', {
                        defaultValue: 'Synchroniser maintenant'
                      })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isSaving || inProgress}
                  onClick={() => void deleteCredentials()}
                >
                  {t('calendar_sync.delete_credentials_action', {
                    defaultValue: 'Supprimer les identifiants'
                  })}
                </Button>
              </>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.close', { defaultValue: 'Fermer' })}
            </Button>
            <Button
              type="button"
              disabled={isSaving || !usernameValue.trim() || (!configured && !password)}
              onClick={() => void handleSave()}
            >
              {isSaving
                ? t('calendar_sync.connecting_action', { defaultValue: 'Connexion…' })
                : t('common.save', { defaultValue: 'Enregistrer' })}
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  )
}
