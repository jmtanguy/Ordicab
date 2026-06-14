import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AiDelegatedProviderStatus, AiMode } from '@shared/types'
import { AI_DELEGATED_INSTRUCTIONS_FILES } from '@shared/types'
import {
  REMOTE_PROVIDER_PRESETS,
  buildRemoteProviderUrl,
  inferInfomaniakProjectRef,
  inferRemoteProviderKind,
  type RemoteProviderKind
} from '@shared/ai/remoteProviders'

import { Button, Card, DialogShell, Field, Input, Select } from '@renderer/components/ui'
import { useAiStore } from '@renderer/stores/aiStore'
import { ModelManagerCard } from './ModelManagerCard'
import { PersonaSettings } from './PersonaSettings'

function AiRow({
  label,
  value
}: {
  label: string
  value: string | undefined
}): React.JSX.Element | null {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </span>
      <span className="text-sm text-ink">{value}</span>
    </div>
  )
}

function CloudAvailabilityBadge({
  status
}: {
  status: AiDelegatedProviderStatus | null
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (status === null) {
    return (
      <span className="text-xs text-[#8a7400]">{t('ai_settings.cloud_provider_checking')}</span>
    )
  }

  if (status.available) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-xs font-medium text-success-deep">
        ✓ {t('ai_settings.cloud_provider_available')}
      </span>
    )
  }

  return (
    <span className="text-xs text-warning">
      ⚠ {t('ai_settings.cloud_provider_unavailable')}
      {status.reason ? ` — ${status.reason}` : ''}
    </span>
  )
}

function ConnectionStatusBadge(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { connectionStatus, connectionError } = useAiStore()

  function parseProviderConnectionError(raw: string | null): string | null {
    if (!raw) return null

    const trimmed = raw.trim()
    if (!trimmed) return null

    const localizedKnownError: Record<string, string> = {
      'API key is required to verify the remote provider.':
        'ai_settings.connection_error_api_key_required',
      'Remote provider URL is required.': 'ai_settings.connection_error_provider_url_required'
    }
    const knownKey = localizedKnownError[trimmed]
    if (knownKey) return t(knownKey)

    try {
      const parsed = JSON.parse(trimmed) as {
        error?: { code?: string; description?: string; message?: string }
      }

      const code = parsed?.error?.code?.trim().toLowerCase()
      const description = parsed?.error?.description?.trim() || parsed?.error?.message?.trim()

      if (code === 'method_not_found') {
        return t('ai_settings.connection_error_method_not_found')
      }

      if (description) return description
    } catch {
      // Keep raw fallback below when payload is not JSON.
    }

    return trimmed
  }

  if (connectionStatus === 'idle') return null

  if (connectionStatus === 'checking') {
    return <span className="text-xs text-ink-muted">{t('ai_settings.connection_checking')}</span>
  }

  if (connectionStatus === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-xs font-medium text-success-deep">
        ✓ {t('ai_settings.connection_connected')}
      </span>
    )
  }

  if (connectionStatus === 'unreachable') {
    const userMessage =
      parseProviderConnectionError(connectionError) ?? t('ai_settings.connection_unreachable')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-300">
        ✗ {userMessage}
      </span>
    )
  }

  return null
}

