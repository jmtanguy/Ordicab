import { Fragment, useMemo, useState } from 'react'
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
  /** Moves a template into a category (null = remove from its category). */
  onMoveToCategory: (templateUuid: string, category: string | null) => Promise<void>
}

type SortBy = 'name-asc' | 'name-desc'
type KindFilter = 'all' | TemplateDocumentKind

const KIND_LABEL: Record<TemplateDocumentKind, string> = {
  document: 'Document',
  invoice: 'Facture',
  creditNote: 'Avoir',
  correctiveInvoice: 'Rectificative'
}

function GripIcon(): React.JSX.Element {
  return (
    <svg width="10" height="14" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1.3" />
      <circle cx="7" cy="3" r="1.3" />
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="7" cy="8" r="1.3" />
      <circle cx="3" cy="13" r="1.3" />
      <circle cx="7" cy="13" r="1.3" />
    </svg>
  )
}

function FolderIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
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
  onOpenLibrary,
  onMoveToCategory
}: TemplateListProps): React.JSX.Element {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('name-asc')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  // Drag & drop state: dragged template + hovered drop zone ('' = uncategorized, '__new__' = create)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [newCategoryTemplateId, setNewCategoryTemplateId] = useState<string | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')

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

  // Group by category — named categories alphabetically, uncategorized last.
  const grouped = useMemo(() => {
    const map = new Map<string, TemplateRecord[]>()
    for (const tpl of filtered) {
      const key = tpl.category ?? ''
      const list = map.get(key) ?? []
      list.push(tpl)
      map.set(key, list)
    }
    const categories = [...map.keys()]
      .filter((key) => key !== '')
      .sort((a, b) => a.localeCompare(b))
    return { categories, map }
  }, [filtered])

  const hasCategories = grouped.categories.length > 0

  async function handleDrop(category: string | null): Promise<void> {
    const templateUuid = draggingId
    setDropTarget(null)
    setDraggingId(null)
    if (!templateUuid) return
    const template = templates.find((tpl) => tpl.uuid === templateUuid)
    if (!template || (template.category ?? null) === category) return
    await onMoveToCategory(templateUuid, category)
  }

  async function submitNewCategory(): Promise<void> {
    const templateUuid = newCategoryTemplateId
    const name = newCategoryName.trim()
    setNewCategoryTemplateId(null)
    setNewCategoryName('')
    if (!templateUuid || !name) return
    await onMoveToCategory(templateUuid, name)
  }

  const dropZoneProps = (key: string): React.HTMLAttributes<HTMLLIElement> => ({
    onDragOver: (event) => {
      if (!draggingId) return
      event.preventDefault()
      setDropTarget(key)
    },
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (event) => {
      event.preventDefault()
      if (key === '__new__') {
        const templateUuid = draggingId
        setDropTarget(null)
        setDraggingId(null)
        if (templateUuid) {
          setNewCategoryTemplateId(templateUuid)
          setNewCategoryName('')
        }
        return
      }
      void handleDrop(key === '' ? null : key)
    }
  })

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
        <p className="shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
          {t('templates.loading')}
        </p>
      ) : templates.length === 0 ? (
        <button
          type="button"
          onClick={onCreate}
          className="w-full shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-left text-sm text-ink transition hover:border-aurora/50 hover:text-ink"
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
            <p className="shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
              {t('templates.list.noResults', { defaultValue: 'Aucun résultat' })}
            </p>
          ) : (
            <ListContainer>
              <ul className="h-full divide-y divide-deep-space overflow-y-auto">
                {newCategoryTemplateId ? (
                  <li className="flex items-center gap-2 bg-aurora/5 px-4 py-2">
                    <span className="text-xs text-ink-muted">
                      {t('templates.list.newCategoryName')}
                    </span>
                    <input
                      autoFocus
                      type="text"
                      value={newCategoryName}
                      onChange={(event) => setNewCategoryName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void submitNewCategory()
                        if (event.key === 'Escape') {
                          setNewCategoryTemplateId(null)
                          setNewCategoryName('')
                        }
                      }}
                      onBlur={() => void submitNewCategory()}
                      className="rounded-xl border border-hairline bg-white px-3 py-1 text-sm text-ink outline-none focus:border-aurora"
                    />
                  </li>
                ) : null}
                {draggingId ? (
                  <li
                    {...dropZoneProps('__new__')}
                    className={`px-4 py-2 text-center text-xs transition-colors ${
                      dropTarget === '__new__'
                        ? 'bg-aurora/10 text-aurora'
                        : 'bg-parchment text-ink-muted'
                    }`}
                  >
                    {t('templates.list.newCategoryDropZone')}
                  </li>
                ) : null}
                {[
                  ...grouped.categories.map((category) => ({
                    key: category,
                    label: category,
                    items: grouped.map.get(category) ?? []
                  })),
                  ...(grouped.map.has('') || hasCategories
                    ? [
                        {
                          key: '',
                          label: t('templates.list.uncategorized'),
                          items: grouped.map.get('') ?? []
                        }
                      ]
                    : [])
                ].map((section) => (
                  <Fragment key={section.key || '__uncategorized__'}>
                    {hasCategories ? (
                      <li
                        {...dropZoneProps(section.key)}
                        className={`flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                          dropTarget === section.key
                            ? 'bg-aurora/10 text-aurora'
                            : 'bg-parchment text-ink-muted'
                        }`}
                      >
                        <FolderIcon />
                        {section.label}
                        <span className="font-normal normal-case tracking-normal text-ink-subtle">
                          ({section.items.length})
                        </span>
                      </li>
                    ) : null}
                    {section.items.map((template) => {
                      const isConfirming = confirmingDeleteId === template.uuid
                      return (
                        <li
                          key={template.uuid}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/plain', template.uuid)
                            event.dataTransfer.effectAllowed = 'move'
                            // Mutating the DOM during dragstart aborts the drag in
                            // Chromium — defer the state update to the next tick.
                            window.setTimeout(() => setDraggingId(template.uuid), 0)
                          }}
                          onDragEnd={() => {
                            setDraggingId(null)
                            setDropTarget(null)
                          }}
                          className={`group relative flex cursor-grab items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-parchment-bright ${
                            draggingId === template.uuid ? 'opacity-50' : ''
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            title={t('templates.list.dragHint')}
                            className="shrink-0 cursor-grab text-ink-subtle opacity-40 transition group-hover:opacity-100"
                          >
                            <GripIcon />
                          </span>
                          <div className="flex min-w-0 flex-1 items-baseline gap-2">
                            {template.hasDocxSource ? (
                              <span className="shrink-0 rounded-full border border-success-border bg-success-tint px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-success-deep">
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
                            <span className="truncate text-sm font-semibold text-ink">
                              {template.name}
                            </span>
                            {template.category ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline bg-parchment px-2 py-0.5 text-[11px] text-ink-muted">
                                <FolderIcon />
                                {template.category}
                              </span>
                            ) : null}
                            {template.description ? (
                              <span className="min-w-0 truncate text-xs text-ink-muted">
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
                                onClick={() => setConfirmingDeleteId(template.uuid)}
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
                                    await onDelete(template.uuid)
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
                  </Fragment>
                ))}
              </ul>
            </ListContainer>
          )}
        </>
      )}
    </div>
  )
}
