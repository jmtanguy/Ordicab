import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

import {
  DOSSIER_INFORMATION_REFERENCE_LABEL,
  DOSSIER_JURIDICTION_REFERENCE_LABEL,
  DOSSIER_NAME_REFERENCE_LABEL,
  DOSSIER_STATUS_REFERENCE_LABEL,
  DOSSIER_TRIBUNAL_REFERENCE_LABEL,
  DOSSIER_TYPE_REFERENCE_LABEL,
  isDossierNameReferenceLabel,
  type DossierDetail,
  type DossierKeyReferenceUpsertInput,
  type DossierStatus,
  type DossierSummary
} from '@shared/types'

import { dossierStatusLabel } from '@renderer/lib/domainLabels'
import { cn } from '@renderer/lib/utils'
import type { DossierSortMode, DossierStatusFilter } from '@renderer/stores/dossierStore'

import ordicabLogo from '../../../../resources/icon.png'

import { useTimerStore } from '@renderer/stores/timerStore'
import { selectDossierIndexing, useIndexingStore } from '@renderer/stores/indexingStore'

import { TimerIndicator } from './TimerIndicator'
import { DossierActivityBar, type ActivityItem } from './DossierActivityBar'

export type SidebarDestination =
  | 'dossiers'
  | 'global-search'
  | 'cabinet'
  | 'modeles'
  | 'factures'
  | 'legal'
  | 'parametres'

export type DossierSection =
  | 'contacts'
  | 'convention'
  | 'aide-juridictionnelle'
  | 'prestations'
  | 'factures'
  | 'echeances'
  | 'references'
  | 'notes'
  | 'documents'
  | 'pieces'
  | 'compare'
  | 'search'
  | 'legal'
  | 'legal-verify'
  | 'generate'
  | 'ai-assistant'
  | 'cowork'

const statusDotClasses: Record<DossierStatus, string> = {
  active: 'bg-success',
  pending: 'bg-warning',
  completed: 'bg-ink-subtle',
  archived: 'bg-hairline-strong'
}

const dossierStatuses: DossierStatus[] = ['active', 'pending', 'completed', 'archived']

function findDossierReferenceByLabel(
  dossier: DossierDetail,
  label: string
): DossierDetail['keyReferences'][number] | undefined {
  return dossier.keyReferences.find(
    (entry) => entry.label.trim().toLocaleLowerCase('fr-FR') === label.toLocaleLowerCase('fr-FR')
  )
}

interface SidebarProps {
  // Routing / level state
  destination: SidebarDestination
  activeDossier: DossierDetail | null
  activeDossierId: string | null
  activeSection: DossierSection
  isDetailLoading: boolean

  // Brand / version
  versionLabel: string

  // Level 1 — dossiers list
  dossiers: DossierSummary[]
  isDossierLoading: boolean
  statusFilter: DossierStatusFilter
  sortMode: DossierSortMode
  searchQuery: string

  // Level 1 actions
  onSelectDestination: (destination: SidebarDestination) => void
  onOpenDossier: (id: string) => void
  onOpenPicker: () => void
  onSetStatusFilter: (filter: DossierStatusFilter) => void
  onSetSortMode: (mode: DossierSortMode) => void
  onSetSearchQuery: (query: string) => void

  // Level 2 actions
  onCloseDossier: () => void
  onSelectSection: (section: DossierSection) => void
  onRenameDossier: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  onUnregisterDossier: (id: string) => Promise<boolean>
}

