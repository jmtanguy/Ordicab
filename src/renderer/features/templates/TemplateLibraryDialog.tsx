import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TEMPLATE_LIBRARY_THEMES, type TemplateLibraryItem } from '@shared/templateLibrary'
import { Button, DialogShell } from '@renderer/components/ui'
import { useTemplateStore } from '@renderer/stores'
import { useToast } from '@renderer/contexts/ToastContext'

interface TemplateLibraryDialogProps {
  onDismiss: () => void
}

export function TemplateLibraryDialog({
  onDismiss
}: TemplateLibraryDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const createTemplate = useTemplateStore((state) => state.create)
  const existingTemplates = useTemplateStore((state) => state.templates)

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const existingNames = useMemo(
    () => new Set(existingTemplates.map((tpl) => tpl.name.trim().toLowerCase())),
    [existingTemplates]
  )

  const filteredThemes = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return TEMPLATE_LIBRARY_THEMES
    return TEMPLATE_LIBRARY_THEMES.map((theme) => ({
      ...theme,
      items: theme.items.filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          (item.description ?? '').toLowerCase().includes(needle) ||
          (item.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
      )
    })).filter((theme) => theme.items.length > 0)
  }, [search])

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function uniqueName(item: TemplateLibraryItem, seen: Set<string>): string {
    let candidate = item.name
    let suffix = 1
    while (seen.has(candidate.trim().toLowerCase())) {
      suffix += 1
      candidate = `${item.name} (${suffix})`
    }
    seen.add(candidate.trim().toLowerCase())
    return candidate
  }

  async function handleImport(): Promise<void> {
    const allItems = TEMPLATE_LIBRARY_THEMES.flatMap((theme) => theme.items)
    const picked = allItems.filter((item) => selected.has(item.id))
    if (picked.length === 0) {
      onDismiss()
      return
    }
    setImporting(true)
    setErrorMessage(null)
    let importedCount = 0
    const seen = new Set(existingNames)
    for (const item of picked) {
      const name = uniqueName(item, seen)
      await createTemplate({
        name,
        content: item.content,
        description: item.description,
        tags: item.tags,
        documentKind: item.kind ?? 'document'
      })
      const state = useTemplateStore.getState()
      if (state.error) {
        setErrorMessage(state.error)
        setImporting(false)
        return
      }
      importedCount += 1
    }
    setImporting(false)
    showToast(
      t('templates.library.imported', {
        count: importedCount,
        defaultValue: '{{count}} modèle(s) importé(s)'
      })
    )
    onDismiss()
  }

  return (
    <DialogShell
      size="lg"
      aria-label={t('templates.library.title', { defaultValue: 'Bibliothèque de modèles' })}
      onDismiss={onDismiss}
    >
      <div className="flex max-h-[80vh] flex-col gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-[#1a1a1a]">
            {t('templates.library.title', { defaultValue: 'Bibliothèque de modèles' })}
          </h3>
          <p className="text-sm text-[#5c5c5a]">
            {t('templates.library.description', {
              defaultValue:
                "Modèles prêts à l'emploi pour avocat solo. Importez les modèles qui vous intéressent — ils seront copiés dans vos modèles personnels et éditables."
            })}
          </p>
        </div>

        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('templates.library.searchPlaceholder', {
            defaultValue: 'Rechercher dans la bibliothèque…'
          })}
          className="w-full rounded-lg border border-[#e5e3da] bg-white px-3 py-2 text-sm"
        />

        <div className="flex-1 overflow-y-auto pr-1">
          {filteredThemes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#e5e3da] bg-white p-4 text-sm text-[#5c5c5a]">
              {t('templates.library.noResults', { defaultValue: 'Aucun modèle ne correspond.' })}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {filteredThemes.map((theme) => (
                <div key={theme.id} className="rounded-lg border border-[#e5e3da] bg-white p-3">
                  <div className="mb-2">
                    <p className="text-sm font-semibold text-[#1a1a1a]">{theme.label}</p>
                    {theme.description ? (
                      <p className="text-xs text-[#5c5c5a]">{theme.description}</p>
                    ) : null}
                  </div>
                  <ul className="divide-y divide-[#e5e3da]">
                    {theme.items.map((item) => {
                      const checked = selected.has(item.id)
                      return (
                        <li key={item.id} className="py-2">
                          <label className="flex cursor-pointer items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={checked}
                              onChange={() => toggle(item.id)}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-[#1a1a1a]">
                                {item.name}
                              </p>
                              {item.description ? (
                                <p className="text-xs text-[#5c5c5a]">{item.description}</p>
                              ) : null}
                            </div>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {errorMessage ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex items-center justify-between border-t border-[#e5e3da] pt-3">
          <p className="text-xs text-[#5c5c5a]">
            {t('templates.library.selectedCount', {
              count: selected.size,
              defaultValue: '{{count}} sélectionné(s)'
            })}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onDismiss} disabled={importing}>
              {t('templates.editor.cancelButton')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleImport()}
              disabled={importing || selected.size === 0}
            >
              {importing
                ? t('templates.library.importing', { defaultValue: 'Import en cours…' })
                : t('templates.library.importAction', {
                    defaultValue: 'Importer la sélection'
                  })}
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  )
}
