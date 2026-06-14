import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  KEY_DATE_TAG_VALUES,
  REMINDER_LEAD_DAYS_VALUES,
  type KeyDateTag,
  type ReminderLeadDays,
  type ReminderPreferences
} from '@shared/types'

import { Button, DialogShell } from '@renderer/components/ui'
import { useReminderStore } from '@renderer/stores'

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

function Pill({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active
          ? 'border-aurora/30 bg-aurora/10 text-aurora'
          : 'border-hairline bg-white text-ink-muted hover:border-aurora/40 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

export function ReminderDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const preferences = useReminderStore((state) => state.preferences)
  const setPreferences = useReminderStore((state) => state.setPreferences)

  const [draft, setDraft] = useState<ReminderPreferences>(preferences)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(preferences)
    }
  }, [open, preferences])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  function toggleLeadDay(value: ReminderLeadDays): void {
    setDraft((d) => ({
      ...d,
      leadDays: d.leadDays.includes(value)
        ? d.leadDays.filter((v) => v !== value)
        : [...d.leadDays, value]
    }))
  }

  function toggleTag(tag: KeyDateTag): void {
    setDraft((d) => ({
      ...d,
      triggerTags: d.triggerTags.includes(tag)
        ? d.triggerTags.filter((v) => v !== tag)
        : [...d.triggerTags, tag]
    }))
  }

  function leadDayLabel(value: ReminderLeadDays): string {
    if (value === 0) return t('reminders.lead_today', { defaultValue: 'Le jour même' })
    if (value === 1) return t('reminders.lead_one_day', { defaultValue: 'La veille' })
    return t('reminders.lead_n_days', { count: value, defaultValue: 'J-{{count}}' })
  }

  function handleSave(): void {
    setPreferences(draft)
    onClose()
  }

  return (
    <DialogShell aria-label={t('reminders.section_title')} size="md" panelClassName="max-w-2xl">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">{t('reminders.section_title')}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink-muted transition hover:bg-parchment-dim hover:text-ink"
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {/* Master switch */}
        <div className="flex items-center justify-between rounded-xl border border-hairline-strong bg-parchment p-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-ink">{t('reminders.enabled_label')}</span>
            <span className="text-xs text-ink-muted">{t('reminders.enabled_description')}</span>
          </div>
          <ToggleSwitch
            checked={draft.enabled}
            onChange={(next) => setDraft((d) => ({ ...d, enabled: next }))}
            ariaLabel={t('reminders.enabled_label')}
          />
        </div>

        {/* Lead times */}
        <fieldset
          className={`space-y-2 ${draft.enabled ? '' : 'pointer-events-none opacity-50'}`}
          disabled={!draft.enabled}
        >
          <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            {t('reminders.lead_times_label')}
          </legend>
          <p className="text-xs text-ink-muted">{t('reminders.lead_times_description')}</p>
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_LEAD_DAYS_VALUES.map((value) => (
              <Pill
                key={value}
                active={draft.leadDays.includes(value)}
                onClick={() => toggleLeadDay(value)}
              >
                {leadDayLabel(value)}
              </Pill>
            ))}
          </div>
        </fieldset>

        {/* Trigger tags */}
        <fieldset
          className={`space-y-2 ${draft.enabled ? '' : 'pointer-events-none opacity-50'}`}
          disabled={!draft.enabled}
        >
          <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            {t('reminders.trigger_tags_label')}
          </legend>
          <p className="text-xs text-ink-muted">
            {draft.triggerTags.length === 0
              ? t('reminders.trigger_tags_all_hint')
              : t('reminders.trigger_tags_some_hint')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {KEY_DATE_TAG_VALUES.map((tag) => (
              <Pill
                key={tag}
                active={draft.triggerTags.includes(tag)}
                onClick={() => toggleTag(tag)}
              >
                {t(`dossiers.key_dates_tag_${tag}`)}
              </Pill>
            ))}
          </div>
        </fieldset>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSave}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
