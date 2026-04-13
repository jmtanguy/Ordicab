import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { IpcErrorCode, type DossierEligibleFolder, type DossierSummary } from '@shared/types'

import {
  AlertBanner,
  Button,
  Card,
  DialogShell,
  Field,
  Input,
  Select
} from '@renderer/components/ui'
import { useToast } from '@renderer/contexts/ToastContext'
import type { AsyncVoidAction } from '@renderer/features/actions'
import { cn } from '@renderer/lib/utils'
import type { DossierSortMode, DossierStatusFilter } from '@renderer/stores/dossierStore'

import { DossierCard } from './DossierCard'

interface DossierNotice {
  kind: 'registered' | 'unregistered'
  dossierName: string
}

function isVisibleEligibleFolder(folder: DossierEligibleFolder): boolean {
  return !folder.name.startsWith('.') && !folder.id.startsWith('.')
}

interface DashboardGridProps {
  dossiers: DossierSummary[]
  eligibleFolders: DossierEligibleFolder[]
  isLoading: boolean
  error: string | null
  errorCode: IpcErrorCode | null
  notice: DossierNotice | null
  activeDossierId: string | null
  statusFilter: DossierStatusFilter
  sortMode: DossierSortMode
  onLoadEligibleFolders: AsyncVoidAction
  onOpenDetail: (id: string) => void
  onRegister: (id: string) => Promise<boolean>
  onSetStatusFilter: (filter: DossierStatusFilter) => void
  onSetSortMode: (mode: DossierSortMode) => void
  onClearNotice: () => void
}

function resolveErrorMessage(
  error: string | null,
  errorCode: IpcErrorCode | null,
  t: (key: string) => string
): string | null {
  if (!error) {
    return null
  }

  if (errorCode === IpcErrorCode.INVALID_INPUT) {
    return t('dossiers.error_duplicate')
  }

  return error
}

