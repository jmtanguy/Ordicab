import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, DialogShell, Field, Input } from '@renderer/components/ui'
import { useLegalStore } from '@renderer/stores/legalStore'

function maskSuffix(suffix: string | undefined): string {
  return suffix ? `•••••••${suffix}` : ''
}

export function LegalSettingsDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const settings = useLegalStore((s) => s.settings)
  const isLoading = useLegalStore((s) => s.isLoadingSettings)
  const isSaving = useLegalStore((s) => s.isSavingSettings)
  const error = useLegalStore((s) => s.settingsError)
  const connectionStatus = useLegalStore((s) => s.connectionStatus)
  const connection = useLegalStore((s) => s.connection)
  const connectionError = useLegalStore((s) => s.connectionError)
  const loadSettings = useLegalStore((s) => s.loadSettings)
  const saveSettings = useLegalStore((s) => s.saveSettings)
  const deleteCredentials = useLegalStore((s) => s.deleteCredentials)
  const checkConnection = useLegalStore((s) => s.checkConnection)

  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  useEffect(() => {
    if (!open) return
    void loadSettings()
  }, [open, loadSettings])

  if (!open) return null

  const active = settings?.credentials
  const hasCredentials = Boolean(active?.hasClientId && active.hasClientSecret)

  async function handleSave(): Promise<void> {
    const ok = await saveSettings({
      clientId: clientId.trim() || undefined,
      clientSecret: clientSecret.trim() || undefined
    })
    if (ok) onClose()
  }

  return (
    <DialogShell
      aria-label={t('legal_settings.dialog_aria', { defaultValue: 'Paramètres PISTE' })}
      size="lg"
      panelClassName="max-w-[60rem]"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">
          {t('legal_settings.title', { defaultValue: 'Recherche juridique PISTE' })}
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
        <p className="rounded-lg border border-warning-border bg-warning-tint px-3 py-2 text-xs text-warning-deep">
          {t('legal_settings.storage_notice', {
            defaultValue:
              'Les identifiants PISTE sont stockés localement et chiffrés. Ils ne sont jamais écrits dans les dossiers Ordicab.'
          })}
        </p>

        <Field label={t('legal_settings.status_label', { defaultValue: 'État' })}>
          <Input
            readOnly
            disabled
            value={
              hasCredentials
                ? t('legal_settings.credentials_saved', {
                    defaultValue: 'Identifiants enregistrés'
                  })
                : t('legal_settings.credentials_missing', {
                    defaultValue: 'Identifiants absents'
                  })
            }
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('legal_settings.client_id_label', { defaultValue: 'Client ID / KeyId' })}>
            <Input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder={
                active?.hasClientId
                  ? maskSuffix(active.clientIdSuffix)
                  : t('legal_settings.client_id_placeholder', {
                      defaultValue: 'Client ID PISTE'
                    })
              }
              disabled={isLoading || isSaving}
            />
          </Field>
          <Field label={t('legal_settings.client_secret_label', { defaultValue: 'Client secret' })}>
            <Input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder={
                active?.hasClientSecret
                  ? maskSuffix(active.clientSecretSuffix)
                  : t('legal_settings.client_secret_placeholder', {
                      defaultValue: 'Client secret'
                    })
              }
              disabled={isLoading || isSaving}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={connectionStatus === 'checking'}
              onClick={() =>
                void checkConnection({
                  clientId: clientId.trim() || undefined,
                  clientSecret: clientSecret.trim() || undefined
                })
              }
            >
              {connectionStatus === 'checking'
                ? t('legal_settings.checking_action', { defaultValue: 'Vérification...' })
                : t('legal_settings.test_action', { defaultValue: 'Tester PISTE' })}
            </Button>
            {connectionStatus === 'connected' ? (
              <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs font-medium text-success-deep">
                {t('legal_settings.connection_ok', { defaultValue: 'Connexion OK' })}
              </span>
            ) : null}
            {connectionStatus === 'unreachable' ? (
              <span className="text-xs text-[#b23a3a]">{connectionError}</span>
            ) : null}
          </div>

          {hasCredentials ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSaving}
              onClick={() => void deleteCredentials()}
            >
              {t('legal_settings.delete_credentials_action', {
                defaultValue: 'Supprimer les identifiants'
              })}
            </Button>
          ) : null}
        </div>

        {connection ? (
          <p className="text-xs text-ink-muted">
            {t('legal_settings.connection_summary', {
              token: connection.tokenObtained
                ? t('common.ok', { defaultValue: 'OK' })
                : t('legal_settings.connection_failed', { defaultValue: 'échec' }),
              legifrance: connection.legifranceReachable
                ? t('common.ok', { defaultValue: 'OK' })
                : t('legal_settings.connection_unchecked', { defaultValue: 'non vérifié' }),
              judilibre: connection.judilibreReachable
                ? t('common.ok', { defaultValue: 'OK' })
                : t('legal_settings.connection_unchecked', { defaultValue: 'non vérifié' }),
              defaultValue:
                'Token OAuth : {{token}} · Légifrance : {{legifrance}} · Judilibre : {{judilibre}}'
            })}
          </p>
        ) : null}

        {error ? <p className="text-sm text-red-500">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Annuler' })}
          </Button>
          <Button type="button" disabled={isSaving} onClick={() => void handleSave()}>
            {isSaving
              ? t('common.saving', { defaultValue: 'Enregistrement...' })
              : t('common.save', { defaultValue: 'Enregistrer' })}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
