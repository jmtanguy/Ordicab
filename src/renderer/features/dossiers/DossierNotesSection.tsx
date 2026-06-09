import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  DossierNote,
  DossierNoteDeleteInput,
  DossierNoteKind,
  DossierNoteUpsertInput
} from '@shared/types'
import { NOTE_KIND_VALUES } from '@shared/types'

import { Button, DialogShell, Field, Input, Select, Textarea } from '@renderer/components/ui'

import {
  ColumnHeader,
  DeleteConfirmTray,
  IconButton,
  ListContainer,
  PencilIcon,
  PillSelect,
  SearchField,
  SectionHeader,
  TrashIcon
} from './sectionLayout'

interface DossierNotesSectionProps {
  dossierId: string
  dossierName: string
  entries: DossierNote[]
  disabled: boolean
  onSave: (input: DossierNoteUpsertInput) => Promise<boolean>
  onDelete: (input: DossierNoteDeleteInput) => Promise<boolean>
}

interface NoteEditorState {
  id?: string
  title: string
  content: string
  kind: DossierNoteKind
  done: boolean
  pinned: boolean
  tagsText: string
}

type KindFilter = 'all' | DossierNoteKind
type StatusFilter = 'all' | 'open' | 'done'

const KIND_LABEL_KEYS: Record<DossierNoteKind, string> = {
  note: 'dossiers.notes_kind_note',
  todo: 'dossiers.notes_kind_todo',
  idea: 'dossiers.notes_kind_idea',
  to_verify: 'dossiers.notes_kind_to_verify',
  ai_log: 'dossiers.notes_kind_ai_log'
}

const KIND_DEFAULTS: Record<DossierNoteKind, string> = {
  note: 'Note',
  todo: 'À faire',
  idea: 'Idée',
  to_verify: 'À vérifier',
  ai_log: 'Journal IA'
}

function parseTags(text: string): string[] | undefined {
  const tags = Array.from(
    new Set(
      text
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    )
  )
  return tags.length > 0 ? tags : undefined
}

