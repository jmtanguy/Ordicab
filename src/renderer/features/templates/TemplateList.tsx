import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  TEMPLATE_DOCUMENT_KIND_VALUES,
  type TemplateDocumentKind,
  type TemplateRecord
} from '@shared/types'

import { Button } from '@renderer/components/ui'
import {
  DeleteConfirmTray,
  IconButton,
  ListContainer,
  PencilIcon,
  PillSelect,
  SearchField,
  SectionHeader,
  TrashIcon
} from '@renderer/features/dossiers/sectionLayout'

interface TemplateListProps {
  isLoading: boolean
  templates: TemplateRecord[]
  onCreate: () => void
  onDelete: (id: string) => Promise<void>
  onEdit: (template: TemplateRecord) => void
  onMacros: () => void
  onOpenLibrary: () => void
}

type SortBy = 'name-asc' | 'name-desc'
type KindFilter = 'all' | TemplateDocumentKind

const KIND_LABEL: Record<TemplateDocumentKind, string> = {
  document: 'Document',
  invoice: 'Facture',
  creditNote: 'Avoir',
  correctiveInvoice: 'Rectificative'
}

const KIND_STYLE: Record<TemplateDocumentKind, string> = {
  document: 'bg-[#f4f1e8] text-[#6b5d3a] border-[#d8d3c4]',
  invoice: 'bg-sky-50 text-sky-700 border-sky-200',
  creditNote: 'bg-amber-50 text-amber-700 border-amber-200',
  correctiveInvoice: 'bg-indigo-50 text-indigo-700 border-indigo-200'
}

export function TemplateList({
  isLoading,
  templates,
  onCreate,
  onDelete,
  onEdit,
  onMacros,
  onOpenLibrary
}: TemplateListProps): React.JSX.Element {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('name-asc')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = templates.filter((tpl) => {
      if (kindFilter !== 'all' && (tpl.documentKind ?? 'document') !== kindFilter) return false
      if (!needle) return true
      return (
        tpl.name.toLowerCase().includes(needle) ||
        (tpl.description ?? '').toLowerCase().includes(needle)
      )
    })
    return [...list].sort((a, b) =>
      sortBy === 'name-desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
    )
  }, [templates, search, sortBy, kindFilter])

  const countLabel =
    templates.length === 0
      ? null
      : filtered.length === templates.length
        ? t('templates.list.countTotal', {
            count: templates.length,
            defaultValue: '{{count}} modèle(s)'
          })
        : t('templates.list.countFiltered', {
            count: filtered.length,
            total: templates.length,
            defaultValue: '{{count}} sur {{total}}'
          })

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <SectionHeader
        badge={t('nav.tab_modeles')}
        count={countLabel}
        actions={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={onMacros}>
              {t('templates.actions.macros')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onOpenLibrary}>
              {t('templates.actions.library', { defaultValue: 'Bibliothèque' })}
            </Button>
            <Button type="button" size="sm" onClick={onCreate}>
              {t('templates.newButton')}
            </Button>
          </>
        }
      />

      {isLoading ? (
        <p className="shrink-0 rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-sm text-[#1a1a1a]">
          {t('templates.loading')}
        </p>
      ) : templates.length === 0 ? (
        <button
          type="button"
          onClick={onCreate}
          className="w-full shrink-0 rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-left text-sm text-[#1a1a1a] transition hover:border-aurora/50 hover:text-[#1a1a1a]"
        >
          {t('templates.emptyState')}
        </button>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SearchField
              id="template-list-search"
              value={search}
              onChange={setSearch}
              placeholder={t('templates.list.searchPlaceholder')}
              ariaLabel={t('templates.list.searchLabel')}
            />
            <PillSelect<KindFilter>
              id="template-list-kind-filter"
              value={kindFilter}
              onChange={setKindFilter}
              ariaLabel={t('templates.list.kindFilterLabel', {
                defaultValue: 'Filtrer par type'
              })}
            >
              <option value="all">
                {t('templates.list.kindAll', { defaultValue: 'Tous types' })}
              </option>
              {TEMPLATE_DOCUMENT_KIND_VALUES.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </PillSelect>
            <PillSelect<SortBy>
              id="template-list-sort"
              value={sortBy}
              onChange={setSortBy}
              ariaLabel={t('templates.list.sortLabel')}
            >
              <option value="name-asc">{t('templates.list.sortNameAsc')}</option>
              <option value="name-desc">{t('templates.list.sortNameDesc')}</option>
            </PillSelect>
          </div>

          {filtered.length === 0 ? (
            <p className="shrink-0 rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-sm text-[#1a1a1a]">
              {t('templates.list.noResults', { defaultValue: 'Aucun résultat' })}
            </p>
          ) : (
            <ListContainer>
              <ul className="h-full divide-y divide-deep-space overflow-y-auto">
                {filtered.map((template) => {
                  const isConfirming = confirmingDeleteId === template.id
                  return (
                    <li
                      key={template.id}
                      className="group relative flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[#fbf9f4]"
                    >
                      <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        {template.hasDocxSource ? (
                          <span className="shrink-0 rounded-full border border-[#cfe0c5] bg-[#f1f7ec] px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-[#3c6132]">
                            {t('templates.list.docxBadge')}
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full border border-[#d8d3c4] bg-[#f4f1e8] px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-[#6b5d3a]">
                            {t('templates.list.textBadge')}
                          </span>
                        )}
                        {(() => {
                          const kind = template.documentKind ?? 'document'
                          if (kind === 'document') return null
                          return (
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] ${KIND_STYLE[kind]}`}
                            >
                              {KIND_LABEL[kind]}
                            </span>
                          )
                        })()}
                        <span className="truncate text-sm font-semibold text-[#1a1a1a]">
                          {template.name}
                        </span>
                        {template.description ? (
                          <span className="min-w-0 truncate text-xs text-[#5c5c5a]">
                            {template.description}
                          </span>
                        ) : null}
                      </div>

                      <div className="relative flex shrink-0 items-center gap-1">
                        <div
                          className={
                            isConfirming
                              ? 'invisible flex items-center gap-1'
                              : 'flex items-center gap-1'
                          }
                        >
                          <IconButton
                            label={t('templates.actions.edit')}
                            onClick={() => onEdit(template)}
                          >
                            <PencilIcon />
                          </IconButton>
                          <IconButton
                            label={t('templates.actions.delete')}
                            tone="danger"
                            onClick={() => setConfirmingDeleteId(template.id)}
                          >
                            <TrashIcon />
                          </IconButton>
                        </div>
                        {isConfirming ? (
                          <div className="absolute right-0 top-1/2 -translate-y-1/2">
                            <DeleteConfirmTray
                              label={t('templates.list.deleteConfirmMessage', {
                                name: template.name
                              })}
                              confirmLabel={t('templates.list.deleteConfirmAction')}
                              cancelLabel={t('templates.list.deleteCancelAction')}
                              onConfirm={async () => {
                                await onDelete(template.id)
                                setConfirmingDeleteId(null)
                              }}
                              onCancel={() => setConfirmingDeleteId(null)}
                            />
                          </div>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </ListContainer>
          )}
        </>
      )}
    </div>
  )
}
