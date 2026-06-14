import { useTranslation } from 'react-i18next'

import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import type { EntityManagedFieldsConfig } from '@shared/managedFields'
import { buildTagPathLocalizer, templateRoutineCatalog } from '@shared/templateRoutines'
import type { ContactRecord } from '@shared/validation'

import { roleToTagKey } from '../../dossiers/rolePresets'
import { ComboField, type ComboOption } from './ComboField'
import { applyKeyDateOverride, parseLocalDateToIso } from './tagValueHelpers'
import {
  applyPrimaryContact,
  applyRoleContact,
  categorizeTagPaths,
  type TagProvenance
} from './tagFillingHelpers'
import { useEffect, useMemo, useState } from 'react'

const INVOICE_TABLE_PATHS = new Set(['invoice.linesTable', 'facture.tableauPrestations'])
/** Tags pilotés par le module facture : numéro consommé à la génération, dates pilotées par les champs du dialogue. */
const INVOICE_AUTO_FIELD_PATHS = new Set([
  'invoice.number',
  'facture.numero',
  'invoice.issuedAt',
  'facture.dateEmission',
  'invoice.dueAt',
  'facture.dateEcheance'
])
const INVOICE_MODULE_HANDLED_PATHS = new Set([...INVOICE_TABLE_PATHS, ...INVOICE_AUTO_FIELD_PATHS])

/** Heuristic for date-bearing tag paths (issuedAt, sentAt, dateOfBirth…) → rendered as a day picker. */
function isDateTagPath(path: string): boolean {
  const last = path.split('.').pop() ?? ''
  return /At$/.test(last) || /^date([A-Z]|$)/.test(last)
}

const INPUT_CLASS =
  'w-full rounded-2xl border border-hairline bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35'

