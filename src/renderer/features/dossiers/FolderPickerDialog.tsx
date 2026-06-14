import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DossierEligibleFolder } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { Button, DialogShell, Input } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'

interface FolderPickerDialogProps {
  open: boolean
  isLoading: boolean
  eligibleFolders: DossierEligibleFolder[]
  onLoadEligibleFolders: () => Promise<void>
  onRegister: (id: string) => Promise<boolean>
  onCreate: (name: string) => Promise<boolean>
  createError: string | null
  createErrorCode: IpcErrorCode | null
  onClearError: () => void
  onDismiss: () => void
}

function isVisibleEligibleFolder(folder: DossierEligibleFolder): boolean {
  return !folder.name.startsWith('.') && !folder.slug.startsWith('.')
}

export function FolderPickerDialog(props: FolderPickerDialogProps): React.JSX.Element | null {
  if (!props.open) {
    return null
  }
  return <FolderPickerDialogBody {...props} />
}

function FolderPickerDialogBody({
  isLoading,
  eligibleFolders,
  onLoadEligibleFolders,
  onRegister,
  onCreate,
  createError,
  createErrorCode,
  onClearError,
  onDismiss
}: FolderPickerDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const createErrorMessage = createError
    ? createErrorCode === IpcErrorCode.INVALID_INPUT
      ? t('dossiers.picker_create_error_invalid')
      : createError
    : null

  useEffect(() => {
    void onLoadEligibleFolders()
  }, [onLoadEligibleFolders])

  const visibleEligibleFolders = eligibleFolders.filter(isVisibleEligibleFolder)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEligibleFolders =
    normalizedQuery.length === 0
      ? visibleEligibleFolders
      : visibleEligibleFolders.filter((folder) => {
          const normalizedName = folder.name.toLocaleLowerCase()
          const normalizedPath = folder.path.toLocaleLowerCase()
          return (
            normalizedName.includes(normalizedQuery) || normalizedPath.includes(normalizedQuery)
          )
        })
  const activeSelectedId =
    selectedId && filteredEligibleFolders.some((entry) => entry.slug === selectedId)
      ? selectedId
      : (filteredEligibleFolders[0]?.slug ?? null)
  const activeFolder =
    filteredEligibleFolders.find((folder) => folder.slug === activeSelectedId) ?? null

  return (
    <DialogShell
      size="xl"
      panelClassName="min-h-[32rem]"
      aria-labelledby="dossier-picker-title"
      onDismiss={onDismiss}
    >
      <div className="space-y-1">
        <h3 id="dossier-picker-title" className="text-lg font-semibold text-ink">
          {t('dossiers.picker_title')}
        </h3>
        <p className="text-sm text-ink">{t('dossiers.picker_summary')}</p>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 py-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <div className="flex min-h-0 flex-col space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="dossier-picker-search"
              className="text-xs uppercase tracking-[0.2em] text-aurora-soft"
            >
              {t('dossiers.picker_search_label')}
            </label>
            {!isCreating ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setNewName('')
                  onClearError()
                  setIsCreating(true)
                }}
              >
                {t('dossiers.picker_create_open_action')}
              </Button>
            ) : null}
          </div>
          <Input
            id="dossier-picker-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('dossiers.picker_search_placeholder')}
          />

          {isCreating ? (
            <div className="space-y-3 rounded-2xl border border-hairline bg-white p-4">
              <label
                htmlFor="dossier-picker-new-name"
                className="text-xs uppercase tracking-[0.2em] text-aurora-soft"
              >
                {t('dossiers.picker_create_name_label')}
              </label>
              <Input
                id="dossier-picker-new-name"
                value={newName}
                autoFocus
                onChange={(event) => {
                  if (createError) onClearError()
                  setNewName(event.target.value)
                }}
                placeholder={t('dossiers.picker_create_name_placeholder')}
              />
              {createErrorMessage ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {createErrorMessage}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    onClearError()
                    setIsCreating(false)
                  }}
                >
                  {t('dossiers.picker_create_cancel_action')}
                </Button>
                <Button
                  disabled={isLoading || newName.trim().length === 0}
                  onClick={async () => {
                    const trimmed = newName.trim()
                    if (!trimmed) return
                    const didCreate = await onCreate(trimmed)
                    if (didCreate) onDismiss()
                  }}
                >
                  {t('dossiers.picker_create_confirm_action')}
                </Button>
              </div>
            </div>
          ) : null}

          {isLoading && visibleEligibleFolders.length === 0 ? (
            <p className="rounded-2xl border border-hairline bg-white p-4 text-sm text-ink">
              {t('dossiers.picker_loading')}
            </p>
          ) : visibleEligibleFolders.length === 0 ? (
            <p className="rounded-2xl border border-hairline bg-white p-4 text-sm text-ink">
              {t('dossiers.picker_empty')}
            </p>
          ) : filteredEligibleFolders.length === 0 ? (
            <p className="rounded-2xl border border-hairline bg-white p-4 text-sm text-ink">
              {t('dossiers.picker_no_results')}
            </p>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-hairline bg-white">
              <div className="divide-y divide-white/10">
                {filteredEligibleFolders.map((folder) => (
                  <button
                    key={folder.slug}
                    type="button"
                    onClick={() => setSelectedId(folder.slug)}
                    aria-pressed={activeSelectedId === folder.slug}
                    className={cn(
                      'w-full px-4 py-3 text-left transition hover:bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/35',
                      activeSelectedId === folder.slug ? 'bg-aurora/12' : 'bg-transparent'
                    )}
                  >
                    <strong className="block text-sm text-ink">{folder.name}</strong>
                    <span className="mt-1 block break-all text-xs text-ink-muted">
                      {folder.path}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col rounded-2xl border border-hairline bg-white p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-aurora-soft">
            {t('dossiers.picker_selected_label')}
          </p>
          {activeFolder ? (
            <div className="mt-4 flex-1 space-y-3">
              <div>
                <h4 className="text-xl font-semibold text-ink">{activeFolder.name}</h4>
                <p className="mt-2 break-all text-sm text-ink">{activeFolder.path}</p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink">
              {isLoading && visibleEligibleFolders.length === 0
                ? t('dossiers.picker_loading')
                : normalizedQuery.length > 0
                  ? t('dossiers.picker_no_results')
                  : t('dossiers.picker_empty')}
            </p>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onDismiss}>
          {t('dossiers.picker_cancel_action')}
        </Button>
        <Button
          disabled={isLoading || !activeSelectedId}
          onClick={async () => {
            if (!activeSelectedId) return
            const didRegister = await onRegister(activeSelectedId)
            if (didRegister) onDismiss()
          }}
        >
          {t('dossiers.picker_confirm_action')}
        </Button>
      </div>
    </DialogShell>
  )
}