export function DashboardGrid({
  dossiers,
  eligibleFolders,
  isLoading,
  error,
  errorCode,
  notice,
  activeDossierId,
  statusFilter,
  sortMode,
  onLoadEligibleFolders,
  onOpenDetail,
  onRegister,
  onSetStatusFilter,
  onSetSortMode,
  onClearNotice
}: DashboardGridProps): React.JSX.Element {
  const { t } = useTranslation()
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [nameQuery, setNameQuery] = useState('')
  const [pickerQuery, setPickerQuery] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const normalizedNameQuery = nameQuery.trim().toLocaleLowerCase()
  const filteredDossiers =
    normalizedNameQuery.length === 0
      ? dossiers
      : dossiers.filter((dossier) => dossier.name.toLocaleLowerCase().includes(normalizedNameQuery))
  const visibleEligibleFolders = eligibleFolders.filter(isVisibleEligibleFolder)
  const normalizedPickerQuery = pickerQuery.trim().toLocaleLowerCase()
  const filteredEligibleFolders =
    normalizedPickerQuery.length === 0
      ? visibleEligibleFolders
      : visibleEligibleFolders.filter((folder) => {
          const normalizedName = folder.name.toLocaleLowerCase()
          const normalizedPath = folder.path.toLocaleLowerCase()
          return (
            normalizedName.includes(normalizedPickerQuery) ||
            normalizedPath.includes(normalizedPickerQuery)
          )
        })
  const activeSelectedFolderId =
    selectedFolderId && filteredEligibleFolders.some((entry) => entry.id === selectedFolderId)
      ? selectedFolderId
      : (filteredEligibleFolders[0]?.id ?? null)
  const activeSelectedFolder =
    filteredEligibleFolders.find((folder) => folder.id === activeSelectedFolderId) ?? null

  const { showToast } = useToast()

  useEffect(() => {
    if (!notice) return
    const message =
      notice.kind === 'registered'
        ? t('dossiers.notice_registered', { name: notice.dossierName })
        : t('dossiers.notice_unregistered', { name: notice.dossierName })
    showToast(message)
    onClearNotice()
  }, [notice, onClearNotice, showToast, t])

  const errorMessage = resolveErrorMessage(error, errorCode, t)
  const closePicker = (): void => {
    setIsPickerOpen(false)
    setPickerQuery('')
    setSelectedFolderId(null)
  }

  return (
    <section className="flex min-h-[calc(100vh-8.5rem)] flex-col gap-6">
      <div className="mx-auto grid w-full gap-3 md:grid-cols-2 xl:max-w-5xl xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto]">
        <Field
          density="compact"
          label={t('dossiers.name_filter_label')}
          labelTone="eyebrow"
          htmlFor="dossier-name-filter"
        >
          <Input
            id="dossier-name-filter"
            type="search"
            density="compact"
            value={nameQuery}
            onChange={(event) => setNameQuery(event.target.value)}
            placeholder={t('dossiers.name_filter_placeholder')}
          />
        </Field>

        <Field
          density="compact"
          label={t('dossiers.filter_label')}
          labelTone="eyebrow"
          htmlFor="dossier-status-filter"
        >
          <Select
            id="dossier-status-filter"
            density="compact"
            value={statusFilter}
            onChange={(event) => onSetStatusFilter(event.target.value as DossierStatusFilter)}
          >
            <option value="all">{t('dossiers.filter_all')}</option>
            <option value="active">{t('dossiers.status_active')}</option>
            <option value="pending">{t('dossiers.status_pending')}</option>
            <option value="completed">{t('dossiers.status_completed')}</option>
            <option value="archived">{t('dossiers.status_archived')}</option>
          </Select>
        </Field>

        <Field
          density="compact"
          label={t('dossiers.sort_label')}
          labelTone="eyebrow"
          htmlFor="dossier-sort-mode"
        >
          <Select
            id="dossier-sort-mode"
            density="compact"
            value={sortMode}
            onChange={(event) => onSetSortMode(event.target.value as DossierSortMode)}
          >
            <option value="alphabetical">{t('dossiers.sort_alphabetical')}</option>
            <option value="next-key-date">{t('dossiers.sort_next_key_date')}</option>
            <option value="last-opened">{t('dossiers.sort_last_opened')}</option>
          </Select>
        </Field>

        <Button
          className="gap-2 md:col-span-2 xl:col-span-1 xl:self-end xl:mb-1"
          onClick={async () => {
            setPickerQuery('')
            setSelectedFolderId(null)
            setIsPickerOpen(true)
            await onLoadEligibleFolders()
          }}
          disabled={isLoading}
        >
          <span aria-hidden>+</span>
          <span>{t('dossiers.register_action')}</span>
        </Button>
      </div>

      {/* Notices & errors */}

      {errorMessage ? (
        <AlertBanner tone="error" className="p-4">
          {errorMessage}
        </AlertBanner>
      ) : null}

      {dossiers.length === 0 ? (
        <Card className="flex min-h-[24rem] flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
          <h3 className="text-lg font-semibold text-slate-50">{t('dossiers.empty_title')}</h3>
          <p className="max-w-xl text-sm leading-relaxed text-slate-300">
            {t('dossiers.empty_body')}
          </p>
        </Card>
      ) : filteredDossiers.length === 0 ? (
        <Card className="flex min-h-[24rem] flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
          <h3 className="text-lg font-semibold text-slate-50">
            {t('dossiers.filtered_empty_title')}
          </h3>
          <p className="max-w-xl text-sm leading-relaxed text-slate-300">
            {t('dossiers.filtered_empty_body')}
          </p>
        </Card>
      ) : (
        <div className="mx-auto grid w-full grid-cols-[repeat(auto-fit,minmax(18rem,22rem))] justify-center gap-4">
          {filteredDossiers.map((dossier) => (
            <DossierCard
              key={dossier.id}
              dossier={dossier}
              isActive={activeDossierId === dossier.id}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}

      {/* Folder picker modal */}
      {isPickerOpen ? (
        <DialogShell
          size="xl"
          panelClassName="min-h-[32rem]"
          aria-labelledby="dossier-picker-title"
        >
          <div className="space-y-1">
            <h3 id="dossier-picker-title" className="text-lg font-semibold text-slate-50">
              {t('dossiers.picker_title')}
            </h3>
            <p className="text-sm text-slate-300">{t('dossiers.picker_summary')}</p>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 py-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
            <div className="flex min-h-0 flex-col space-y-3">
              <label
                htmlFor="dossier-picker-search"
                className="text-xs uppercase tracking-[0.2em] text-aurora-soft"
              >
                {t('dossiers.picker_search_label')}
              </label>
              <Input
                id="dossier-picker-search"
                type="search"
                value={pickerQuery}
                onChange={(event) => setPickerQuery(event.target.value)}
                placeholder={t('dossiers.picker_search_placeholder')}
              />

              {isLoading && visibleEligibleFolders.length === 0 ? (
                <p className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 text-sm text-slate-300">
                  {t('dossiers.picker_loading')}
                </p>
              ) : visibleEligibleFolders.length === 0 ? (
                <p className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 text-sm text-slate-300">
                  {t('dossiers.picker_empty')}
                </p>
              ) : filteredEligibleFolders.length === 0 ? (
                <p className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 text-sm text-slate-300">
                  {t('dossiers.picker_no_results')}
                </p>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/45">
                  <div className="divide-y divide-white/10">
                    {filteredEligibleFolders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => setSelectedFolderId(folder.id)}
                        className={cn(
                          'w-full px-4 py-3 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/35',
                          activeSelectedFolderId === folder.id ? 'bg-aurora/12' : 'bg-transparent'
                        )}
                        aria-pressed={activeSelectedFolderId === folder.id}
                      >
                        <strong className="block text-sm text-slate-50">{folder.name}</strong>
                        <span className="mt-1 block break-all text-xs text-slate-400">
                          {folder.path}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-aurora-soft">
                {t('dossiers.picker_selected_label')}
              </p>
              {activeSelectedFolder ? (
                <div className="mt-4 flex-1 space-y-3">
                  <div>
                    <h4 className="text-xl font-semibold text-slate-50">
                      {activeSelectedFolder.name}
                    </h4>
                    <p className="mt-2 break-all text-sm text-slate-300">
                      {activeSelectedFolder.path}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-300">
                  {isLoading && visibleEligibleFolders.length === 0
                    ? t('dossiers.picker_loading')
                    : normalizedPickerQuery.length > 0
                      ? t('dossiers.picker_no_results')
                      : t('dossiers.picker_empty')}
                </p>
              )}
            </div>
          </div>

          <div className="mt-auto flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={closePicker}>
              {t('dossiers.picker_cancel_action')}
            </Button>
            <Button
              disabled={isLoading || !activeSelectedFolderId}
              onClick={async () => {
                if (!activeSelectedFolderId) {
                  return
                }

                const didRegister = await onRegister(activeSelectedFolderId)
                if (didRegister) {
                  closePicker()
                }
              }}
            >
              {t('dossiers.picker_confirm_action')}
            </Button>
          </div>
        </DialogShell>
      ) : null}
    </section>
  )
}
