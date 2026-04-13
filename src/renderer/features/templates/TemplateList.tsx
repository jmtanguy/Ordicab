import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TemplateRecord } from '@shared/types'

import { Button, Card } from '@renderer/components/ui'

interface TemplateListProps {
  isLoading: boolean
  templates: TemplateRecord[]
  onCreate: () => void
  onDelete: (id: string) => Promise<void>
  onEdit: (template: TemplateRecord) => void
  onGenerate: (template: TemplateRecord) => void
  onMacros: () => void
}

type SortBy = 'name-asc' | 'name-desc'

export function TemplateList({
  isLoading,
  templates,
  onCreate,
  onDelete,
  onEdit,
  onGenerate,
  onMacros
}: TemplateListProps): React.JSX.Element {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('name-asc')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = needle
      ? templates.filter(
          (tpl) =>
            tpl.name.toLowerCase().includes(needle) ||
            (tpl.description ?? '').toLowerCase().includes(needle)
        )
      : templates
    return [...list].sort((a, b) =>
      sortBy === 'name-desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
    )
  }, [templates, search, sortBy])

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{t('nav.tab_modeles')}</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onMacros}>
            {t('templates.actions.macros')}
          </Button>
          <Button onClick={onCreate}>{t('templates.newButton')}</Button>
        </div>
      </div>

      {!isLoading && templates.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_13rem]">
          <label
            htmlFor="template-list-search"
            className="flex flex-col gap-2 text-sm text-slate-100"
          >
            <span>{t('templates.list.searchLabel')}</span>
            <input
              id="template-list-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('templates.list.searchPlaceholder')}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
            />
          </label>

          <label
            htmlFor="template-list-sort"
            className="flex flex-col gap-2 text-sm text-slate-100"
          >
            <span>{t('templates.list.sortLabel')}</span>
            <select
              id="template-list-sort"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortBy)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
            >
              <option value="name-asc">{t('templates.list.sortNameAsc')}</option>
              <option value="name-desc">{t('templates.list.sortNameDesc')}</option>
            </select>
          </label>
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-8 text-sm text-slate-300">
          {t('templates.loading')}
        </div>
      ) : null}

      {!isLoading && templates.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/12 bg-slate-950/30 px-6 py-10 text-center">
          <p className="max-w-sm text-sm text-slate-300">{t('templates.emptyState')}</p>
          <Button onClick={onCreate}>{t('templates.newButton')}</Button>
        </div>
      ) : null}

      {!isLoading && templates.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="space-y-3">
            {filtered.map((template) => {
              const isPendingDelete = pendingDeleteId === template.id

              return (
                <div
                  key={template.id}
                  className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-4 transition hover:border-white/20"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-baseline gap-3">
                      <p className="shrink-0 text-sm font-semibold text-slate-100">
                        {template.name}
                      </p>
                      {template.hasDocxSource ? (
                        <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-emerald-200">
                          {t('templates.list.docxBadge')}
                        </span>
                      ) : null}
                      {template.description ? (
                        <p className="truncate text-sm text-slate-400">{template.description}</p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onGenerate(template)}
                        aria-label={t('templates.actions.generateAria', { name: template.name })}
                      >
                        {t('templates.actions.generate')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(template)}
                        aria-label={t('templates.actions.editAria', { name: template.name })}
                      >
                        {t('templates.actions.edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDeleteId(template.id)}
                        aria-label={t('templates.actions.deleteAria', { name: template.name })}
                        className="border border-white/10 text-rose-400 hover:border-rose-400/30 hover:bg-rose-400/10 hover:text-rose-300"
                      >
                        {t('templates.actions.delete')}
                      </Button>
                    </div>
                  </div>

                  {/* Inline delete confirmation */}
                  {isPendingDelete ? (
                    <div className="mt-3 flex items-center justify-end gap-3 rounded-xl border border-rose-300/20 bg-rose-300/5 px-4 py-2.5">
                      <span className="text-sm text-rose-200">
                        {t('templates.list.deleteConfirmMessage', { name: template.name })}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => setPendingDeleteId(null)}>
                        {t('templates.list.deleteCancelAction')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="border border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20"
                        onClick={() => {
                          setPendingDeleteId(null)
                          void onDelete(template.id)
                        }}
                      >
                        {t('templates.list.deleteConfirmAction')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </Card>
  )
}
