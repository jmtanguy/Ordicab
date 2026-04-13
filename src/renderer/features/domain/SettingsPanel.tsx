import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AppLocale, DomainStatusSnapshot } from '@shared/types'
import { buildAddressFields } from '@shared/addressFormatting'

import { Button, Card } from '@renderer/components/ui'
import type { AsyncLocaleAction, AsyncVoidAction } from '@renderer/features/actions'
import { useAiStore } from '@renderer/stores/aiStore'
import { useEntityStore } from '@renderer/stores'

import { EntityDialog } from './EntityPanel'
import { AiDialog } from '../settings/AiSettings'
import { LanguageDialog } from '../settings/LanguageSettings'

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
    <p className="px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-500">
      {children}
    </p>
  )
}

function DetailField({
  label,
  value
}: {
  label: string
  value?: string
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
      className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-150 hover:bg-white/3 active:bg-white/5"
    >
      <span className="shrink-0 text-slate-500">{icon}</span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{value}</p>
      </div>

      <span className="shrink-0 text-slate-600 transition-transform duration-150 group-hover:translate-x-0.5">
        <IconChevron />
      </span>
    </button>
  )
}

function PrefRowDivider(): React.JSX.Element {
  return <div className="mx-5 h-px bg-white/5" />
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
  const [entityOpen, setEntityOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  const loadSettings = useAiStore((s) => s.loadSettings)
  const aiSettings = useAiStore((s) => s.settings)
  const loadProfile = useEntityStore((s) => s.load)
  const entityProfile = useEntityStore((s) => s.profile)

  useEffect(() => {
    void loadSettings()
    void loadProfile()
  }, [loadSettings, loadProfile])

  const localeLabel =
    currentLocale === 'fr'
      ? t('settings.language_option_french')
      : t('settings.language_option_english')

  const aiModeLabelMap: Record<string, string> = {
    none: t('ai_settings.mode_none'),
    local: t('ai_settings.mode_local'),
    'claude-code': t('ai_settings.mode_claude_code'),
    copilot: t('ai_settings.mode_copilot'),
    codex: t('ai_settings.mode_codex'),
    remote: t('ai_settings.mode_remote')
  }
  const aiValue = aiSettings?.mode
    ? (aiModeLabelMap[aiSettings.mode] ?? aiSettings.mode)
    : t('ai_settings.emptyHint')

  const isDomainConfigured = Boolean(status.registeredDomainPath)

  const entityDisplayName = [
    entityProfile?.title,
    entityProfile?.firstName,
    entityProfile?.lastName
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className="flex min-h-[calc(100vh-8.5rem)] flex-col gap-8 pb-8">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="border-b border-white/6 pb-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">
          {t('settings.section_title')}
        </h1>
        <p className="mt-1 text-sm text-slate-400">{t('settings.section_subtitle')}</p>
      </div>

      {/* ── Entity ──────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <SectionLabel>{t('entity.section_title')}</SectionLabel>

        <Card className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-100">
                {entityProfile?.firmName ?? t('entity.emptyHint')}
              </p>
              {entityProfile ? (
                <p className="text-xs text-slate-500">{t('entity.section_summary')}</p>
              ) : null}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEntityOpen(true)}>
              {t('entity.editButton')}
            </Button>
          </div>

          {entityProfile ? (
            <div className="border-t border-white/6 pt-4 space-y-4">
              {/* Row 1 — identité */}
              <div className="grid grid-cols-3 gap-x-8 gap-y-4">
                {entityProfile.profession ? (
                  <DetailField
                    label={t('entity.form.profession')}
                    value={t(`entity.profession.${entityProfile.profession}`)}
                  />
                ) : null}
                {entityDisplayName ? (
                  <DetailField label={t('entity.form.name')} value={entityDisplayName} />
                ) : null}
                {/* Adresse — pleine largeur */}
                {(entityProfile.addressLine ??
                entityProfile.zipCode ??
                entityProfile.city ??
                entityProfile.address) ? (
                  <DetailField
                    label={t('entity.form.address')}
                    value={
                      (entityProfile.addressLine ?? entityProfile.zipCode ?? entityProfile.city)
                        ? buildAddressFields(entityProfile).addressFormatted
                        : buildAddressFields({ addressLine: entityProfile.address })
                            .addressFormatted
                    }
                  />
                ) : null}
              </div>

              {/* Row 2 — contact */}
              <div className="grid grid-cols-3 gap-x-8 gap-y-4">
                <DetailField label={t('entity.form.phone')} value={entityProfile.phone} />
                <DetailField label={t('entity.form.email')} value={entityProfile.email} />
                <DetailField label={t('entity.form.vatNumber')} value={entityProfile.vatNumber} />
              </div>
            </div>
          ) : null}
        </Card>
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
                    ? 'bg-emerald-400 ring-emerald-400/20'
                    : 'bg-amber-400 ring-amber-400/20'
                ].join(' ')}
              />
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  {isDomainConfigured
                    ? t('dashboard.path_label_active')
                    : t('domain.status_value_unconfigured')}
                </p>
                <p className="text-xs text-slate-500">
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

          <div className="rounded-xl border border-white/[0.07] bg-slate-950/40 px-4 py-3">
            <code className="block break-all text-xs leading-relaxed text-slate-300">
              {status.registeredDomainPath ?? '—'}
            </code>
          </div>

          {confirmingChange ? (
            <div className="space-y-3 rounded-xl border border-amber-300/30 bg-amber-300/[0.07] p-4">
              <p className="text-sm font-semibold text-amber-100">
                {t('dashboard.change_domain_confirm_title')}
              </p>
              <p className="text-xs leading-relaxed text-amber-200/70">
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
      <EntityDialog open={entityOpen} onClose={() => setEntityOpen(false)} />
      <AiDialog open={aiOpen} onClose={() => setAiOpen(false)} />
    </section>
  )
}
