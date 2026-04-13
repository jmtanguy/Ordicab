import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AppLocale } from '@shared/types'

import { Button, DialogShell, Field, Select } from '@renderer/components/ui'
import type { AsyncLocaleAction } from '@renderer/features/actions'

interface LanguageDialogProps {
  open: boolean
  onClose: () => void
  currentLocale: AppLocale
  isSaving: boolean
  onChangeLocale: AsyncLocaleAction
}

export function LanguageDialog({
  open,
  onClose,
  currentLocale,
  isSaving,
  onChangeLocale
}: LanguageDialogProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<AppLocale>(currentLocale)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(currentLocale)
    }
  }, [open, currentLocale])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  async function handleSave(): Promise<void> {
    await onChangeLocale(draft)
    onClose()
  }

  return (
    <DialogShell aria-label={t('settings.language_label')}>
      <div className="mb-5 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-50">{t('settings.language_label')}</h2>
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
        <Field label={t('settings.language_label')} htmlFor="language-selector-dialog">
          <Select
            id="language-selector-dialog"
            density="compact"
            className="rounded-xl border-slate-700 px-3 py-2"
            value={draft}
            onChange={(e) => setDraft(e.target.value as AppLocale)}
            disabled={isSaving}
          >
            <option value="en">{t('settings.language_option_english')}</option>
            <option value="fr">{t('settings.language_option_french')}</option>
          </Select>
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