export function DossierNotesSection({
  dossierId,
  entries,
  disabled,
  onSave,
  onDelete
}: DossierNotesSectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const [editor, setEditor] = useState<NoteEditorState | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const kindLabel = (kind: DossierNoteKind): string =>
    t(KIND_LABEL_KEYS[kind], { defaultValue: KIND_DEFAULTS[kind] })

  // Pinned first, then most-recently updated.
  const orderedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [entries])

  const searchTerms = searchFilter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)

  const filteredEntries = useMemo(() => {
    return orderedEntries.filter((entry) => {
      if (kindFilter !== 'all' && entry.kind !== kindFilter) return false
      if (statusFilter === 'open' && entry.status === 'done') return false
      if (statusFilter === 'done' && entry.status !== 'done') return false
      if (searchTerms.length === 0) return true
      const haystack =
        `${entry.title} ${entry.content} ${(entry.tags ?? []).join(' ')}`.toLowerCase()
      return searchTerms.every((term) => haystack.includes(term))
    })
  }, [orderedEntries, kindFilter, statusFilter, searchTerms])

  const countLabel =
    entries.length === 0
      ? null
      : filteredEntries.length === entries.length
        ? t('dossiers.notes_count_total', {
            count: entries.length,
            defaultValue: '{{count}} note(s)'
          })
        : t('dossiers.notes_count_filtered', {
            count: filteredEntries.length,
            total: entries.length,
            defaultValue: '{{count}} sur {{total}}'
          })

  const openCreate = (): void =>
    setEditor({
      title: '',
      content: '',
      kind: 'note',
      done: false,
      pinned: false,
      tagsText: ''
    })

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        <SectionHeader
          badge={t('dossiers.notes_badge', { defaultValue: 'Notes' })}
          count={countLabel}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={openCreate}
            >
              {t('dossiers.notes_add_action', { defaultValue: 'Ajouter une note' })}
            </Button>
          }
        />

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SearchField
            id="notes-search"
            value={searchFilter}
            onChange={setSearchFilter}
            placeholder={t('dossiers.notes_filter_search_placeholder', {
              defaultValue: 'Rechercher une note…'
            })}
            ariaLabel={t('dossiers.notes_filter_search_label', { defaultValue: 'Rechercher' })}
          />
          <PillSelect<KindFilter>
            id="notes-kind-filter"
            value={kindFilter}
            onChange={setKindFilter}
            ariaLabel={t('dossiers.notes_filter_kind_label', { defaultValue: 'Filtrer par type' })}
          >
            <option value="all">
              {t('dossiers.notes_filter_all_kinds', { defaultValue: 'Tous' })}
            </option>
            {NOTE_KIND_VALUES.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabel(kind)}
              </option>
            ))}
          </PillSelect>
          <PillSelect<StatusFilter>
            id="notes-status-filter"
            value={statusFilter}
            onChange={setStatusFilter}
            ariaLabel={t('dossiers.notes_filter_status_label', {
              defaultValue: 'Filtrer par statut'
            })}
          >
            <option value="all">
              {t('dossiers.notes_filter_all_status', { defaultValue: 'Tout statut' })}
            </option>
            <option value="open">
              {t('dossiers.notes_filter_open', { defaultValue: 'À faire' })}
            </option>
            <option value="done">
              {t('dossiers.notes_filter_done', { defaultValue: 'Fait' })}
            </option>
          </PillSelect>
        </div>

        {entries.length === 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={openCreate}
            className="w-full shrink-0 rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-left text-sm text-[#1a1a1a] transition hover:border-aurora/50 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('dossiers.notes_empty', {
              defaultValue: 'Aucune note. Notez ici vos rappels, idées et points à vérifier.'
            })}
          </button>
        ) : filteredEntries.length === 0 ? (
          <p className="shrink-0 rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-sm text-[#1a1a1a]">
            {t('dossiers.notes_no_results', { defaultValue: 'Aucune note ne correspond.' })}
          </p>
        ) : (
          <ListContainer>
            <ColumnHeader>
              <span className="w-24 shrink-0">
                {t('dossiers.notes_column_kind', { defaultValue: 'Type' })}
              </span>
              <span className="flex-1">
                {t('dossiers.notes_column_title', { defaultValue: 'Note' })}
              </span>
              <span className="w-16 shrink-0" aria-hidden="true" />
            </ColumnHeader>
            <ul className="h-[calc(100%-2.25rem)] divide-y divide-deep-space overflow-y-auto">
              {filteredEntries.map((entry) => {
                const isConfirming = confirmingDeleteId === entry.id
                const isDone = entry.status === 'done'
                return (
                  <li
                    key={entry.id}
                    className="group relative flex items-start gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-[#fbf9f4]"
                  >
                    <span className="mt-0.5 w-24 shrink-0">
                      <span className="inline-flex items-center rounded-full border border-[#e5e3da] bg-[#fbf9f4] px-2 py-0.5 text-[11px] text-[#1a1a1a]">
                        {kindLabel(entry.kind)}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            isDone
                              ? 'truncate text-sm font-medium text-[#1a1a1a]/50 line-through'
                              : 'truncate text-sm font-medium text-[#1a1a1a]'
                          }
                        >
                          {entry.pinned ? '📌 ' : ''}
                          {entry.title}
                        </span>
                        {entry.source === 'ai' ? (
                          <span
                            className="shrink-0 rounded-full bg-aurora/10 px-1.5 py-0.5 text-[10px] font-medium text-aurora"
                            title={t('dossiers.notes_source_ai', {
                              defaultValue: 'Créée par l’assistant IA'
                            })}
                          >
                            {t('dossiers.notes_source_ai_badge', { defaultValue: 'IA' })}
                          </span>
                        ) : null}
                      </div>
                      {entry.content ? (
                        <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-[#1a1a1a]/70">
                          {entry.content}
                        </p>
                      ) : null}
                      {entry.tags && entry.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {entry.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-[#f1efe7] px-1.5 py-0.5 text-[10px] text-[#1a1a1a]/70"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
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
                          label={t('dossiers.notes_edit_action', { defaultValue: 'Modifier' })}
                          disabled={disabled}
                          onClick={() =>
                            setEditor({
                              id: entry.id,
                              title: entry.title,
                              content: entry.content,
                              kind: entry.kind,
                              done: entry.status === 'done',
                              pinned: Boolean(entry.pinned),
                              tagsText: (entry.tags ?? []).join(', ')
                            })
                          }
                        >
                          <PencilIcon />
                        </IconButton>
                        <IconButton
                          label={t('dossiers.notes_delete_action', { defaultValue: 'Supprimer' })}
                          tone="danger"
                          disabled={disabled}
                          onClick={() => setConfirmingDeleteId(entry.id)}
                        >
                          <TrashIcon />
                        </IconButton>
                      </div>
                      {isConfirming ? (
                        <div className="absolute right-0 top-1/2 -translate-y-1/2">
                          <DeleteConfirmTray
                            label={t('dossiers.notes_delete_confirm_label', {
                              defaultValue: 'Supprimer cette note ?'
                            })}
                            confirmLabel={t('dossiers.notes_delete_confirm_action', {
                              defaultValue: 'Supprimer'
                            })}
                            cancelLabel={t('dossiers.notes_delete_cancel_action', {
                              defaultValue: 'Annuler'
                            })}
                            disabled={disabled}
                            onConfirm={async () => {
                              await onDelete({ dossierId, noteId: entry.id })
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
      </div>

      {editor ? (
        <DialogShell
          size="xl"
          aria-label={
            editor.id
              ? t('dossiers.notes_edit_action', { defaultValue: 'Modifier la note' })
              : t('dossiers.notes_add_action', { defaultValue: 'Ajouter une note' })
          }
          onDismiss={() => setEditor(null)}
        >
          <div>
            <h3 className="text-lg font-semibold text-[#1a1a1a]">
              {editor.id
                ? t('dossiers.notes_edit_action', { defaultValue: 'Modifier la note' })
                : t('dossiers.notes_add_action', { defaultValue: 'Ajouter une note' })}
            </h3>
            <p className="mt-1 text-sm text-[#1a1a1a]">
              {t('dossiers.notes_form_hint', {
                defaultValue: 'Rappels, idées, suppositions à vérifier ou tâches à faire.'
              })}
            </p>
          </div>

          <form
            className="flex flex-col gap-0"
            onSubmit={async (event) => {
              event.preventDefault()
              const saved = await onSave({
                id: editor.id,
                dossierId,
                title: editor.title,
                content: editor.content,
                kind: editor.kind,
                status:
                  editor.kind === 'todo' || editor.done
                    ? editor.done
                      ? 'done'
                      : 'open'
                    : undefined,
                tags: parseTags(editor.tagsText),
                pinned: editor.pinned
              })
              if (saved) setEditor(null)
            }}
          >
            <div className="grid gap-4 py-5">
              <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                <Field
                  label={t('dossiers.notes_form_title', { defaultValue: 'Titre' })}
                  htmlFor="note-title"
                >
                  <Input
                    id="note-title"
                    type="text"
                    value={editor.title}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, title: event.target.value } : current
                      )
                    }
                    placeholder={t('dossiers.notes_form_title_placeholder', {
                      defaultValue: 'Ex. Vérifier la prescription'
                    })}
                    required
                  />
                </Field>
                <Field
                  label={t('dossiers.notes_form_kind', { defaultValue: 'Type' })}
                  htmlFor="note-kind"
                >
                  <Select
                    id="note-kind"
                    value={editor.kind}
                    onChange={(event) =>
                      setEditor((current) =>
                        current
                          ? { ...current, kind: event.target.value as DossierNoteKind }
                          : current
                      )
                    }
                  >
                    {NOTE_KIND_VALUES.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabel(kind)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label={t('dossiers.notes_form_content', { defaultValue: 'Contenu' })}
                htmlFor="note-content"
              >
                <Textarea
                  id="note-content"
                  rows={6}
                  value={editor.content}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, content: event.target.value } : current
                    )
                  }
                  placeholder={t('dossiers.notes_form_content_placeholder', {
                    defaultValue: 'Détaillez votre note…'
                  })}
                />
              </Field>

              <Field
                label={t('dossiers.notes_form_tags', {
                  defaultValue: 'Tags (séparés par des virgules)'
                })}
                htmlFor="note-tags"
              >
                <Input
                  id="note-tags"
                  type="text"
                  value={editor.tagsText}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, tagsText: event.target.value } : current
                    )
                  }
                  placeholder={t('dossiers.notes_form_tags_placeholder', {
                    defaultValue: 'prescription, à rappeler client'
                  })}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-sm text-[#1a1a1a]">
                  <input
                    type="checkbox"
                    checked={editor.done}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, done: event.target.checked } : current
                      )
                    }
                  />
                  {t('dossiers.notes_form_done', { defaultValue: 'Marquer comme fait' })}
                </label>
                <label className="flex items-center gap-2 text-sm text-[#1a1a1a]">
                  <input
                    type="checkbox"
                    checked={editor.pinned}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, pinned: event.target.checked } : current
                      )
                    }
                  />
                  {t('dossiers.notes_form_pinned', { defaultValue: 'Épingler en haut' })}
                </label>
              </div>
            </div>

            <div className="mt-auto flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditor(null)}
                disabled={disabled}
              >
                {t('dossiers.notes_cancel_action', { defaultValue: 'Annuler' })}
              </Button>
              <Button type="submit" disabled={disabled}>
                {editor.id
                  ? t('dossiers.notes_save_edit_action', { defaultValue: 'Enregistrer' })
                  : t('dossiers.notes_save_create_action', { defaultValue: 'Créer la note' })}
              </Button>
            </div>
          </form>
        </DialogShell>
      ) : null}
    </>
  )
}
