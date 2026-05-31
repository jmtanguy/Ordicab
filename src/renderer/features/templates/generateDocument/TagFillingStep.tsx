import { useTranslation } from 'react-i18next'

import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import type { EntityManagedFieldsConfig } from '@shared/managedFields'
import { buildTagPathLocalizer, templateRoutineCatalog } from '@shared/templateRoutines'
import type { ContactRecord } from '@shared/validation'

import { roleToTagKey } from '../../dossiers/rolePresets'
import { ComboField, type ComboOption } from './ComboField'
import { applyKeyDateOverride, parseLocalDateToIso } from './tagValueHelpers'
import { applyPrimaryContact, applyRoleContact, categorizeTagPaths } from './tagFillingHelpers'
import { useMemo, useState } from 'react'

const INVOICE_TABLE_PATHS = new Set(['invoice.linesTable', 'facture.tableauPrestations'])
const INVOICE_NUMBER_PATHS = new Set(['invoice.number', 'facture.numero'])
const INVOICE_MODULE_HANDLED_PATHS = new Set([...INVOICE_TABLE_PATHS, ...INVOICE_NUMBER_PATHS])

const INPUT_CLASS =
  'w-full rounded-2xl border border-[#e5e3da] bg-white px-4 py-2.5 text-sm text-[#1a1a1a] outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35'

interface ContactRowProps {
  roleLabel: string
  contactId: string
  paths: string[]
  onContactChange: (id: string) => void
  dossierContacts: import('@shared/validation').ContactRecord[]
  emptyCount: (paths: string[]) => number
  isSectionOpen: (key: string, defaultOpen: boolean) => boolean
  toggleSection: (key: string, defaultOpen: boolean) => void
  renderFieldGrid: (paths: string[]) => React.JSX.Element
  noMatchLabel: string
}

