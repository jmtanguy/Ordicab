import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AppLocale, DomainStatusSnapshot } from '@shared/types'

import { Button, Card } from '@renderer/components/ui'
import type { AsyncLocaleAction, AsyncVoidAction } from '@renderer/features/actions'
import { useAiStore } from '@renderer/stores/aiStore'
import { useOnboardingStore, useReminderStore, useUiStore } from '@renderer/stores'
import { AiDialog } from '../settings/AiSettings'
import { LanguageDialog } from '../settings/LanguageSettings'
import { ReminderDialog } from '../settings/ReminderSettings'
import { LegalSettingsDialog } from '../settings/LegalSettings'
import { InvoiceSettingsDialog } from '@renderer/features/invoices/InvoiceSettingsSection'
import { useInvoiceSettingsSummary } from '@renderer/features/invoices/useInvoiceSettingsSummary'
import { useInvoiceStore } from '@renderer/stores/invoiceStore'
import { useLegalStore } from '@renderer/stores/legalStore'

interface SettingsPanelProps {
  status: DomainStatusSnapshot
  isLoading: boolean
  isSavingLocale: boolean
  currentLocale: AppLocale
  onChangeDomain: AsyncVoidAction
  onChangeLocale: AsyncLocaleAction
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconGlobe(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7.5" cy="7.5" r="6" />
      <path d="M7.5 1.5C5.9 3.8 5 5.6 5 7.5S5.9 11.2 7.5 13.5M7.5 1.5C9.1 3.8 10 5.6 10 7.5S9.1 11.2 7.5 13.5M1.5 7.5h12" />
    </svg>
  )
}

function IconInvoice(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 1.5h6l2.5 2.5V13L9.5 11.5 7.5 13 5.5 11.5 3 13z" />
      <path d="M5.5 5.5h4M5.5 8h4" />
    </svg>
  )
}

function IconSparkle(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.5 1 9 5 13 6.5 9 8 7.5 12 6 8 2 6.5 6 5 7.5 1z" />
    </svg>
  )
}

function IconBell(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.5 1.5a4 4 0 0 0-4 4c0 4-1.5 5-1.5 5h11s-1.5-1-1.5-5a4 4 0 0 0-4-4z" />
      <path d="M6.2 13a1.5 1.5 0 0 0 2.6 0" />
    </svg>
  )
}

function IconCompass(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7.5" cy="7.5" r="6" />
      <path d="M10 5l-1.3 3.7L5 10l1.3-3.7L10 5z" />
    </svg>
  )
}

function IconChevron(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 2.5l4 4-4 4" />
    </svg>
  )
}

// ─── Shared primitives ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#8a8a85]">
      {children}
    </p>
  )
}

// ─── Preference row (Language / AI) ───────────────────────────────────────────

interface PrefRowProps {
  icon: React.ReactNode
  title: string
  value: string
  onClick: () => void
}