export function Sidebar(props: SidebarProps): React.JSX.Element {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const brandName = t('shell.brand_name')
  const normalizedVersionLabel = props.versionLabel.startsWith(`${brandName} `)
    ? props.versionLabel.slice(brandName.length + 1)
    : props.versionLabel

  const showLevel2 = props.activeDossierId !== null

  const slideTransition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 360, damping: 36, mass: 0.85 }

  return (
    <aside className="relative flex h-screen w-80 shrink-0 flex-col border-r border-hairline bg-parchment">
      {/* Brand header */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-hairline px-4">
        <img src={ordicabLogo} alt={brandName} className="h-7 w-7 shrink-0 object-contain" />
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-base font-semibold text-ink">{brandName}</span>
          <span className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
            {normalizedVersionLabel}
          </span>
        </div>
      </div>

      {/* Push/pop region */}
      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          {showLevel2 ? (
            <motion.div
              key="level-2"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={slideTransition}
              className="absolute inset-0 flex flex-col"
            >
              <SidebarLevel2
                activeDossier={props.activeDossier}
                activeDossierId={props.activeDossierId}
                isDetailLoading={props.isDetailLoading}
                activeSection={props.activeSection}
                onClose={props.onCloseDossier}
                onSelectSection={props.onSelectSection}
                onRenameDossier={props.onRenameDossier}
                onUnregisterDossier={props.onUnregisterDossier}
              />
            </motion.div>
          ) : (
            <motion.div
              key="level-1"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={slideTransition}
              className="absolute inset-0 flex flex-col"
            >
              <SidebarLevel1
                destination={props.destination}
                dossiers={props.dossiers}
                isDossierLoading={props.isDossierLoading}
                statusFilter={props.statusFilter}
                sortMode={props.sortMode}
                searchQuery={props.searchQuery}
                onOpenDossier={props.onOpenDossier}
                onOpenPicker={props.onOpenPicker}
                onSetStatusFilter={props.onSetStatusFilter}
                onSetSortMode={props.onSetSortMode}
                onSetSearchQuery={props.onSetSearchQuery}
                onSelectDestination={props.onSelectDestination}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Running billable timer — pinned below both navigation levels so the
          user never loses track of it while moving around the app. */}
      <TimerIndicator
        onOpen={(dossierId) => {
          props.onOpenDossier(dossierId)
          props.onSelectSection('prestations')
        }}
      />
    </aside>
  )
}

// ─── Level 1 ──────────────────────────────────────────────────────────────────

interface SidebarLevel1Props {
  destination: SidebarDestination
  dossiers: DossierSummary[]
  isDossierLoading: boolean
  statusFilter: DossierStatusFilter
  sortMode: DossierSortMode
  searchQuery: string
  onOpenDossier: (id: string) => void
  onOpenPicker: () => void
  onSetStatusFilter: (filter: DossierStatusFilter) => void
  onSetSortMode: (mode: DossierSortMode) => void
  onSetSearchQuery: (query: string) => void
  onSelectDestination: (destination: SidebarDestination) => void
}

function SidebarLevel1({
  destination,
  dossiers,
  isDossierLoading,
  statusFilter,
  sortMode,
  searchQuery,
  onOpenDossier,
  onOpenPicker,
  onSetStatusFilter,
  onSetSortMode,
  onSetSearchQuery,
  onSelectDestination
}: SidebarLevel1Props): React.JSX.Element {
  const { t } = useTranslation()
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const filteredDossiers =
    normalizedSearch.length === 0
      ? dossiers
      : dossiers.filter((dossier) => dossier.name.toLocaleLowerCase().includes(normalizedSearch))

  const listIsDimmed = destination !== 'dossiers'

  return (
    <>
      {/* Section header + add button */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
          {t('nav.tab_dossiers')}
        </span>
        <button
          type="button"
          onClick={onOpenPicker}
          aria-label={t('dossiers.register_action')}
          title={t('dossiers.register_action')}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-hairline-strong bg-white text-ink transition hover:border-aurora hover:bg-aurora/10 hover:text-aurora focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 2v8M2 6h8" />
          </svg>
        </button>
      </div>

      {/* Search + filters */}
      <div className="space-y-2 px-4 pb-2">
        <div className="relative">
          <svg
            width="13"
            height="13"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            aria-hidden
          >
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M13 13l-3-3" />
          </svg>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSetSearchQuery(event.target.value)}
            placeholder={t('dossiers.name_filter_placeholder')}
            aria-label={t('dossiers.name_filter_label')}
            className="w-full rounded-lg border border-hairline-strong bg-white py-1.5 pl-8 pr-2 text-[13px] text-ink outline-none transition placeholder:text-ink-subtle focus:border-aurora focus:ring-2 focus:ring-aurora/35"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={statusFilter}
            onChange={(event) => onSetStatusFilter(event.target.value as DossierStatusFilter)}
            aria-label={t('dossiers.filter_label')}
            className="w-full rounded-lg border border-hairline-strong bg-white px-2 py-1.5 text-xs text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
          >
            <option value="all">{t('dossiers.filter_all')}</option>
            <option value="active">{t('dossiers.status_active')}</option>
            <option value="pending">{t('dossiers.status_pending')}</option>
            <option value="completed">{t('dossiers.status_completed')}</option>
            <option value="archived">{t('dossiers.status_archived')}</option>
          </select>
          <select
            value={sortMode}
            onChange={(event) => onSetSortMode(event.target.value as DossierSortMode)}
            aria-label={t('dossiers.sort_label')}
            className="w-full rounded-lg border border-hairline-strong bg-white px-2 py-1.5 text-xs text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
          >
            <option value="alphabetical">{t('dossiers.sort_alphabetical')}</option>
            <option value="next-key-date">{t('dossiers.sort_next_key_date')}</option>
            <option value="last-opened">{t('dossiers.sort_last_opened')}</option>
          </select>
        </div>
      </div>

      {/* Dossier list (scrollable) */}
      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-2 pb-2 transition-opacity',
          listIsDimmed ? 'opacity-55' : 'opacity-100'
        )}
      >
        {isDossierLoading && dossiers.length === 0 ? (
          <p className="px-3 py-2 text-[13px] text-ink-subtle">{t('dossiers.detail_loading')}</p>
        ) : dossiers.length === 0 ? (
          <p className="px-3 py-3 text-[13px] leading-snug text-ink-muted">
            {t('dossiers.empty_title')}
          </p>
        ) : filteredDossiers.length === 0 ? (
          <p className="px-3 py-3 text-[13px] leading-snug text-ink-muted">
            {t('dossiers.filtered_empty_title')}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filteredDossiers.map((dossier) => (
              <li key={dossier.slug}>
                <button
                  type="button"
                  onClick={() => onOpenDossier(dossier.slug)}
                  title={dossier.name}
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition',
                    'text-ink hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                      statusDotClasses[dossier.status]
                    )}
                    aria-label={dossierStatusLabel(dossier.status, t)}
                  />
                  <span className="truncate text-sm font-medium leading-snug">{dossier.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Bottom destinations — slide with level 1 */}
      <SidebarBottom destination={destination} onSelectDestination={onSelectDestination} />
    </>
  )
}

// ─── Nav icons (shared by level 2 and the bottom destinations) ───────────────

function NavIcon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

const invoiceIcon = (
  <NavIcon>
    <path d="M3 1.5h6l2.5 2.5V13L9.5 11.5 7.5 13 5.5 11.5 3 13z" />
    <path d="M5.5 5.5h4M5.5 8h4" />
  </NavIcon>
)

const scalesIcon = (
  <NavIcon>
    <path d="M7.5 1.5v12" />
    <path d="M3 4h9" />
    <path d="M4.5 4 2 9h5L4.5 4z" />
    <path d="M10.5 4 8 9h5l-2.5-5z" />
    <path d="M5 13h5" />
  </NavIcon>
)

const sectionIcons: Record<DossierSection, React.JSX.Element> = {
  echeances: (
    <NavIcon>
      <circle cx="7.5" cy="7.5" r="5.5" />
      <path d="M7.5 4.5v3l2 2" />
    </NavIcon>
  ),
  notes: (
    <NavIcon>
      <path d="M10.5 2.5l2 2L5.5 11.5l-3 1 1-3z" />
      <path d="M9.5 3.5l2 2" />
    </NavIcon>
  ),
  contacts: (
    <NavIcon>
      <circle cx="7.5" cy="5" r="2.5" />
      <path d="M3 13c.5-2.4 2.4-3.7 4.5-3.7s4 1.3 4.5 3.7" />
    </NavIcon>
  ),
  references: (
    <NavIcon>
      <path d="M4 1.5h7v12l-3.5-2.5L4 13.5z" />
    </NavIcon>
  ),
  prestations: (
    <NavIcon>
      <circle cx="7.5" cy="8.5" r="4.5" />
      <path d="M7.5 8.5 9 7" />
      <path d="M6 2h3M7.5 2v2" />
    </NavIcon>
  ),
  factures: invoiceIcon,
  convention: (
    <NavIcon>
      <path d="M3 2h6l3 3v8H3z" />
      <path d="M9 2v3h3" />
      <path d="M5 10.5c.7-1 1.4.8 2.2 0s1.4.6 2.3.2" />
    </NavIcon>
  ),
  'aide-juridictionnelle': (
    <NavIcon>
      <path d="M7.5 1.5l5 2v3.5c0 3.2-2 5.3-5 6.5-3-1.2-5-3.3-5-6.5V3.5z" />
    </NavIcon>
  ),
  documents: (
    <NavIcon>
      <path d="M1 4a1 1 0 0 1 1-1h4l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" />
    </NavIcon>
  ),
  pieces: (
    <NavIcon>
      <path d="M3.5 1.5h6l2.5 2.5v9.5h-8.5z" />
      <path d="M9.5 1.5V4H12" />
      <circle cx="9.8" cy="10.3" r="2.7" />
      <path d="M9.8 9.2v2.2M8.9 9.7l.9-.5" />
    </NavIcon>
  ),
  compare: (
    <NavIcon>
      <path d="M1.5 2.5h5v11h-5z" />
      <path d="M9.5 2.5h5v11h-5z" />
      <path d="M3 5h2M3 7h2M3 9h2M11 5h2M11 7h2" />
    </NavIcon>
  ),
  generate: (
    <NavIcon>
      <path d="M3 2h6l3 3v8H3z" />
      <path d="M9 2v3h3" />
      <path d="M7.5 7.5v4M5.5 9.5h4" />
    </NavIcon>
  ),
  search: (
    <NavIcon>
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="M13 13l-3-3" />
    </NavIcon>
  ),
  legal: scalesIcon,
  'legal-verify': (
    <NavIcon>
      <circle cx="7.5" cy="7.5" r="5.5" />
      <path d="M5 7.5l1.8 1.8 3.2-3.6" />
    </NavIcon>
  ),
  'ai-assistant': (
    <NavIcon>
      <path d="M7 2l1.1 3 3 1.1-3 1.1L7 10.2 5.9 7.2l-3-1.1 3-1.1z" />
      <path d="M11.5 9.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </NavIcon>
  ),
  cowork: (
    <NavIcon>
      <path d="M2.5 5.5l5-3 5 3v5l-5 3-5-3z" />
      <path d="M2.5 5.5l5 3 5-3M7.5 8.5v5" />
    </NavIcon>
  )
}

// ─── Level 2 ──────────────────────────────────────────────────────────────────

interface SidebarLevel2Props {
  activeDossier: DossierDetail | null
  activeDossierId: string | null
  isDetailLoading: boolean
  activeSection: DossierSection
  onClose: () => void
  onSelectSection: (section: DossierSection) => void
  onRenameDossier: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  onUnregisterDossier: (id: string) => Promise<boolean>
}

function SidebarLevel2({
  activeDossier,
  activeDossierId,
  isDetailLoading,
  activeSection,
  onClose,
  onSelectSection,
  onRenameDossier,
  onUnregisterDossier
}: SidebarLevel2Props): React.JSX.Element {
  const { t } = useTranslation()
  const dossierName = activeDossier?.name ?? t('dossiers.detail_loading')
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  // The running-timer footer sits directly below this panel; hiding the
  // destructive unregister action while it is shown prevents misclicks
  // between two adjacent rows.
  const hasRunningTimer = useTimerStore((state) => state.timer !== null)

  // Surface the otherwise-silent background extraction/indexing of this
  // dossier's documents as an "actions en cours" strip in the card below.
  const indexing = useIndexingStore((state) => selectDossierIndexing(state, activeDossierId))
  const activities: ActivityItem[] = []
  if (indexing && indexing.pending + indexing.running > 0) {
    activities.push({
      id: 'extraction',
      label: t('indexing.extracting', { defaultValue: 'Indexation…' }),
      current: indexing.indexed,
      total: indexing.extractable
    })
  }

  const sectionGroups: { label: string; items: { id: DossierSection; label: string }[] }[] = [
    {
      label: t('dossiers.nav_group_information'),
      items: [
        { id: 'echeances', label: t('dossiers.key_dates_title') },
        { id: 'notes', label: t('dossiers.notes_nav_label', { defaultValue: 'Notes' }) },
        { id: 'contacts', label: t('contacts.sectionTitle') },
        { id: 'references', label: t('dossiers.key_references_title') }
      ]
    },
    {
      label: t('dossiers.nav_group_management'),
      items: [
        {
          id: 'prestations',
          label: t('dossiers.billing_items_nav_label', { defaultValue: 'Prestations' })
        },
        {
          id: 'factures',
          label: t('dossiers.invoices_nav_label', { defaultValue: 'Factures' })
        },
        {
          id: 'convention',
          label: t('dossiers.fee_agreement_nav_label', { defaultValue: 'Convention' })
        },
        {
          id: 'aide-juridictionnelle',
          label: t('dossiers.legal_aid_nav_label', { defaultValue: 'Aide juridictionnelle' })
        }
      ]
    },
    {
      label: t('dossiers.nav_group_documents'),
      items: [
        { id: 'documents', label: t('documents.section_title') },
        { id: 'pieces', label: t('pieces.nav_label', { defaultValue: 'Bordereau' }) },
        { id: 'compare', label: t('compare.nav_label', { defaultValue: 'Comparaison' }) },
        { id: 'generate', label: t('dossiers.generate_document_nav_label') }
      ]
    },
    {
      label: t('dossiers.nav_group_ai'),
      items: [
        { id: 'ai-assistant', label: t('dossiers.ai_assistant_nav_label') },
        { id: 'cowork', label: t('cowork.nav_label', { defaultValue: 'Claude Cowork' }) },
        { id: 'search', label: t('documents.semantic_search_nav_label') },
        { id: 'legal', label: t('legal_search.nav_label', { defaultValue: 'Recherche Droit' }) },
        {
          id: 'legal-verify',
          label: t('legal_search.verify_nav_label', {
            defaultValue: 'Vérification Droit'
          })
        }
      ]
    }
  ]

  return (
    <>
      {/* Back + dossier identity */}
      <div className="shrink-0 space-y-2 px-4 pt-2.5 pb-3">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-md px-1 py-1 text-[13px] font-medium text-ink-muted transition hover:text-aurora focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M7.5 2.5l-4 3.5 4 3.5" />
          </svg>
          <span>{t('nav.tab_dossiers')}</span>
        </button>

        <div className="rounded-xl border border-hairline-strong bg-parchment-bright px-3 py-2.5">
          <h2
            className="flex items-center gap-2 text-base font-semibold leading-tight text-ink"
            title={dossierName}
          >
            {activeDossier ? (
              <span
                className={cn(
                  'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                  statusDotClasses[activeDossier.status]
                )}
                aria-hidden
              />
            ) : null}
            <span className="truncate">{dossierName}</span>
          </h2>
          {activeDossier ? (
            <div className="mt-0.5 flex items-center justify-between gap-2 pl-3.5">
              <p className="min-w-0 truncate text-xs text-ink-muted">
                {dossierStatusLabel(activeDossier.status, t)}
              </p>
              <button
                type="button"
                onClick={() => setSettingsDialogOpen(true)}
                aria-label={t('dossiers.settings_edit_action', {
                  defaultValue: 'Modifier le dossier'
                })}
                title={t('dossiers.settings_edit_action', {
                  defaultValue: 'Modifier le dossier'
                })}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-subtle transition hover:bg-white hover:text-ink focus-visible:bg-white focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/35"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 15 15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M9.8 2.2 12.8 5.2 5.3 12.7 2 13.5l.8-3.3z" />
                  <path d="M8.8 3.2 11.8 6.2" />
                </svg>
              </button>
            </div>
          ) : null}
          {activeDossier ? <DossierActivityBar activities={activities} /> : null}
        </div>
      </div>

      {settingsDialogOpen && activeDossier ? (
        <DossierSettingsDialog
          dossier={activeDossier}
          onClose={() => setSettingsDialogOpen(false)}
          onRenameDossier={onRenameDossier}
        />
      ) : null}

      {/* Section nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sectionGroups.map((group, groupIndex) => (
          <div key={group.label} className={cn(groupIndex > 0 && 'mt-2.5')}>
            <p className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
              {group.label}
            </p>
            <hr className="mx-2.5 mb-1 border-0 border-t border-hairline-strong" />
            <ul className="space-y-0.5 pl-3.5">
              {group.items.map((item) => {
                const isActive = activeSection === item.id
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelectSection(item.id)}
                      disabled={!activeDossier && isDetailLoading}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-sm font-medium transition',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45 disabled:opacity-50',
                        isActive
                          ? 'bg-aurora/12 text-aurora'
                          : 'text-ink-muted hover:bg-white hover:text-ink'
                      )}
                    >
                      <span
                        className={cn('shrink-0', isActive ? 'text-aurora' : 'text-ink-subtle')}
                      >
                        {sectionIcons[item.id]}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Unregister at the bottom of level 2 (above the global bottom destinations) */}
      {activeDossierId && !hasRunningTimer ? (
        <div className="shrink-0 border-t border-hairline px-2 py-2">
          <UnregisterAction
            dossierId={activeDossierId}
            onUnregister={onUnregisterDossier}
            onAfterUnregister={onClose}
          />
        </div>
      ) : null}
    </>
  )
}

interface DossierSettingsDialogProps {
  dossier: DossierDetail
  onClose: () => void
  onRenameDossier: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
}

function DossierSettingsDialog({
  dossier,
  onClose,
  onRenameDossier
}: DossierSettingsDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const nameReference =
    dossier.keyReferences.find((entry) => isDossierNameReferenceLabel(entry.label)) ??
    findDossierReferenceByLabel(dossier, DOSSIER_NAME_REFERENCE_LABEL)
  const statusReference = findDossierReferenceByLabel(dossier, DOSSIER_STATUS_REFERENCE_LABEL)
  const typeReference = findDossierReferenceByLabel(dossier, DOSSIER_TYPE_REFERENCE_LABEL)
  const juridictionReference = findDossierReferenceByLabel(
    dossier,
    DOSSIER_JURIDICTION_REFERENCE_LABEL
  )
  const tribunalReference = findDossierReferenceByLabel(dossier, DOSSIER_TRIBUNAL_REFERENCE_LABEL)
  const informationReference = findDossierReferenceByLabel(
    dossier,
    DOSSIER_INFORMATION_REFERENCE_LABEL
  )
  const [name, setName] = useState(nameReference?.value ?? dossier.name)
  const [status, setStatus] = useState<DossierStatus>(
    dossierStatuses.includes(statusReference?.value as DossierStatus)
      ? (statusReference?.value as DossierStatus)
      : dossier.status
  )
  const [type, setType] = useState(typeReference?.value ?? dossier.type)
  const [juridiction, setJuridiction] = useState(
    juridictionReference?.value ?? dossier.juridiction ?? ''
  )
  const [tribunal, setTribunal] = useState(tribunalReference?.value ?? dossier.tribunal ?? '')
  const [information, setInformation] = useState(
    informationReference?.value ?? dossier.information ?? ''
  )
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const trimmedName = name.trim()
  const initialName = (nameReference?.value ?? dossier.name).trim()
  const initialStatus =
    statusReference && dossierStatuses.includes(statusReference.value as DossierStatus)
      ? (statusReference.value as DossierStatus)
      : dossier.status
  const initialType = typeReference?.value ?? dossier.type
  const initialJuridiction = juridictionReference?.value ?? dossier.juridiction ?? ''
  const initialTribunal = tribunalReference?.value ?? dossier.tribunal ?? ''
  const initialInformation = informationReference?.value ?? dossier.information ?? ''
  const nameChanged = trimmedName !== initialName
  const statusChanged = status !== initialStatus
  const typeChanged = type !== initialType
  const juridictionChanged = juridiction !== initialJuridiction
  const tribunalChanged = tribunal !== initialTribunal
  const informationChanged = information !== initialInformation

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,122,138,0.18)] px-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose()
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="dossier-settings-title"
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-hairline-strong bg-parchment-bright shadow-xl"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!trimmedName) {
            setError(t('dossiers.settings_name_required', { defaultValue: 'Le nom est requis.' }))
            return
          }

          setIsSaving(true)
          setError(null)

          let shouldClose = false
          try {
            const saveReference = async (
              reference: DossierDetail['keyReferences'][number] | undefined,
              label: string,
              value: string
            ): Promise<boolean> =>
              onRenameDossier({
                uuid: reference?.uuid,
                dossierId: dossier.slug,
                label: reference?.label ?? label,
                value
              })

            const saves: Promise<boolean>[] = []
            if (nameChanged) {
              saves.push(saveReference(nameReference, DOSSIER_NAME_REFERENCE_LABEL, trimmedName))
            }
            if (statusChanged) {
              saves.push(saveReference(statusReference, DOSSIER_STATUS_REFERENCE_LABEL, status))
            }
            if (typeChanged) {
              saves.push(saveReference(typeReference, DOSSIER_TYPE_REFERENCE_LABEL, type.trim()))
            }
            if (juridictionChanged) {
              saves.push(
                saveReference(
                  juridictionReference,
                  DOSSIER_JURIDICTION_REFERENCE_LABEL,
                  juridiction.trim()
                )
              )
            }
            if (tribunalChanged) {
              saves.push(
                saveReference(tribunalReference, DOSSIER_TRIBUNAL_REFERENCE_LABEL, tribunal.trim())
              )
            }
            if (informationChanged) {
              saves.push(
                saveReference(
                  informationReference,
                  DOSSIER_INFORMATION_REFERENCE_LABEL,
                  information.trim()
                )
              )
            }

            const results = await Promise.all(saves)
            if (results.some((result) => !result)) {
              setError(
                t('dossiers.settings_save_failed', {
                  defaultValue: "Impossible d'enregistrer les paramètres du dossier."
                })
              )
              return
            }

            shouldClose = true
          } catch {
            setError(
              t('dossiers.settings_save_failed', {
                defaultValue: "Impossible d'enregistrer les paramètres du dossier."
              })
            )
          } finally {
            setIsSaving(false)
          }

          if (shouldClose) {
            onClose()
          }
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h3 id="dossier-settings-title" className="text-base font-semibold text-ink">
              {t('dossiers.settings_dialog_title', { defaultValue: 'Fiche du dossier' })}
            </h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              {t('dossiers.settings_dialog_hint', {
                defaultValue: 'Paramètres généraux utilisés dans les recherches et modèles.'
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label={t('common.close', { defaultValue: 'Fermer' })}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45 disabled:opacity-50"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M3 3l6 6M9 3 3 9" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <label className="block text-xs font-medium text-ink" htmlFor="dossier-settings-name">
            {t('dossiers.settings_name_label', { defaultValue: 'Référence nom du dossier' })}
            <input
              id="dossier-settings-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              required
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-ink" htmlFor="dossier-settings-status">
              {t('dossiers.settings_status_label', { defaultValue: 'Statut' })}
              <select
                id="dossier-settings-status"
                value={status}
                onChange={(event) => setStatus(event.target.value as DossierStatus)}
                className="mt-1 w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              >
                {dossierStatuses.map((entry) => (
                  <option key={entry} value={entry}>
                    {dossierStatusLabel(entry, t)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-ink" htmlFor="dossier-settings-type">
              {t('dossiers.settings_type_label', { defaultValue: 'Type' })}
              <input
                id="dossier-settings-type"
                value={type}
                onChange={(event) => setType(event.target.value)}
                placeholder={t('dossiers.card_type_unset')}
                className="mt-1 w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label
              className="block text-xs font-medium text-ink"
              htmlFor="dossier-settings-juridiction"
            >
              {t('dossiers.settings_juridiction_label', { defaultValue: 'Juridiction' })}
              <input
                id="dossier-settings-juridiction"
                value={juridiction}
                onChange={(event) => setJuridiction(event.target.value)}
                className="mt-1 w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
            </label>

            <label
              className="block text-xs font-medium text-ink"
              htmlFor="dossier-settings-tribunal"
            >
              {t('dossiers.settings_tribunal_label', { defaultValue: 'Tribunal' })}
              <input
                id="dossier-settings-tribunal"
                value={tribunal}
                onChange={(event) => setTribunal(event.target.value)}
                className="mt-1 w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
            </label>
          </div>

          <label
            className="block text-xs font-medium text-ink"
            htmlFor="dossier-settings-information"
          >
            {t('dossiers.settings_information_label', { defaultValue: 'Informations' })}
            <textarea
              id="dossier-settings-information"
              value={information}
              onChange={(event) => setInformation(event.target.value)}
              rows={4}
              className="mt-1 w-full resize-y rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
            />
          </label>

          {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-hairline px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45 disabled:opacity-50"
          >
            {t('common.cancel', { defaultValue: 'Annuler' })}
          </button>
          <button
            type="submit"
            disabled={isSaving || !trimmedName}
            className="rounded-md bg-aurora px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-aurora-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45 disabled:opacity-50"
          >
            {isSaving
              ? t('dossiers.settings_saving_action', { defaultValue: 'Enregistrement...' })
              : t('common.save', { defaultValue: 'Enregistrer' })}
          </button>
        </div>
      </form>
    </div>
  )
}

interface UnregisterActionProps {
  dossierId: string
  onUnregister: (id: string) => Promise<boolean>
  onAfterUnregister: () => void
}

function UnregisterAction({
  dossierId,
  onUnregister,
  onAfterUnregister
}: UnregisterActionProps): React.JSX.Element {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [isWorking, setIsWorking] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-ink-subtle transition hover:bg-white hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45"
      >
        {t('dossiers.unregister_action')}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-destructive-border bg-destructive-tint p-2.5">
      <p className="text-xs font-semibold leading-snug text-destructive">
        {t('dossiers.unregister_confirm_title')}
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={isWorking}
          onClick={async () => {
            setIsWorking(true)
            const ok = await onUnregister(dossierId)
            setIsWorking(false)
            setConfirming(false)
            if (ok) onAfterUnregister()
          }}
          className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-destructive transition hover:bg-[#f7dada] disabled:opacity-50"
        >
          {t('dossiers.unregister_confirm_action')}
        </button>
        <button
          type="button"
          disabled={isWorking}
          onClick={() => setConfirming(false)}
          className="rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-white hover:text-ink disabled:opacity-50"
        >
          {t('dossiers.unregister_cancel_action')}
        </button>
      </div>
    </div>
  )
}

// ─── Bottom destinations (rendered inside Level 1, slides with it) ───────────

interface SidebarBottomProps {
  destination: SidebarDestination
  onSelectDestination: (destination: SidebarDestination) => void
}

function SidebarBottom({
  destination,
  onSelectDestination
}: SidebarBottomProps): React.JSX.Element {
  const { t } = useTranslation()

  const items: { id: SidebarDestination; label: string; icon: React.JSX.Element }[] = [
    {
      id: 'dossiers',
      label: t('nav.tab_accueil', { defaultValue: 'Chronologie' }),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M1.5 6.5 7.5 1.5l6 5V13a1 1 0 0 1-1 1h-3v-3.5h-4V14h-3a1 1 0 0 1-1-1V6.5z" />
        </svg>
      )
    },
    {
      id: 'global-search',
      label: t('nav.tab_global_search', { defaultValue: 'Recherche globale' }),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 2H10" />
          <circle cx="8" cy="9" r="3" />
          <path d="M13 14l-2.8-2.8" />
        </svg>
      )
    },
    {
      id: 'legal',
      label: t('nav.tab_legal_search', { defaultValue: 'Recherche Droit' }),
      icon: scalesIcon
    },
    {
      id: 'factures',
      label: t('nav.tab_factures', { defaultValue: 'Factures' }),
      icon: invoiceIcon
    },
    {
      id: 'modeles',
      label: t('nav.tab_modeles'),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 2h6l3 3v8H3z" />
          <path d="M9 2v3h3" />
          <path d="M5.5 8h4M5.5 10.5h4" />
        </svg>
      )
    },
    {
      id: 'cabinet',
      label: t('nav.tab_cabinet', { defaultValue: 'Cabinet' }),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2.5 13V4.5L7.5 1.5l5 3V13" />
          <path d="M5.5 13V9h4v4" />
          <path d="M5 6.5h0M10 6.5h0" />
        </svg>
      )
    },
    {
      id: 'parametres',
      label: t('nav.tab_parametres'),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="7.5" cy="7.5" r="2" />
          <path d="M7.5 1v2M7.5 12v2M1 7.5h2M12 7.5h2M3 3l1.5 1.5M10.5 10.5L12 12M3 12l1.5-1.5M10.5 4.5L12 3" />
        </svg>
      )
    }
  ]

  return (
    <div className="shrink-0 border-t border-hairline bg-parchment px-2 py-2">
      <ul className="space-y-0.5">
        {items.map((item) => {
          const isActive = destination === item.id
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelectDestination(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45',
                  isActive
                    ? 'bg-aurora/12 text-aurora'
                    : 'text-ink-muted hover:bg-white hover:text-ink'
                )}
              >
                <span className={cn('shrink-0', isActive ? 'text-aurora' : 'text-ink-subtle')}>
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