interface ContactRowProps {
  roleLabel: string
  contactUuid: string
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
  contactUuid,
  paths,
  onContactChange,
  dossierContacts,
  emptyCount,
  isSectionOpen,
  toggleSection,
  renderFieldGrid,
  noMatchLabel
}: ContactRowProps): React.JSX.Element {
  const assignedContact = dossierContacts.find((c) => c.uuid === contactUuid)
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
          <span className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-ink-muted">
            {roleLabel}
          </span>
        </div>
        {dossierContacts.length > 0 ? (
          <select
            value={contactUuid}
            onChange={(e) => onContactChange(e.target.value)}
            className="min-w-0 flex-2 rounded-xl border border-hairline bg-white px-3 py-1.5 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
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
            className="shrink-0 flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition"
          >
            {empty > 0 ? (
              <span className="rounded-full bg-warning-tint px-2 py-0.5 text-[10px] font-medium text-warning">
                {empty}
              </span>
            ) : (
              <span className="rounded-full bg-success-tint px-2 py-0.5 text-[10px] font-medium text-success-deep">
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
  primaryContactUuid: string
  onPrimaryContactChange: (id: string) => void
  roleContactUuids: Record<string, string>
  onRoleContactIdsChange: (next: Record<string, string>) => void
  dossierContacts: ContactRecord[]
  keyDateOptions: ComboOption[]
  managedFieldsConfig: EntityManagedFieldsConfig
  /** Source of each pre-filled value — rendered as a badge next to the field label. */
  tagProvenance?: Record<string, TagProvenance>
  /** Tag path to scroll to and focus (e.g. when jumping back from an unresolved-tag warning). */
  focusPath?: string | null
  onFocusHandled?: () => void
}

export function TagFillingStep(props: TagFillingStepProps): React.JSX.Element {
  const {
    tagPaths,
    tagValues,
    onTagValuesChange,
    primaryContactUuid,
    onPrimaryContactChange,
    roleContactUuids,
    onRoleContactIdsChange,
    dossierContacts,
    keyDateOptions,
    managedFieldsConfig,
    tagProvenance,
    focusPath,
    onFocusHandled
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
  const invoiceAutoPaths = useMemo(
    () => invoicePaths.filter((p) => INVOICE_AUTO_FIELD_PATHS.has(p)),
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

  // Jump-to-field support: open the section containing focusPath, then focus its input.
  useEffect(() => {
    if (!focusPath) return

    const sectionKey = ((): string => {
      if (primaryTagPaths.includes(focusPath)) {
        return `contact-${t('generate.tags.primaryContactTitle')}`
      }
      for (const [roleKey, paths] of Object.entries(roleTagGroups)) {
        if (paths.includes(focusPath)) {
          const roleContact = dossierContacts.find(
            (c) => c.role && roleToTagKey(c.role) === roleKey
          )
          return `contact-${roleContact?.role ?? roleKey}`
        }
      }
      if (keyDatePaths.includes(focusPath)) return 'keyDates'
      if (invoicePaths.includes(focusPath)) return 'invoice'
      return 'otherTags'
    })()

    setOpenTagSections((prev) => ({ ...prev, [sectionKey]: true }))

    const frame = requestAnimationFrame(() => {
      const host = document.querySelector(`[data-tag-path="${CSS.escape(focusPath)}"]`)
      const input = host instanceof HTMLInputElement ? host : host?.querySelector('input')
      if (input instanceof HTMLInputElement) {
        input.focus()
        input.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      onFocusHandled?.()
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only when the requested path changes
  }, [focusPath])

  const setTagValue = (path: string, value: string): void => {
    onTagValuesChange({ ...tagValues, [path]: value })
  }

  const renderProvenanceBadge = (path: string, isEmpty: boolean): React.JSX.Element | null => {
    const provenance = tagProvenance?.[path]
    if (!provenance || provenance === 'empty' || isEmpty) return null
    if (provenance === 'memorized') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-aurora/40 bg-aurora/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-aurora">
          {t('generate.tags.provenance.memorized')}
          <button
            type="button"
            title={t('generate.tags.clearMemorized')}
            aria-label={t('generate.tags.clearMemorized')}
            onClick={(event) => {
              event.preventDefault()
              setTagValue(path, '')
            }}
            className="text-aurora transition hover:text-ink"
          >
            ×
          </button>
        </span>
      )
    }
    return (
      <span className="rounded-full border border-hairline bg-parchment px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-ink-subtle">
        {t(`generate.tags.provenance.${provenance}`)}
      </span>
    )
  }

  /** Empty fields first — they are what the user came to fill. */
  const sortEmptyFirst = (paths: string[]): string[] =>
    [...paths].sort(
      (a, b) =>
        ((tagValues[a] ?? '').trim() === '' ? 0 : 1) - ((tagValues[b] ?? '').trim() === '' ? 0 : 1)
    )

  const renderFieldGrid = (unsortedPaths: string[]): React.JSX.Element => {
    const locale = i18n.resolvedLanguage ?? 'fr'
    const paths = sortEmptyFirst(unsortedPaths)
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {paths.map((path) => {
          const value = tagValues[path] ?? ''
          const isEmpty = value.trim() === ''
          const fieldClass =
            INPUT_CLASS +
            (isEmpty ? ' border-warning-border focus:border-warning focus:ring-warning/30' : '')
          if (isDateTagPath(path)) {
            return (
              <label key={path} className="flex flex-col gap-1 text-sm text-ink">
                <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                  {localizeTagPath(path)}
                  {renderProvenanceBadge(path, isEmpty)}
                </span>
                <input
                  type="date"
                  data-tag-path={path}
                  value={parseLocalDateToIso(value, locale) ?? ''}
                  onChange={(event) => {
                    const iso = event.target.value
                    // The override is printed verbatim in the document — store the
                    // locale-formatted day, not the ISO value of the picker.
                    setTagValue(
                      path,
                      iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(locale) : ''
                    )
                  }}
                  className={fieldClass}
                />
              </label>
            )
          }
          return (
            <label key={path} className="flex flex-col gap-1 text-sm text-ink">
              <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                {localizeTagPath(path)}
                {renderProvenanceBadge(path, isEmpty)}
              </span>
              <input
                type="text"
                data-tag-path={path}
                value={value}
                onChange={(event) => setTagValue(path, event.target.value)}
                className={fieldClass}
                placeholder={t('generate.tags.emptyPlaceholder')}
              />
            </label>
          )
        })}
      </div>
    )
  }

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
        <span className="text-sm font-medium text-ink">{title}</span>
        <div className="flex items-center gap-2">
          {empty > 0 ? (
            <span className="rounded-full bg-warning-tint px-2 py-0.5 text-[10px] font-medium text-warning">
              {empty}{' '}
              {t('generate.tags.toFill', i18n.language === 'fr' ? 'à compléter' : 'to fill')}
            </span>
          ) : (
            <span className="rounded-full bg-success-tint px-2 py-0.5 text-[10px] font-medium text-success-deep">
              ✓
            </span>
          )}
          <svg
            className={`size-4 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
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
        <div className="shrink-0 rounded-2xl border border-hairline bg-white px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-ink-muted">
              {allFilled
                ? i18n.language === 'fr'
                  ? 'Tous les tags sont prêts'
                  : 'All tags are ready'
                : i18n.language === 'fr'
                  ? `${filledCount} / ${totalCount} tags remplis`
                  : `${filledCount} / ${totalCount} tags filled`}
            </span>
            <span className="flex items-center gap-2">
              {!allFilled ? (
                <span className="rounded-full bg-warning-tint px-2 py-0.5 text-[10px] font-medium text-warning">
                  {t('generate.tags.fieldsToFill', { count: totalCount - filledCount })}
                </span>
              ) : null}
              <span
                className={`text-xs font-medium ${allFilled ? 'text-success-deep' : 'text-warning'}`}
              >
                {progressPct}%
              </span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-parchment">
            <div
              className={`h-full rounded-full transition-all duration-500 ${allFilled ? 'bg-success' : 'bg-warning'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
        {hasContactSection ? (
          <section className="rounded-2xl border border-hairline bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink">
                {i18n.language === 'fr' ? 'Contacts' : 'Contacts'}
              </p>
              <p className="text-xs text-ink-subtle">{t('generate.tags.selectContact')}</p>
            </div>

            <div className="space-y-4 divide-y divide-white/5">
              {primaryTagPaths.length > 0 && dossierContacts.length > 0 ? (
                <div className="pt-0">
                  <ContactRow
                    roleLabel={t('generate.tags.primaryContactTitle')}
                    contactUuid={primaryContactUuid}
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
                      contactUuid={roleContactUuids[roleKey] ?? ''}
                      paths={paths}
                      onContactChange={(id) => {
                        onRoleContactIdsChange({ ...roleContactUuids, [roleKey]: id })
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
        invoiceAutoPaths.length > 0
          ? (() => {
              const open = isSectionOpen('invoice', emptyCount(invoiceFillablePaths) > 0)
              return (
                <section className="rounded-2xl border border-hairline bg-white p-4 space-y-4">
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
                      {invoiceAutoPaths.length > 0 ? (
                        <div className="rounded-xl border border-dashed border-success-border bg-success-tint px-3 py-2 text-xs text-success-deep">
                          {i18n.language === 'fr'
                            ? 'Renseignés automatiquement à la génération (numéro, date d’émission, échéance) :'
                            : 'Filled automatically at generation time (number, issue date, due date):'}
                          <ul className="mt-1 list-inside list-disc font-mono text-[11px]">
                            {invoiceAutoPaths.map((p) => (
                              <li key={p}>
                                {localizeTagPath(p)}
                                {tagValues[p] ? ` → ${tagValues[p]}` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {invoiceTablePaths.length > 0 ? (
                        <div className="rounded-xl border border-dashed border-success-border bg-success-tint px-3 py-2 text-xs text-success-deep">
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
                <section className="rounded-2xl border border-hairline bg-white p-4 space-y-4">
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
                            ? ' border-warning-border focus:border-warning focus:ring-warning/30'
                            : '')
                        const formatHint = locale.startsWith('fr')
                          ? 'JJ/MM/AAAA ou AAAA-MM-JJ'
                          : 'DD/MM/YYYY or YYYY-MM-DD'
                        return (
                          <div
                            key={path}
                            data-tag-path={path}
                            className="flex flex-col gap-1 text-sm text-ink"
                          >
                            <span className="text-xs text-ink-muted">{localizeTagPath(path)}</span>
                            <ComboField
                              type="date"
                              value={parseLocalDateToIso(value, locale) ?? ''}
                              onChange={(v) =>
                                onTagValuesChange(applyKeyDateOverride(path, v, locale, tagValues))
                              }
                              options={keyDateOptions}
                              placeholder={formatHint}
                              inputClassName={fieldClass}
                            />
                            {value && !isValidDate ? (
                              <span className="text-xs text-warning">{formatHint}</span>
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
                <section className="rounded-2xl border border-hairline bg-white p-4 space-y-4">
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
                          <p className="text-xs font-medium text-ink-muted">
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
          <div className="rounded-2xl border border-dashed border-hairline bg-white px-4 py-8 text-center text-sm text-ink-muted">
            {t('generate.tags.noTags')}
          </div>
        ) : null}
      </div>
    </div>
  )
}
