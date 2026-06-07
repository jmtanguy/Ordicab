import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

import type { DossierDetail, DossierStatus, DossierSummary } from '@shared/types'

import { cn } from '@renderer/lib/utils'
import type { DossierSortMode, DossierStatusFilter } from '@renderer/stores/dossierStore'

import ordicabLogo from '../../../../resources/icon.png'

export type SidebarDestination =
  | 'dossiers'
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
  | 'documents'
  | 'search'
  | 'legal'
  | 'legal-verify'
  | 'generate'
  | 'ai-assistant'

const statusDotClasses: Record<DossierStatus, string> = {
  active: 'bg-[#5c8a4e]',
  pending: 'bg-[#b88800]',
  completed: 'bg-[#8a8a85]',
  archived: 'bg-[#d1cfc6]'
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
    <aside className="relative flex h-screen w-72 shrink-0 flex-col border-r border-[#e5e3da] bg-[#f4f3ee]">
      {/* Brand header */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[#e5e3da] px-4">
        <img src={ordicabLogo} alt={brandName} className="h-7 w-7 shrink-0 object-contain" />
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-base font-semibold text-[#1a1a1a]">{brandName}</span>
          <span className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-[#8a8a85]">
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

  const statusLabelMap: Record<DossierStatus, string> = {
    active: t('dossiers.status_active'),
    pending: t('dossiers.status_pending'),
    completed: t('dossiers.status_completed'),
    archived: t('dossiers.status_archived')
  }

  const listIsDimmed = destination !== 'dossiers'

  return (
    <>
      {/* Section header + add button */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a8a85]">
          {t('nav.tab_dossiers')}
        </span>
        <button
          type="button"
          onClick={onOpenPicker}
          aria-label={t('dossiers.register_action')}
          title={t('dossiers.register_action')}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-[#d1cfc6] bg-white text-[#1a1a1a] transition hover:border-aurora hover:bg-aurora/10 hover:text-aurora focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45"
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
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a8a85]"
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
            className="w-full rounded-lg border border-[#d1cfc6] bg-white py-1.5 pl-8 pr-2 text-[13px] text-[#1a1a1a] outline-none transition placeholder:text-[#8a8a85] focus:border-aurora focus:ring-2 focus:ring-aurora/35"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={statusFilter}
            onChange={(event) => onSetStatusFilter(event.target.value as DossierStatusFilter)}
            aria-label={t('dossiers.filter_label')}
            className="w-full rounded-lg border border-[#d1cfc6] bg-white px-2 py-1.5 text-xs text-[#1a1a1a] outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
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
            className="w-full rounded-lg border border-[#d1cfc6] bg-white px-2 py-1.5 text-xs text-[#1a1a1a] outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
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
          <p className="px-3 py-2 text-[13px] text-[#8a8a85]">{t('dossiers.detail_loading')}</p>
        ) : dossiers.length === 0 ? (
          <p className="px-3 py-3 text-[13px] leading-snug text-[#5c5c5a]">
            {t('dossiers.empty_title')}
          </p>
        ) : filteredDossiers.length === 0 ? (
          <p className="px-3 py-3 text-[13px] leading-snug text-[#5c5c5a]">
            {t('dossiers.filtered_empty_title')}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filteredDossiers.map((dossier) => (
              <li key={dossier.id}>
                <button
                  type="button"
                  onClick={() => onOpenDossier(dossier.id)}
                  title={dossier.name}
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition',
                    'text-[#1a1a1a] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                      statusDotClasses[dossier.status]
                    )}
                    aria-label={statusLabelMap[dossier.status]}
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

// ─── Level 2 ──────────────────────────────────────────────────────────────────

interface SidebarLevel2Props {
  activeDossier: DossierDetail | null
  activeDossierId: string | null
  isDetailLoading: boolean
  activeSection: DossierSection
  onClose: () => void
  onSelectSection: (section: DossierSection) => void
  onUnregisterDossier: (id: string) => Promise<boolean>
}

function SidebarLevel2({
  activeDossier,
  activeDossierId,
  isDetailLoading,
  activeSection,
  onClose,
  onSelectSection,
  onUnregisterDossier
}: SidebarLevel2Props): React.JSX.Element {
  const { t } = useTranslation()
  const dossierName = activeDossier?.name ?? t('dossiers.detail_loading')

  const sectionGroups: { label: string; items: { id: DossierSection; label: string }[] }[] = [
    {
      label: t('dossiers.nav_group_management'),
      items: [
        {
          id: 'convention',
          label: t('dossiers.fee_agreement_nav_label', { defaultValue: 'Convention' })
        },
        {
          id: 'aide-juridictionnelle',
          label: t('dossiers.legal_aid_nav_label', { defaultValue: 'Aide juridictionnelle' })
        },
        {
          id: 'prestations',
          label: t('dossiers.billing_items_nav_label', { defaultValue: 'Prestations' })
        },
        {
          id: 'factures',
          label: t('dossiers.invoices_nav_label', { defaultValue: 'Factures' })
        }
      ]
    },
    {
      label: t('dossiers.nav_group_information'),
      items: [
        { id: 'echeances', label: t('dossiers.key_dates_title') },
        { id: 'contacts', label: t('contacts.sectionTitle') },
        { id: 'references', label: t('dossiers.key_references_title') }
      ]
    },
    {
      label: t('dossiers.nav_group_documents'),
      items: [
        { id: 'documents', label: t('documents.section_title') },
        { id: 'generate', label: t('dossiers.generate_document_nav_label') }
      ]
    },
    {
      label: t('dossiers.nav_group_ai'),
      items: [
        { id: 'search', label: t('documents.semantic_search_nav_label') },
        { id: 'legal', label: t('legal_search.nav_label', { defaultValue: 'Recherche Droit' }) },
        {
          id: 'legal-verify',
          label: t('legal_search.verify_nav_label', {
            defaultValue: 'Vérification Droit'
          })
        },
        { id: 'ai-assistant', label: t('dossiers.ai_assistant_nav_label') }
      ]
    }
  ]

  return (
    <>
      {/* Back + dossier identity */}
      <div className="shrink-0 space-y-2.5 px-4 pt-4 pb-3">
        <button
          type="button"
          onClick={onClose}
          className="flex w-full items-center justify-between rounded-xl border border-[#d1cfc6] bg-white px-3 py-2 text-left transition hover:border-aurora hover:bg-aurora/10 hover:text-aurora focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45"
        >
          <span className="flex items-center gap-2 text-[13px] font-medium text-[#1a1a1a]">
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
          </span>
        </button>

        <div className="rounded-2xl border border-[#c4bfb2] px-3 py-3">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a8a85]">
            <svg
              width="11"
              height="11"
              viewBox="0 0 15 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M1 4a1 1 0 0 1 1-1h4l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" />
            </svg>
            {t('sidebar.dossier_label')}
          </p>
          <h2
            className="truncate text-base font-semibold leading-tight text-[#1a1a1a]"
            title={dossierName}
          >
            {dossierName}
          </h2>
        </div>
      </div>

      {/* Section nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sectionGroups.map((group, groupIndex) => (
          <div
            key={group.label}
            className={cn(groupIndex > 0 && 'mt-2 border-t border-[#e5e3da] pt-2')}
          >
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a8a85]">
              {group.label}
            </p>
            <ul className="space-y-0.5">
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
                        'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45 disabled:opacity-50',
                        isActive ? 'bg-aurora/12 text-aurora' : 'text-[#1a1a1a] hover:bg-white'
                      )}
                    >
                      {item.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Unregister at the bottom of level 2 (above the global bottom destinations) */}
      {activeDossierId ? (
        <div className="shrink-0 border-t border-[#e5e3da] px-2 py-2">
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
        className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] text-[#8a8a85] transition hover:bg-white hover:text-[#b23a3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45"
      >
        {t('dossiers.unregister_action')}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-[#e8c7c7] bg-[#fbf0f0] p-2.5">
      <p className="text-xs font-semibold leading-snug text-[#9c2f2f]">
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
          className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-[#9c2f2f] transition hover:bg-[#f7dada] disabled:opacity-50"
        >
          {t('dossiers.unregister_confirm_action')}
        </button>
        <button
          type="button"
          disabled={isWorking}
          onClick={() => setConfirming(false)}
          className="rounded-md px-2 py-1 text-xs text-[#5c5c5a] transition hover:bg-white hover:text-[#1a1a1a] disabled:opacity-50"
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
      id: 'factures',
      label: t('nav.tab_factures', { defaultValue: 'Factures' }),
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
          <path d="M3 1.5h6l2.5 2.5V13L9.5 11.5 7.5 13 5.5 11.5 3 13z" />
          <path d="M5.5 5.5h4M5.5 8h4" />
        </svg>
      )
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
      id: 'legal',
      label: t('nav.tab_legal_search', { defaultValue: 'Recherche Droit' }),
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
          <path d="M7.5 1.5v12" />
          <path d="M3 4h9" />
          <path d="M4.5 4 2 9h5L4.5 4z" />
          <path d="M10.5 4 8 9h5l-2.5-5z" />
          <path d="M5 13h5" />
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
    <div className="shrink-0 border-t border-[#e5e3da] bg-[#f4f3ee] px-2 py-2">
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
                    : 'text-[#5c5c5a] hover:bg-white hover:text-[#1a1a1a]'
                )}
              >
                <span className={cn('shrink-0', isActive ? 'text-aurora' : 'text-[#8a8a85]')}>
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