function PrefRow({ icon, title, value, onClick }: PrefRowProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-150 hover:bg-[#f4f3ee] active:bg-[#f4f3ee]"
    >
      <span className="shrink-0 text-[#8a8a85]">{icon}</span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[#1a1a1a]">{title}</p>
        <p className="mt-0.5 truncate text-xs text-[#8a8a85]">{value}</p>
      </div>

      <span className="shrink-0 text-[#5c5c5a] transition-transform duration-150 group-hover:translate-x-0.5">
        <IconChevron />
      </span>
    </button>
  )
}

function PrefRowDivider(): React.JSX.Element {
  return <div className="mx-5 h-px bg-[#f4f3ee]" />
}

// ─── Main component ────────────────────────────────────────────────────────────

export function SettingsPanel({
  status,
  isLoading,
  isSavingLocale,
  currentLocale,
  onChangeDomain,
  onChangeLocale
}: SettingsPanelProps): React.JSX.Element {
  const { t } = useTranslation()

  const [confirmingChange, setConfirmingChange] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [legalOpen, setLegalOpen] = useState(false)

  const reminderPreferences = useReminderStore((s) => s.preferences)

  const loadSettings = useAiStore((s) => s.loadSettings)
  const aiSettings = useAiStore((s) => s.settings)
  const loadInvoiceSettings = useInvoiceStore((s) => s.loadSettings)
  const invoiceSummary = useInvoiceSettingsSummary()
  const loadLegalSettings = useLegalStore((s) => s.loadSettings)
  const legalSettings = useLegalStore((s) => s.settings)

  const reopenWizard = useOnboardingStore((s) => s.reopenWizard)
  const goToOnboarding = useUiStore((s) => s.goToOnboarding)

  useEffect(() => {
    void loadSettings()
    void loadInvoiceSettings()
    void loadLegalSettings()
  }, [loadSettings, loadInvoiceSettings, loadLegalSettings])

  const localeLabel =
    currentLocale === 'fr'
      ? t('settings.language_option_french')
      : t('settings.language_option_english')

  const aiModeLabelMap: Record<string, string> = {
    none: t('ai_settings.mode_none'),
    'claude-code': t('ai_settings.mode_claude_code'),
    remote: t('ai_settings.mode_remote')
  }
  const aiValue = aiSettings?.mode
    ? (aiModeLabelMap[aiSettings.mode] ?? aiSettings.mode)
    : t('ai_settings.emptyHint')

  const reminderValue = reminderPreferences.enabled
    ? t('reminders.summary_enabled', {
        count: reminderPreferences.leadDays.length,
        defaultValue: '{{count}} rappel(s) actif(s)'
      })
    : t('reminders.summary_disabled', { defaultValue: 'Désactivés' })
  const legalCredentials = legalSettings?.credentials
  const legalValue =
    legalCredentials?.hasClientId && legalCredentials.hasClientSecret
      ? t('legal_search.settings_row_configured', {
          defaultValue: 'Identifiants PISTE enregistrés'
        })
      : t('legal_search.settings_row_unconfigured', {
          defaultValue: 'Identifiants PISTE à configurer'
        })

  const isDomainConfigured = Boolean(status.registeredDomainPath)

  return (
    <section className="flex min-h-[calc(100vh-8.5rem)] flex-col gap-8 pb-8">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="border-b border-[#e5e3da] pb-6">
        <h1 className="text-xl font-semibold tracking-tight text-[#1a1a1a]">
          {t('settings.section_title')}
        </h1>
        <p className="mt-1 text-sm text-[#5c5c5a]">{t('settings.section_subtitle')}</p>
      </div>

      {/* ── Preferences (Language + AI) ──────────────────────────────────── */}
      <div className="space-y-3">
        <SectionLabel>{t('settings.preferences_section_title')}</SectionLabel>

        <Card className="overflow-hidden p-0">
          <PrefRow
            icon={<IconGlobe />}
            title={t('settings.language_label')}
            value={localeLabel}
            onClick={() => setLangOpen(true)}
          />
          <PrefRowDivider />
          <PrefRow
            icon={<IconSparkle />}
            title={t('ai_settings.section_title')}
            value={aiValue}
            onClick={() => setAiOpen(true)}
          />
          <PrefRowDivider />
          <PrefRow
            icon={<IconInvoice />}
            title={t('settings.invoice_label', { defaultValue: 'Facturation' })}
            value={invoiceSummary}
            onClick={() => setInvoiceOpen(true)}
          />
          <PrefRowDivider />
          <PrefRow
            icon={<IconCompass />}
            title={t('legal_search.settings_row_title', { defaultValue: 'Recherche juridique' })}
            value={legalValue}
            onClick={() => setLegalOpen(true)}
          />
          <PrefRowDivider />
          <PrefRow
            icon={<IconBell />}
            title={t('reminders.section_title')}
            value={reminderValue}
            onClick={() => setReminderOpen(true)}
          />
          <PrefRowDivider />
          <PrefRow
            icon={<IconCompass />}
            title={t('settings.rerun_onboarding_label', { defaultValue: 'Assistant de démarrage' })}
            value={t('settings.rerun_onboarding_value', {
              defaultValue: 'Reprendre la configuration guidée'
            })}
            onClick={() => {
              reopenWizard()
              goToOnboarding()
            }}
          />
        </Card>
      </div>

      {/* ── Domain ──────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <SectionLabel>{t('settings.domain_section_title')}</SectionLabel>

        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                className={[
                  'inline-block h-2 w-2 shrink-0 rounded-full ring-2',
                  isDomainConfigured
                    ? 'bg-[#5c8a4e] ring-[#5c8a4e]/20'
                    : 'bg-[#b88800] ring-[#b88800]/20'
                ].join(' ')}
              />
              <div>
                <p className="text-sm font-semibold text-[#1a1a1a]">
                  {isDomainConfigured
                    ? t('dashboard.path_label_active')
                    : t('domain.status_value_unconfigured')}
                </p>
                <p className="text-xs text-[#8a8a85]">
                  {t('dashboard.dossiers_value_detected', { count: status.dossierCount })}
                </p>
              </div>
            </div>

            {!confirmingChange ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirmingChange(true)}>
                {t('dashboard.change_domain_action')}
              </Button>
            ) : null}
          </div>

          <div className="rounded-xl border border-[#e5e3da] bg-white px-4 py-3">
            <code className="block break-all text-xs leading-relaxed text-[#1a1a1a]">
              {status.registeredDomainPath ?? '—'}
            </code>
          </div>

          {confirmingChange ? (
            <div className="space-y-3 rounded-xl border border-[#e8d5a3] bg-[#fbf5e3] p-4">
              <p className="text-sm font-semibold text-[#7a5a00]">
                {t('dashboard.change_domain_confirm_title')}
              </p>
              <p className="text-xs leading-relaxed text-[#7a5a00]">
                {t('dashboard.change_domain_confirm_body')}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  onClick={async () => {
                    await onChangeDomain()
                    setConfirmingChange(false)
                  }}
                  disabled={isLoading}
                >
                  {t('dashboard.change_domain_confirm_action')}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingChange(false)}>
                  {t('dashboard.change_domain_cancel_action')}
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      <LanguageDialog
        open={langOpen}
        onClose={() => setLangOpen(false)}
        currentLocale={currentLocale}
        isSaving={isSavingLocale}
        onChangeLocale={onChangeLocale}
      />
      <AiDialog open={aiOpen} onClose={() => setAiOpen(false)} />
      <InvoiceSettingsDialog open={invoiceOpen} onClose={() => setInvoiceOpen(false)} />
      <ReminderDialog open={reminderOpen} onClose={() => setReminderOpen(false)} />
      <LegalSettingsDialog open={legalOpen} onClose={() => setLegalOpen(false)} />
    </section>
  )
}
