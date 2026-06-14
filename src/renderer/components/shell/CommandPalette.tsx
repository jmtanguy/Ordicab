import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DossierSummary } from '@shared/types'

import { cn } from '@renderer/lib/utils'
import { DialogShell } from '@renderer/components/ui'

import type { DossierSection, SidebarDestination } from './Sidebar'
import {
  buildCommandPaletteGroups,
  type CommandPaletteEntry,
  type CommandPaletteItem
} from './commandPaletteItems'

interface CommandPaletteProps {
  open: boolean
  dossiers: DossierSummary[]
  hasActiveDossier: boolean
  onClose: () => void
  onOpenDossier: (id: string) => void
  onSelectDestination: (destination: SidebarDestination) => void
  onSelectSection: (section: DossierSection) => void
  onCreateDossier: () => void
}

export function CommandPalette(props: CommandPaletteProps): React.JSX.Element | null {
  // Mount the content fresh on every open so query/selection always start clean.
  if (!props.open) {
    return null
  }

  return <CommandPaletteContent {...props} />
}

function CommandPaletteContent(props: CommandPaletteProps): React.JSX.Element {
  const {
    dossiers,
    hasActiveDossier,
    onClose,
    onOpenDossier,
    onSelectDestination,
    onSelectSection,
    onCreateDossier
  } = props
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const destinations = useMemo<CommandPaletteEntry<SidebarDestination>[]>(
    () => [
      { id: 'dossiers', label: t('nav.tab_dossiers', { defaultValue: 'Dossiers' }) },
      {
        id: 'global-search',
        label: t('nav.tab_global_search', { defaultValue: 'Recherche globale' })
      },
      { id: 'legal', label: t('nav.tab_legal_search', { defaultValue: 'Recherche Droit' }) },
      { id: 'factures', label: t('nav.tab_factures', { defaultValue: 'Factures' }) },
      { id: 'modeles', label: t('nav.tab_modeles', { defaultValue: 'Modèles' }) },
      { id: 'cabinet', label: t('nav.tab_cabinet', { defaultValue: 'Cabinet' }) },
      { id: 'parametres', label: t('nav.tab_parametres', { defaultValue: 'Paramètres' }) }
    ],
    [t]
  )

  // Same labels as the dossier sidebar (SidebarLevel2) so both surfaces stay in sync.
  const sections = useMemo<CommandPaletteEntry<DossierSection>[]>(() => {
    if (!hasActiveDossier) {
      return []
    }
    return [
      { id: 'echeances', label: t('dossiers.key_dates_title') },
      { id: 'contacts', label: t('contacts.sectionTitle') },
      { id: 'references', label: t('dossiers.key_references_title') },
      { id: 'notes', label: t('dossiers.notes_nav_label', { defaultValue: 'Notes' }) },
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
      { id: 'factures', label: t('dossiers.invoices_nav_label', { defaultValue: 'Factures' }) },
      { id: 'documents', label: t('documents.section_title') },
      { id: 'generate', label: t('dossiers.generate_document_nav_label') },
      { id: 'search', label: t('documents.semantic_search_nav_label') },
      { id: 'legal', label: t('legal_search.nav_label', { defaultValue: 'Recherche Droit' }) },
      {
        id: 'legal-verify',
        label: t('legal_search.verify_nav_label', { defaultValue: 'Vérification Droit' })
      },
      { id: 'ai-assistant', label: t('dossiers.ai_assistant_nav_label') },
      { id: 'cowork', label: t('cowork.nav_label', { defaultValue: 'Claude Cowork' }) }
    ]
  }, [hasActiveDossier, t])

  const groups = useMemo(
    () =>
      buildCommandPaletteGroups({
        query,
        dossiers,
        destinations,
        sections,
        actions: [
          {
            id: 'new-dossier',
            label: t('commandPalette.action_new_dossier', { defaultValue: 'Nouveau dossier' })
          }
        ],
        groupLabels: {
          recent: t('commandPalette.group_recent', { defaultValue: 'Dossiers récents' }),
          dossiers: t('commandPalette.group_dossiers', { defaultValue: 'Dossiers' }),
          navigation: t('commandPalette.group_navigation', { defaultValue: 'Navigation' }),
          sections: t('commandPalette.group_sections', { defaultValue: 'Sections du dossier' }),
          actions: t('commandPalette.group_actions', { defaultValue: 'Actions' })
        }
      }),
    [query, dossiers, destinations, sections, t]
  )

  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const clampedIndex = Math.min(selectedIndex, Math.max(flatItems.length - 1, 0))

  const activate = (item: CommandPaletteItem): void => {
    onClose()
    switch (item.kind) {
      case 'dossier':
        onOpenDossier(item.dossierId)
        break
      case 'destination':
        onSelectDestination(item.destination)
        break
      case 'section':
        onSelectSection(item.section)
        break
      case 'action':
        onCreateDossier()
        break
    }
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex(flatItems.length === 0 ? 0 : (clampedIndex + 1) % flatItems.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex(
        flatItems.length === 0 ? 0 : (clampedIndex - 1 + flatItems.length) % flatItems.length
      )
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const item = flatItems[clampedIndex]
      if (item) {
        activate(item)
      }
    }
  }

  // Flat index of the first item of each group, so list rows map onto flatItems.
  let runningIndex = 0

  return (
    <DialogShell
      size="lg"
      className="z-50 items-start pt-[12vh]"
      panelClassName="max-w-xl overflow-hidden p-0"
      onDismiss={onClose}
      aria-label={t('commandPalette.title', { defaultValue: 'Palette de commandes' })}
    >
      <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
        <svg
          width="15"
          height="15"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          className="shrink-0 text-ink-subtle"
          aria-hidden
        >
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="M13 13l-3-3" />
        </svg>
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectedIndex(0)
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={t('commandPalette.placeholder', {
            defaultValue: 'Rechercher un dossier, une page…'
          })}
          aria-label={t('commandPalette.input_label', { defaultValue: 'Recherche' })}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={
            flatItems.length > 0 ? `command-palette-item-${clampedIndex}` : undefined
          }
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
        <kbd className="shrink-0 rounded border border-hairline-strong bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle">
          {t('commandPalette.escape_hint', { defaultValue: 'Échap' })}
        </kbd>
      </div>

      <div
        id="command-palette-list"
        role="listbox"
        className="max-h-[50vh] min-h-0 overflow-y-auto px-2 py-2"
      >
        {flatItems.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-ink-muted">
            {t('commandPalette.empty', { defaultValue: 'Aucun résultat' })}
          </p>
        ) : (
          groups.map((group, groupIndex) => {
            const groupStartIndex = runningIndex
            runningIndex += group.items.length
            return (
              <div
                key={group.key}
                className={cn(groupIndex > 0 && 'mt-2 border-t border-hairline pt-2')}
              >
                <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item, itemIndex) => {
                    const flatIndex = groupStartIndex + itemIndex
                    const isSelected = flatIndex === clampedIndex
                    return (
                      <li key={`${item.kind}-${'dossierId' in item ? item.dossierId : item.label}`}>
                        <button
                          type="button"
                          id={`command-palette-item-${flatIndex}`}
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => activate(item)}
                          onMouseMove={() => setSelectedIndex(flatIndex)}
                          ref={(node) => {
                            if (node && isSelected) {
                              node.scrollIntoView({ block: 'nearest' })
                            }
                          }}
                          className={cn(
                            'flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45',
                            isSelected ? 'bg-aurora/12 text-aurora' : 'text-ink'
                          )}
                        >
                          <span className="truncate">{item.label}</span>
                          {item.kind === 'dossier' && item.sublabel ? (
                            <span
                              className={cn(
                                'truncate text-xs font-normal',
                                isSelected ? 'text-aurora/80' : 'text-ink-subtle'
                              )}
                            >
                              {item.sublabel}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })
        )}
      </div>
    </DialogShell>
  )
}
