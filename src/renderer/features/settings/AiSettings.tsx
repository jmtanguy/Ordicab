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

// Modes that are fully managed cloud services (no key to configure)
const CLOUD_MANAGED_MODES: AiMode[] = ['claude-code', 'copilot', 'codex']
const REMOTE_MODES: AiMode[] = [...CLOUD_MANAGED_MODES, 'remote']

type ModeGroup = 'none' | 'local' | 'cloud' | 'remote'

interface ModeDefinition {
  value: AiMode
  labelKey: string
  group: ModeGroup
}

const AI_MODES: ModeDefinition[] = [
  { value: 'none', labelKey: 'ai_settings.mode_none', group: 'none' },
  { value: 'local', labelKey: 'ai_settings.mode_local', group: 'local' },
  { value: 'remote', labelKey: 'ai_settings.mode_remote', group: 'remote' },
  { value: 'claude-code', labelKey: 'ai_settings.mode_claude_code', group: 'cloud' },
  { value: 'codex', labelKey: 'ai_settings.mode_codex', group: 'cloud' },
  { value: 'copilot', labelKey: 'ai_settings.mode_copilot', group: 'cloud' }
]

function groupLabelKey(group: ModeGroup): string {
  switch (group) {
    case 'none':
      return 'ai_settings.group_none'
    case 'local':
      return 'ai_settings.group_local'
    case 'cloud':
      return 'ai_settings.group_cloud'
    case 'remote':
      return 'ai_settings.group_remote'
  }
}

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
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </span>
      <span className="text-sm text-slate-100">{value}</span>
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
      <span className="text-xs text-amber-200/50">{t('ai_settings.cloud_provider_checking')}</span>
    )
  }

  if (status.available) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">
        ✓ {t('ai_settings.cloud_provider_available')}
      </span>
    )
  }

  return (
    <span className="text-xs text-amber-300">
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
    return <span className="text-xs text-slate-400">{t('ai_settings.connection_checking')}</span>
  }

  if (connectionStatus === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">
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
    mode: AiMode
    ollamaEndpoint?: string
    remoteProviderKind?: RemoteProviderKind
    remoteProjectRef?: string
    remoteProvider?: string
    piiEnabled: boolean
  }>({ mode: 'none', piiEnabled: true })
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrafts({
        mode: settings?.mode ?? 'none',
        ollamaEndpoint: settings?.ollamaEndpoint ?? 'http://localhost:11434',
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

  // Auto-check cloud provider availability when panel opens with a cloud mode
  useEffect(() => {
    if (open && CLOUD_MANAGED_MODES.includes(drafts.mode) && cloudAvailability === null) {
      void checkCloudAvailability(drafts.mode)
    }
  }, [open, drafts.mode, cloudAvailability, checkCloudAvailability])

  if (!open) return null

  const currentMode = drafts.mode
  const ollamaEndpoint = drafts.ollamaEndpoint ?? 'http://localhost:11434'
  const remoteProviderKind = drafts.remoteProviderKind ?? 'custom'
  const remoteProjectRef = drafts.remoteProjectRef ?? ''
  const remoteProvider = drafts.remoteProvider ?? ''
  const piiEnabled = drafts.piiEnabled
  const isProjectRefRequired = remoteProviderKind === 'infomaniak'
  const isProjectRefMissing = isProjectRefRequired && remoteProjectRef.trim().length === 0
  const resolvedRemoteProvider =
    buildRemoteProviderUrl({
      providerKind: remoteProviderKind,
      customProviderUrl: remoteProvider,
      projectRef: remoteProjectRef
    }) ?? ''
  const maskedKey = settings?.hasApiKey ? `•••••••${settings.apiKeySuffix ?? '????'}` : ''

  function handleModeChange(mode: AiMode): void {
    if (REMOTE_MODES.includes(mode) && mode !== currentMode) {
      requestRemoteMode(mode)
    } else {
      setDrafts((d) => ({ ...d, mode }))
    }
  }

  function handleConfirmRemoteMode(): void {
    if (pendingMode) {
      setDrafts((d) => ({ ...d, mode: pendingMode }))
    }
    confirmRemoteMode()
  }

  async function handleSave(): Promise<void> {
    await saveSettings({
      mode: currentMode,
      ollamaEndpoint: currentMode === 'local' ? ollamaEndpoint : undefined,
      remoteProviderKind: currentMode === 'remote' ? remoteProviderKind : undefined,
      remoteProjectRef: currentMode === 'remote' ? remoteProjectRef || undefined : undefined,
      remoteProvider: currentMode === 'remote' ? resolvedRemoteProvider || undefined : undefined,
      apiKey: currentMode === 'remote' ? apiKey || undefined : undefined,
      piiEnabled: currentMode === 'remote' ? piiEnabled : undefined
    })
    onClose()
  }

  return (
    <DialogShell aria-label={t('ai_settings.section_title')} size="lg">
      <div className="mb-5 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-50">{t('ai_settings.section_title')}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-5">
        {/* Mode selector */}
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-widest text-slate-400">
            {t('ai_settings.mode_label')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {AI_MODES.map((m) => {
              const isActive = currentMode === m.value
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => handleModeChange(m.value)}
                  disabled={loading}
                  className={[
                    'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    isActive
                      ? 'border-sky-500 bg-sky-500/10 text-slate-50'
                      : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-500 hover:text-slate-300'
                  ].join(' ')}
                >
                  <span className="text-xs font-medium leading-tight">{t(m.labelKey)}</span>
                  <span
                    className={[
                      'text-xs leading-tight',
                      isActive ? 'text-sky-300' : 'text-slate-600'
                    ].join(' ')}
                  >
                    {t(groupLabelKey(m.group))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Dynamic fields per mode */}
        {currentMode === 'none' && (
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
            <p className="text-xs text-slate-400">{t('ai_settings.none_info')}</p>
          </div>
        )}

        {currentMode === 'local' && (
          <div className="space-y-3">
            <Field label={t('ai_settings.endpoint_label')} htmlFor="ollama-endpoint">
              <Input
                id="ollama-endpoint"
                type="url"
                value={ollamaEndpoint}
                onChange={(e) => setDrafts((d) => ({ ...d, ollamaEndpoint: e.target.value }))}
                disabled={loading}
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void checkConnection()}
                disabled={connectionStatus === 'checking' || loading}
              >
                {connectionStatus === 'checking'
                  ? t('ai_settings.connection_checking')
                  : t('ai_settings.check_connection_button')}
              </Button>
              <ConnectionStatusBadge />
            </div>
          </div>
        )}

        {CLOUD_MANAGED_MODES.includes(currentMode) && (
          <div className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs font-semibold text-amber-200">
              {t('ai_settings.cloud_managed_title')}
            </p>
            <p className="text-xs text-amber-200/70">{t('ai_settings.cloud_managed_info')}</p>
            <CloudAvailabilityBadge status={cloudAvailability} />
            {AI_DELEGATED_INSTRUCTIONS_FILES[currentMode] && (
              <p className="text-xs text-amber-200/50">
                {t('ai_settings.cloud_instructions_file', {
                  file: AI_DELEGATED_INSTRUCTIONS_FILES[currentMode]
                })}
              </p>
            )}
          </div>
        )}

        {currentMode === 'remote' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-200">{t('ai_settings.remote_warning')}</p>
            </div>
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
            <p className="text-xs text-slate-400">{t('ai_settings.remote_flow_hint')}</p>
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
            {remoteProviderKind === 'custom' && (
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
            )}
            {remoteProviderKind !== 'custom' && (
              <Field label={t('ai_settings.provider_url_label')} htmlFor="resolved-remote-provider">
                <Input
                  id="resolved-remote-provider"
                  type="text"
                  value={resolvedRemoteProvider}
                  readOnly
                  disabled
                />
              </Field>
            )}
            <Field label={t('ai_settings.api_key_label')} htmlFor="api-key">
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings?.hasApiKey ? maskedKey : t('ai_settings.api_key_placeholder')}
                disabled={loading}
              />
            </Field>
            <div className="flex items-center gap-3 flex-wrap">
              {settings?.hasApiKey && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void deleteApiKey()}
                  disabled={loading}
                >
                  {t('ai_settings.clear_api_key_button')}
                </Button>
              )}
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
            <div className="flex items-center justify-between rounded-xl border border-slate-700/50 bg-slate-800/50 p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-slate-200">{t('ai_settings.pii_label')}</span>
                <span className="text-xs text-slate-400">{t('ai_settings.pii_description')}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={piiEnabled}
                onClick={() => setDrafts((d) => ({ ...d, piiEnabled: !d.piiEnabled }))}
                disabled={loading}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${piiEnabled ? 'bg-sky-500' : 'bg-slate-600'}`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${piiEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
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

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={loading || isProjectRefMissing}>
            {loading ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>

      {/* Privacy warning modal overlay */}
      {privacyWarningPending && pendingMode && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/60">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h2 className="mb-3 text-lg font-semibold text-amber-300">
              {t('ai_settings.privacy_warning_title')}
            </h2>
            <p className="mb-5 text-sm text-slate-400">{t('ai_settings.privacy_warning_body')}</p>
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
  const {
    settings,
    loading,
    error,
    loadSettings,
    checkConnection,
    connectionStatus,
    cloudAvailability
  } = useAiStore()
  const [dialogOpen, setDialogOpen] = useState(false)

  const isFirstRun = settings === null && !loading

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // Auto-check connection when local mode is active
  useEffect(() => {
    if (settings?.mode === 'local' && connectionStatus === 'idle') {
      void checkConnection()
    }
  }, [settings?.mode, connectionStatus, checkConnection])

  const currentMode = settings?.mode ?? null
  const modeInfo = AI_MODES.find((m) => m.value === currentMode)
  const modeLabel = modeInfo ? t(modeInfo.labelKey) : null

  return (
    <Card className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-slate-50">
            {t('ai_settings.section_title')}
          </h3>
          <p className="text-sm text-slate-300">{t('ai_settings.section_summary')}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
          {t('entity.editButton')}
        </Button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {isFirstRun && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-sky-200">{t('ai_settings.onboarding_title')}</p>
          <ol className="space-y-1 list-decimal list-inside text-xs text-sky-300/80">
            <li>{t('ai_settings.onboarding_step_1')}</li>
            <li>{t('ai_settings.onboarding_step_2')}</li>
            <li>{t('ai_settings.onboarding_step_3')}</li>
          </ol>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">{t('common.loading')}</p>
      ) : settings ? (
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <div className="flex items-center gap-2">
            <AiRow label={t('ai_settings.mode_label')} value={modeLabel ?? undefined} />
            {currentMode &&
              CLOUD_MANAGED_MODES.includes(currentMode as AiMode) &&
              cloudAvailability !== null && <CloudAvailabilityBadge status={cloudAvailability} />}
          </div>
          {currentMode === 'local' && (
            <>
              <AiRow label={t('ai_settings.endpoint_label')} value={settings.ollamaEndpoint} />
            </>
          )}
          {currentMode === 'remote' && (
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
              <AiRow label={t('ai_settings.provider_url_label')} value={settings.remoteProvider} />
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
  )
}