function ContactRow({
  roleLabel,
  contactId,
  paths,
  onContactChange,
  dossierContacts,
  emptyCount,
  isSectionOpen,
  toggleSection,
  renderFieldGrid,
  noMatchLabel
}: ContactRowProps): React.JSX.Element {
  const assignedContact = dossierContacts.find((c) => c.uuid === contactId)
  const displayName = assignedContact ? computeContactDisplayName(assignedContact) : ''
  const initials = displayName
    ? displayName
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?'
  const empty = emptyCount(paths)
  const sectionKey = `contact-${roleLabel}`
  const showFields = isSectionOpen(sectionKey, empty > 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-aurora/20 text-[10px] font-bold text-aurora">
            {initials}
          </div>
          <span className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-[#5c5c5a]">
            {roleLabel}
          </span>
        </div>
        {dossierContacts.length > 0 ? (
          <select
            value={contactId}
            onChange={(e) => onContactChange(e.target.value)}
            className="min-w-0 flex-2 rounded-xl border border-[#e5e3da] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
          >
            <option value="">{noMatchLabel}</option>
            {dossierContacts.map((c) => {
              const dn = computeContactDisplayName(c)
              return (
                <option key={c.uuid} value={c.uuid}>
                  {dn} ({c.role})
                </option>
              )
            })}
          </select>
        ) : null}
        {paths.length > 0 ? (
          <button
            type="button"
            onClick={() => toggleSection(sectionKey, empty > 0)}
            className="shrink-0 flex items-center gap-1 text-xs text-[#5c5c5a] hover:text-[#1a1a1a] transition"
          >
            {empty > 0 ? (
              <span className="rounded-full bg-[#fbf5e3] px-2 py-0.5 text-[10px] font-medium text-[#b88800]">
                {empty}
              </span>
            ) : (
              <span className="rounded-full bg-[#f1f7ec] px-2 py-0.5 text-[10px] font-medium text-[#3c6132]">
                ✓
              </span>
            )}
            <svg
              className={`size-3 transition-transform ${showFields ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        ) : null}
      </div>

      {showFields && paths.length > 0 ? (
        <div className="ml-9 rounded-xl border border-[#e9e8e0] bg-white p-3">
          {renderFieldGrid(paths)}
        </div>
      ) : null}
    </div>
  )
}

export interface TagFillingStepProps {
  tagPaths: string[]
  tagValues: Record<string, string>
  onTagValuesChange: (next: Record<string, string>) => void
  primaryContactId: string
  onPrimaryContactChange: (id: string) => void
  roleContactIds: Record<string, string>
  onRoleContactIdsChange: (next: Record<string, string>) => void
  dossierContacts: ContactRecord[]
  keyDateOptions: ComboOption[]
  managedFieldsConfig: EntityManagedFieldsConfig
}

export function TagFillingStep(props: TagFillingStepProps): React.JSX.Element {
  const {
    tagPaths,
    tagValues,
    onTagValuesChange,
    primaryContactId,
    onPrimaryContactChange,
    roleContactIds,
    onRoleContactIdsChange,
    dossierContacts,
    keyDateOptions,
    managedFieldsConfig
  } = props

  const { t, i18n } = useTranslation()
  const localizeTagPath = useMemo(
    () => buildTagPathLocalizer(templateRoutineCatalog, i18n.language),
    [i18n.language]
  )

  const {
    primaryTagPaths,
    roleTagGroups,
    keyDatePaths,
    invoicePaths,
    otherNonAddressPaths,
    otherAddressPaths
  } = useMemo(() => categorizeTagPaths(tagPaths), [tagPaths])

  const invoiceFillablePaths = useMemo(
    () => invoicePaths.filter((p) => !INVOICE_MODULE_HANDLED_PATHS.has(p)),
    [invoicePaths]
  )
  const invoiceTablePaths = useMemo(
    () => invoicePaths.filter((p) => INVOICE_TABLE_PATHS.has(p)),
    [invoicePaths]
  )
  const invoiceNumberPaths = useMemo(
    () => invoicePaths.filter((p) => INVOICE_NUMBER_PATHS.has(p)),
    [invoicePaths]
  )

  const allDisplayedPaths = [
    ...primaryTagPaths,
    ...Object.values(roleTagGroups).flat(),
    ...keyDatePaths,
    ...invoiceFillablePaths,
    ...otherNonAddressPaths,
    ...otherAddressPaths
  ]
  const filledCount = allDisplayedPaths.filter((p) => (tagValues[p] ?? '').trim() !== '').length
  const totalCount = allDisplayedPaths.length
  const allFilled = filledCount === totalCount
  const progressPct = totalCount === 0 ? 100 : Math.round((filledCount / totalCount) * 100)

  const [openTagSections, setOpenTagSections] = useState<Record<string, boolean>>({})

  const emptyCount = (paths: string[]): number =>
    paths.filter((p) => (tagValues[p] ?? '').trim() === '').length

  const toggleSection = (key: string, defaultOpen: boolean): void =>
    setOpenTagSections((prev) => ({ ...prev, [key]: !(prev[key] ?? defaultOpen) }))

  const isSectionOpen = (key: string, defaultOpen: boolean): boolean =>
    openTagSections[key] ?? defaultOpen

  const setTagValue = (path: string, value: string): void => {
    onTagValuesChange({ ...tagValues, [path]: value })
  }

  const renderFieldGrid = (paths: string[]): React.JSX.Element => (
    <div className="grid gap-3 md:grid-cols-2">
      {paths.map((path) => {
        const isEmpty = (tagValues[path] ?? '').trim() === ''
        return (
          <label key={path} className="flex flex-col gap-1 text-sm text-[#1a1a1a]">
            <span className="text-xs text-[#5c5c5a]">{localizeTagPath(path)}</span>
            <input
              type="text"
              value={tagValues[path] ?? ''}
              onChange={(event) => setTagValue(path, event.target.value)}
              className={
                INPUT_CLASS +
                (isEmpty ? ' border-[#e8d5a3] focus:border-[#b88800] focus:ring-[#b88800]/30' : '')
              }
              placeholder={t('generate.tags.emptyPlaceholder')}
            />
          </label>
        )
      })}
    </div>
  )

  const TagSectionHeader = ({
    sectionKey,
    title,
    paths,
    defaultOpen
  }: {
    sectionKey: string
    title: string
    paths: string[]
    defaultOpen: boolean
  }): React.JSX.Element => {
    const empty = emptyCount(paths)
    const open = isSectionOpen(sectionKey, defaultOpen)
    return (
      <button
        type="button"
        onClick={() => toggleSection(sectionKey, defaultOpen)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-medium text-[#1a1a1a]">{title}</span>
        <div className="flex items-center gap-2">
          {empty > 0 ? (
            <span className="rounded-full bg-[#fbf5e3] px-2 py-0.5 text-[10px] font-medium text-[#b88800]">
              {empty}{' '}
              {t('generate.tags.toFill', i18n.language === 'fr' ? 'à compléter' : 'to fill')}
            </span>
          ) : (
            <span className="rounded-full bg-[#f1f7ec] px-2 py-0.5 text-[10px] font-medium text-[#3c6132]">
              ✓
            </span>
          )}
          <svg
            className={`size-4 text-[#5c5c5a] transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
    )
  }

  const hasContactSection =
    (primaryTagPaths.length > 0 && dossierContacts.length > 0) ||
    Object.keys(roleTagGroups).length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {totalCount > 0 ? (
        <div className="shrink-0 rounded-2xl border border-[#e5e3da] bg-white px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-[#5c5c5a]">
              {allFilled
                ? i18n.language === 'fr'
                  ? 'Tous les tags sont prêts'
                  : 'All tags are ready'
                : i18n.language === 'fr'
                  ? `${filledCount} / ${totalCount} tags remplis`
                  : `${filledCount} / ${totalCount} tags filled`}
            </span>
            <span
              className={`text-xs font-medium ${allFilled ? 'text-[#3c6132]' : 'text-[#b88800]'}`}
            >
              {progressPct}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f4f3ee]">
            <div
              className={`h-full rounded-full transition-all duration-500 ${allFilled ? 'bg-[#5c8a4e]' : 'bg-[#b88800]'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
        {hasContactSection ? (
          <section className="rounded-2xl border border-[#e5e3da] bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[#1a1a1a]">
                {i18n.language === 'fr' ? 'Contacts' : 'Contacts'}
              </p>
              <p className="text-xs text-[#8a8a85]">{t('generate.tags.selectContact')}</p>
            </div>

            <div className="space-y-4 divide-y divide-white/5">
              {primaryTagPaths.length > 0 && dossierContacts.length > 0 ? (
                <div className="pt-0">
                  <ContactRow
                    roleLabel={t('generate.tags.primaryContactTitle')}
                    contactId={primaryContactId}
                    paths={primaryTagPaths}
                    onContactChange={(id) => {
                      onPrimaryContactChange(id)
                      onTagValuesChange(
                        applyPrimaryContact(id, tagValues, dossierContacts, managedFieldsConfig)
                      )
                    }}
                    dossierContacts={dossierContacts}
                    emptyCount={emptyCount}
                    isSectionOpen={isSectionOpen}
                    toggleSection={toggleSection}
                    renderFieldGrid={renderFieldGrid}
                    noMatchLabel={t('generate.contactMapping.no_match')}
                  />
                </div>
              ) : null}

              {Object.entries(roleTagGroups).map(([roleKey, paths], idx) => {
                const roleContact = dossierContacts.find(
                  (c) => c.role && roleToTagKey(c.role) === roleKey
                )
                const roleDisplayLabel = roleContact?.role ?? roleKey
                return (
                  <div
                    key={roleKey}
                    className={idx === 0 && primaryTagPaths.length === 0 ? 'pt-0' : 'pt-4'}
                  >
                    <ContactRow
                      roleLabel={roleDisplayLabel}
                      contactId={roleContactIds[roleKey] ?? ''}
                      paths={paths}
                      onContactChange={(id) => {
                        onRoleContactIdsChange({ ...roleContactIds, [roleKey]: id })
                        onTagValuesChange(
                          applyRoleContact(
                            roleKey,
                            id,
                            tagValues,
                            dossierContacts,
                            managedFieldsConfig
                          )
                        )
                      }}
                      dossierContacts={dossierContacts}
                      emptyCount={emptyCount}
                      isSectionOpen={isSectionOpen}
                      toggleSection={toggleSection}
                      renderFieldGrid={renderFieldGrid}
                      noMatchLabel={t('generate.contactMapping.no_match')}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        {invoiceFillablePaths.length > 0 ||
        invoiceTablePaths.length > 0 ||
        invoiceNumberPaths.length > 0
          ? (() => {
              const open = isSectionOpen('invoice', emptyCount(invoiceFillablePaths) > 0)
              return (
                <section className="rounded-2xl border border-[#e5e3da] bg-white p-4 space-y-4">
                  <TagSectionHeader
                    sectionKey="invoice"
                    title={i18n.language === 'fr' ? 'Facture' : 'Invoice'}
                    paths={invoiceFillablePaths}
                    defaultOpen={emptyCount(invoiceFillablePaths) > 0}
                  />
                  {open ? (
                    <div className="space-y-3">
                      {invoiceFillablePaths.length > 0
                        ? renderFieldGrid(invoiceFillablePaths)
                        : null}
                      {invoiceNumberPaths.length > 0 ? (
                        <div className="rounded-xl border border-dashed border-[#cfe0c5] bg-[#f1f7ec] px-3 py-2 text-xs text-[#3c6132]">
                          {i18n.language === 'fr'
                            ? 'Le numéro de facture sera attribué automatiquement à la génération.'
                            : 'The invoice number will be assigned automatically at generation time.'}
                          <ul className="mt-1 list-inside list-disc font-mono text-[11px]">
                            {invoiceNumberPaths.map((p) => (
                              <li key={p}>
                                {localizeTagPath(p)}
                                {tagValues[p] ? ` → ${tagValues[p]}` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {invoiceTablePaths.length > 0 ? (
                        <div className="rounded-xl border border-dashed border-[#cfe0c5] bg-[#f1f7ec] px-3 py-2 text-xs text-[#3c6132]">
                          {i18n.language === 'fr'
                            ? 'Le tableau des prestations sera inséré automatiquement à la génération.'
                            : 'The services table will be inserted automatically at generation time.'}
                          <ul className="mt-1 list-inside list-disc font-mono text-[11px]">
                            {invoiceTablePaths.map((p) => (
                              <li key={p}>{localizeTagPath(p)}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              )
            })()
          : null}

        {keyDatePaths.length > 0
          ? (() => {
              const open = isSectionOpen('keyDates', emptyCount(keyDatePaths) > 0)
              return (
                <section className="rounded-2xl border border-[#e5e3da] bg-white p-4 space-y-4">
                  <TagSectionHeader
                    sectionKey="keyDates"
                    title={t('generate.tags.keyDatesTitle')}
                    paths={keyDatePaths}
                    defaultOpen={emptyCount(keyDatePaths) > 0}
                  />
                  {open ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {keyDatePaths.map((path) => {
                        const value = tagValues[path] ?? ''
                        const isEmpty = value.trim() === ''
                        const locale = i18n.resolvedLanguage ?? 'fr'
                        const isValidDate = !!parseLocalDateToIso(value, locale)
                        const fieldClass =
                          INPUT_CLASS +
                          (isEmpty
                            ? ' border-[#e8d5a3] focus:border-[#b88800] focus:ring-[#b88800]/30'
                            : '')
                        const formatHint = locale.startsWith('fr')
                          ? 'JJ/MM/AAAA ou AAAA-MM-JJ'
                          : 'DD/MM/YYYY or YYYY-MM-DD'
                        return (
                          <div key={path} className="flex flex-col gap-1 text-sm text-[#1a1a1a]">
                            <span className="text-xs text-[#5c5c5a]">{localizeTagPath(path)}</span>
                            <ComboField
                              value={value}
                              onChange={(v) =>
                                onTagValuesChange(applyKeyDateOverride(path, v, locale, tagValues))
                              }
                              options={keyDateOptions}
                              placeholder={formatHint}
                              inputClassName={fieldClass}
                            />
                            {value && !isValidDate ? (
                              <span className="text-xs text-[#b88800]">{formatHint}</span>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </section>
              )
            })()
          : null}

        {otherNonAddressPaths.length + otherAddressPaths.length > 0
          ? (() => {
              const otherPaths = [...otherNonAddressPaths, ...otherAddressPaths]
              const open = isSectionOpen('otherTags', emptyCount(otherPaths) > 0)
              return (
                <section className="rounded-2xl border border-[#e5e3da] bg-white p-4 space-y-4">
                  <TagSectionHeader
                    sectionKey="otherTags"
                    title={t('generate.tags.otherTagsTitle')}
                    paths={otherPaths}
                    defaultOpen={emptyCount(otherPaths) > 0}
                  />
                  {open ? (
                    <div className="space-y-4">
                      {otherNonAddressPaths.length > 0
                        ? renderFieldGrid(otherNonAddressPaths)
                        : null}
                      {otherAddressPaths.length > 0 ? (
                        <div className="space-y-3">
                          <p className="text-xs font-medium text-[#5c5c5a]">
                            {i18n.language === 'fr' ? 'Adresse' : 'Address'}
                          </p>
                          {renderFieldGrid(otherAddressPaths)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              )
            })()
          : null}

        {tagPaths.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#e5e3da] bg-white px-4 py-8 text-center text-sm text-[#5c5c5a]">
            {t('generate.tags.noTags')}
          </div>
        ) : null}
      </div>
    </div>
  )
}