export function AiDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const {
    settings,
    loading,
    saveSettings,
    privacyWarningPending,
    pendingMode,
    connectionStatus,
    requestRemoteMode,
    confirmRemoteMode,
    cancelRemoteMode,
    checkConnection,
    deleteApiKey,
    remoteApiError,
    cloudAvailability,
    checkCloudAvailability
  } = useAiStore()

  const [drafts, setDrafts] = useState<{
    apiEnabled: boolean
    claudeCoworkEnabled: boolean
    remoteProviderKind?: RemoteProviderKind
    remoteProjectRef?: string
    remoteProvider?: string
    piiEnabled: boolean
  }>({ apiEnabled: false, claudeCoworkEnabled: false, piiEnabled: true })
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    if (open) {
      const mode = settings?.mode ?? 'none'
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrafts({
        apiEnabled: mode === 'remote',
        claudeCoworkEnabled: settings?.claudeCoworkEnabled ?? mode === 'claude-code',
        remoteProviderKind:
          settings?.remoteProviderKind ?? inferRemoteProviderKind(settings?.remoteProvider),
        remoteProjectRef:
          settings?.remoteProjectRef ?? inferInfomaniakProjectRef(settings?.remoteProvider),
        remoteProvider: settings?.remoteProvider ?? '',
        piiEnabled: settings?.piiEnabled ?? true
      })
      setApiKey('')
    }
  }, [open, settings])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Auto-check Claude Cowork availability when enabled
  useEffect(() => {
    if (open && drafts.claudeCoworkEnabled && cloudAvailability === null) {
      void checkCloudAvailability('claude-code')
    }
  }, [open, drafts.claudeCoworkEnabled, cloudAvailability, checkCloudAvailability])

  if (!open) return null

  const apiEnabled = drafts.apiEnabled
  const claudeCoworkEnabled = drafts.claudeCoworkEnabled
  const remoteProviderKind = drafts.remoteProviderKind ?? 'custom'
  const remoteProjectRef = drafts.remoteProjectRef ?? ''
  const remoteProvider = drafts.remoteProvider ?? ''
  const piiEnabled = drafts.piiEnabled
  const isProjectRefRequired = remoteProviderKind === 'infomaniak'
  const isProjectRefMissing =
    apiEnabled && isProjectRefRequired && remoteProjectRef.trim().length === 0
  const resolvedRemoteProvider =
    buildRemoteProviderUrl({
      providerKind: remoteProviderKind,
      customProviderUrl: remoteProvider,
      projectRef: remoteProjectRef
    }) ?? ''
  const maskedKey = settings?.hasApiKey ? `•••••••${settings.apiKeySuffix ?? '????'}` : ''

  function handleToggleApi(enabled: boolean): void {
    if (enabled) {
      requestRemoteMode('remote')
    } else {
      setDrafts((d) => ({ ...d, apiEnabled: false }))
    }
  }

  function handleToggleClaudeCowork(enabled: boolean): void {
    if (enabled) {
      requestRemoteMode('claude-code')
    } else {
      setDrafts((d) => ({ ...d, claudeCoworkEnabled: false }))
    }
  }

  function handleConfirmRemoteMode(): void {
    if (pendingMode === 'remote') {
      setDrafts((d) => ({ ...d, apiEnabled: true }))
    } else if (pendingMode === 'claude-code') {
      setDrafts((d) => ({ ...d, claudeCoworkEnabled: true }))
    }
    confirmRemoteMode()
  }

  async function handleSave(): Promise<void> {
    // mode reflects the primary AI assistant; claudeCoworkEnabled can run alongside it
    const savedMode: AiMode = apiEnabled ? 'remote' : claudeCoworkEnabled ? 'claude-code' : 'none'
    await saveSettings({
      mode: savedMode,
      claudeCoworkEnabled,
      remoteProviderKind: apiEnabled ? remoteProviderKind : undefined,
      remoteProjectRef: apiEnabled ? remoteProjectRef || undefined : undefined,
      remoteProvider: apiEnabled ? resolvedRemoteProvider || undefined : undefined,
      apiKey: apiEnabled ? apiKey || undefined : undefined,
      piiEnabled: apiEnabled ? piiEnabled : undefined
    })
    onClose()
  }

  return (
    <DialogShell
      aria-label={t('ai_settings.section_title')}
      size="lg"
      panelClassName="max-w-[60rem] overflow-hidden"
    >
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">{t('ai_settings.section_title')}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink-muted transition hover:bg-parchment-dim hover:text-ink"
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </div>

      {/* Scrollable settings area — the dialog footer stays pinned below so
          Cancel/Save never leave the viewport however long the cards grow. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {/* API Access card */}
        <div className="overflow-hidden rounded-xl border border-hairline-strong bg-parchment">
          <div className="flex items-center justify-between p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-ink">{t('ai_settings.mode_remote')}</span>
              <span className="text-xs text-ink-muted">
                {t('ai_settings.api_access_description')}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={apiEnabled}
              onClick={() => handleToggleApi(!apiEnabled)}
              disabled={loading}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${apiEnabled ? 'bg-aurora' : 'bg-hairline-strong'}`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${apiEnabled ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>

          {apiEnabled && (
            <div className="space-y-3 border-t border-hairline-strong p-3">
              {/* Warning — compact single line */}
              <p className="rounded-lg border border-warning-border bg-warning-tint px-3 py-2 text-xs text-warning-deep">
                {t('ai_settings.remote_warning')}
              </p>

              {/* Provider + URL on the same row */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Provider" htmlFor="remote-provider-kind">
                  <Select
                    id="remote-provider-kind"
                    value={remoteProviderKind}
                    onChange={(e) =>
                      setDrafts((d) => ({
                        ...d,
                        remoteProviderKind: e.target.value as RemoteProviderKind
                      }))
                    }
                    disabled={loading}
                  >
                    {REMOTE_PROVIDER_PRESETS.map((preset) => (
                      <option key={preset.kind} value={preset.kind}>
                        {preset.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {remoteProviderKind === 'custom' ? (
                  <Field label={t('ai_settings.provider_url_label')} htmlFor="remote-provider">
                    <Input
                      id="remote-provider"
                      type="text"
                      value={remoteProvider}
                      onChange={(e) => setDrafts((d) => ({ ...d, remoteProvider: e.target.value }))}
                      placeholder={t('ai_settings.provider_url_placeholder')}
                      disabled={loading}
                    />
                  </Field>
                ) : (
                  <Field
                    label={t('ai_settings.provider_url_label')}
                    htmlFor="resolved-remote-provider"
                  >
                    <Input
                      id="resolved-remote-provider"
                      type="text"
                      value={resolvedRemoteProvider}
                      readOnly
                      disabled
                    />
                  </Field>
                )}
              </div>

              {/* Project ref (Infomaniak only) */}
              {remoteProviderKind === 'infomaniak' && (
                <Field
                  label={t('ai_settings.project_ref_required_label')}
                  htmlFor="remote-project-ref"
                  error={
                    isProjectRefMissing ? t('ai_settings.project_ref_required_error') : undefined
                  }
                >
                  <Input
                    id="remote-project-ref"
                    type="text"
                    value={remoteProjectRef}
                    onChange={(e) => setDrafts((d) => ({ ...d, remoteProjectRef: e.target.value }))}
                    placeholder="e.g. 107857"
                    disabled={loading}
                    aria-required="true"
                  />
                </Field>
              )}

              {/* API key + clear button inline */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label={t('ai_settings.api_key_label')} htmlFor="api-key">
                    <Input
                      id="api-key"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={
                        settings?.hasApiKey ? maskedKey : t('ai_settings.api_key_placeholder')
                      }
                      disabled={loading}
                    />
                  </Field>
                </div>
                {settings?.hasApiKey && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void deleteApiKey()}
                    disabled={loading}
                    className="mb-0.5"
                  >
                    {t('ai_settings.clear_api_key_button')}
                  </Button>
                )}
              </div>

              {/* Connection check + PII toggle on same row */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void checkConnection({
                        mode: 'remote',
                        remoteProvider: resolvedRemoteProvider || undefined,
                        apiKey: apiKey || undefined,
                        refresh: true
                      })
                    }
                    disabled={connectionStatus === 'checking' || loading || isProjectRefMissing}
                  >
                    {connectionStatus === 'checking'
                      ? t('ai_settings.connection_checking')
                      : t('ai_settings.check_connection_button')}
                  </Button>
                  <ConnectionStatusBadge />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">{t('ai_settings.pii_label')}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={piiEnabled}
                    onClick={() => setDrafts((d) => ({ ...d, piiEnabled: !d.piiEnabled }))}
                    disabled={loading}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${piiEnabled ? 'bg-aurora' : 'bg-hairline-strong'}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${piiEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                  </button>
                </div>
              </div>

              {remoteApiError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                  <p className="text-xs font-semibold text-red-300">
                    {remoteApiError.type === 'auth_error'
                      ? t('ai_settings.remote_error_auth')
                      : remoteApiError.type === 'rate_limit'
                        ? t('ai_settings.remote_error_rate_limit')
                        : remoteApiError.type === 'network_error'
                          ? t('ai_settings.remote_error_network')
                          : t('ai_settings.remote_error_server')}
                  </p>
                  <p className="text-xs text-red-300/70">{remoteApiError.message}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Claude Cowork card */}
        <div className="overflow-hidden rounded-xl border border-hairline-strong bg-parchment">
          <div className="flex items-center justify-between p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-ink">
                {t('ai_settings.mode_claude_code')}
              </span>
              <span className="text-xs text-ink-muted">
                {t('ai_settings.claude_cowork_description')}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={claudeCoworkEnabled}
              onClick={() => handleToggleClaudeCowork(!claudeCoworkEnabled)}
              disabled={loading}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${claudeCoworkEnabled ? 'bg-aurora' : 'bg-hairline-strong'}`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${claudeCoworkEnabled ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>

          {claudeCoworkEnabled && (
            <div className="border-t border-hairline-strong p-3">
              <div className="space-y-1 rounded-lg border border-warning-border bg-warning-tint px-3 py-2">
                <p className="text-xs font-semibold text-warning-deep">
                  {t('ai_settings.cloud_managed_title')}
                </p>
                <p className="text-xs text-warning-deep">{t('ai_settings.cloud_managed_info')}</p>
                <CloudAvailabilityBadge status={cloudAvailability} />
                {AI_DELEGATED_INSTRUCTIONS_FILES['claude-code'] && (
                  <p className="text-xs text-[#8a7400]">
                    {t('ai_settings.cloud_instructions_file', {
                      file: AI_DELEGATED_INSTRUCTIONS_FILES['claude-code']
                    })}
                  </p>
                )}
              </div>
              {apiEnabled && (
                <p className="mt-2 text-xs text-ink-muted">
                  {t('ai_settings.claude_cowork_parallel_note')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Role personas — stable fake identities shared by the embedded AI
            pseudonymizer and the Cowork export. Saves independently. */}
        {(apiEnabled || claudeCoworkEnabled) && <PersonaSettings />}
      </div>

      {/* Pinned footer — outside the scrollable area. */}
      <div className="flex shrink-0 justify-end gap-2 pt-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void handleSave()} disabled={loading || isProjectRefMissing}>
          {loading ? t('common.saving') : t('common.save')}
        </Button>
      </div>

      {/* Privacy warning modal overlay */}
      {privacyWarningPending && pendingMode && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[rgba(15,122,138,0.18)] backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-hairline-strong bg-parchment p-6 shadow-[0_30px_80px_rgba(10,92,104,0.28)] ring-1 ring-aurora/15">
            <h2 className="mb-3 text-lg font-semibold text-warning">
              {t('ai_settings.privacy_warning_title')}
            </h2>
            <p className="mb-5 text-sm text-ink-muted">{t('ai_settings.privacy_warning_body')}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={cancelRemoteMode}>
                {t('common.cancel')}
              </Button>
              <Button type="button" onClick={handleConfirmRemoteMode}>
                {t('ai_settings.privacy_warning_confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DialogShell>
  )
}

export function AiSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const { settings, loading, error, loadSettings, cloudAvailability } = useAiStore()
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const currentMode = settings?.mode ?? null
  const isApiEnabled = currentMode === 'remote'
  const isClaudeCoworkEnabled = settings?.claudeCoworkEnabled ?? currentMode === 'claude-code'
  const activeServiceLabels: string[] = []
  if (isApiEnabled) activeServiceLabels.push(t('ai_settings.mode_remote'))
  if (isClaudeCoworkEnabled) activeServiceLabels.push(t('ai_settings.mode_claude_code'))
  const activeServicesValue =
    activeServiceLabels.length > 0 ? activeServiceLabels.join(' · ') : t('ai_settings.mode_none')

  return (
    <div className="space-y-5">
      <Card className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-ink">{t('ai_settings.section_title')}</h3>
            <p className="text-sm text-ink">{t('ai_settings.section_summary')}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
            {t('entity.editButton')}
          </Button>
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        {loading ? (
          <p className="text-sm text-ink-muted">{t('common.loading')}</p>
        ) : settings ? (
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
            <div className="flex items-center gap-2">
              <AiRow label={t('ai_settings.active_services_label')} value={activeServicesValue} />
              {isClaudeCoworkEnabled && cloudAvailability !== null && (
                <CloudAvailabilityBadge status={cloudAvailability} />
              )}
            </div>
            {isApiEnabled && (
              <>
                <AiRow
                  label="Provider"
                  value={
                    REMOTE_PROVIDER_PRESETS.find(
                      (preset) => preset.kind === (settings.remoteProviderKind ?? 'custom')
                    )?.label
                  }
                />
                <AiRow label="Project Reference" value={settings.remoteProjectRef} />
                <AiRow
                  label={t('ai_settings.provider_url_label')}
                  value={settings.remoteProvider}
                />
                {settings.hasApiKey && (
                  <AiRow
                    label={t('ai_settings.api_key_label')}
                    value={`•••••••${settings.apiKeySuffix ?? '????'}`}
                  />
                )}
              </>
            )}
          </div>
        ) : null}

        <AiDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      </Card>
      <ModelManagerCard />
    </div>
  )
}
