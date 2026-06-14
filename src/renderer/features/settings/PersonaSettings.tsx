/**
 * PersonaSettings — editable table of the role personas (stable fake
 * identities used by PII pseudonymization, embedded AI and Cowork export
 * alike). Rendered inside the AI dialog, under the PII settings.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input } from '@renderer/components/ui'
import { useAiStore } from '@renderer/stores/aiStore'
import { DEFAULT_PII_PERSONAS, isPersonaNameSafe, type PiiPersona } from '@shared/types/piiPersonas'
import { labelToKey } from '@shared/templateContent/tagPaths'

const GENDER_VALUES: Array<PiiPersona['gender']> = ['N', 'M', 'F']

export function PersonaSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const personas = useAiStore((s) => s.personas)
  const personasError = useAiStore((s) => s.personasError)
  const loadPersonas = useAiStore((s) => s.loadPersonas)
  const savePersonas = useAiStore((s) => s.savePersonas)

  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<PiiPersona[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open && personas === null) void loadPersonas()
  }, [open, personas, loadPersonas])

  useEffect(() => {
    if (personas !== null && drafts === null) setDrafts(personas)
  }, [personas, drafts])

  const rows = drafts ?? personas ?? []
  const hasUnsafeRow = rows.some((persona) => !isPersonaNameSafe(persona))

  const updateRow = (index: number, patch: Partial<PiiPersona>): void => {
    setSaved(false)
    setDrafts((current) => {
      const base = current ?? personas ?? []
      return base.map((persona, i) => (i === index ? { ...persona, ...patch } : persona))
    })
  }

  const addRow = (): void => {
    setSaved(false)
    setDrafts((current) => [
      ...(current ?? personas ?? []),
      { roleKey: '', roleLabel: '', firstName: '', lastName: '', gender: 'N' }
    ])
  }

  const removeRow = (index: number): void => {
    setSaved(false)
    setDrafts((current) => (current ?? personas ?? []).filter((_, i) => i !== index))
  }

  const resetToDefaults = (): void => {
    setSaved(false)
    setDrafts(DEFAULT_PII_PERSONAS)
  }

  const handleSave = async (): Promise<void> => {
    if (!drafts) return
    setSaving(true)
    setSaved(false)
    try {
      const normalized = drafts
        .map((persona) => ({
          ...persona,
          roleKey: persona.roleKey || labelToKey(persona.roleLabel),
          institution: persona.institution?.trim() ? persona.institution.trim() : undefined
        }))
        .filter((persona) => persona.roleLabel && persona.firstName && persona.lastName)
      const ok = await savePersonas(normalized)
      if (ok) {
        setDrafts(null)
        setSaved(true)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-hairline-strong bg-parchment">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between p-3 text-left"
        aria-expanded={open}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">{t('personas.title')}</span>
          <span className="text-xs text-ink-muted">{t('personas.description')}</span>
        </div>
        <span className="text-ink-muted">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-hairline-strong p-3">
          <div className="grid grid-cols-[1fr_1fr_1fr_4rem_1fr_2rem] items-center gap-2 text-xs font-semibold text-ink-muted">
            <span>{t('personas.role')}</span>
            <span>{t('personas.firstName')}</span>
            <span>{t('personas.lastName')}</span>
            <span>{t('personas.gender')}</span>
            <span>{t('personas.institution')}</span>
            <span />
          </div>
          {/* Scrollable row list: a long role list must not push the action
              buttons below the dialog viewport. */}
          <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((persona, index) => (
              <div
                key={`${persona.roleKey}-${index}`}
                className="grid grid-cols-[1fr_1fr_1fr_4rem_1fr_2rem] items-center gap-2"
              >
                <Input
                  value={persona.roleLabel}
                  onChange={(e) =>
                    updateRow(index, {
                      roleLabel: e.target.value,
                      roleKey: labelToKey(e.target.value)
                    })
                  }
                  placeholder={t('personas.rolePlaceholder')}
                />
                <Input
                  value={persona.firstName}
                  onChange={(e) => updateRow(index, { firstName: e.target.value })}
                />
                <Input
                  value={persona.lastName}
                  onChange={(e) => updateRow(index, { lastName: e.target.value })}
                />
                <select
                  value={persona.gender}
                  onChange={(e) =>
                    updateRow(index, { gender: e.target.value as PiiPersona['gender'] })
                  }
                  className="h-10 rounded-md border border-hairline-strong bg-parchment px-2 text-sm"
                >
                  {GENDER_VALUES.map((gender) => (
                    <option key={gender} value={gender}>
                      {gender}
                    </option>
                  ))}
                </select>
                <Input
                  value={persona.institution ?? ''}
                  onChange={(e) => updateRow(index, { institution: e.target.value })}
                  placeholder="—"
                />
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="rounded-lg p-1.5 text-ink-muted transition hover:bg-parchment-dim hover:text-ink"
                  aria-label={t('personas.remove')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {hasUnsafeRow && <p className="text-xs text-warning-deep">{t('personas.minLength')}</p>}
          {personasError && <p className="text-xs text-red-400">{personasError}</p>}
          {saved && <p className="text-xs text-aurora">{t('personas.saved')}</p>}

          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={addRow}>
                {t('personas.addRole')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={resetToDefaults}>
                {t('personas.resetDefaults')}
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || drafts === null || hasUnsafeRow}
            >
              {saving ? t('common.saving') : t('personas.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
