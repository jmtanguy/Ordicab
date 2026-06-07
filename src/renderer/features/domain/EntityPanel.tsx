import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildAddressFields, parseAddress } from '@shared/addressFormatting'
import type { AppLocale } from '@shared/contracts/app'
import {
  getManagedFieldKey,
  normalizeManagedFieldsConfig,
  type EntityManagedFieldsConfig,
  type ManagedFieldDefinition
} from '@shared/managedFields'
import { normalizeAppLocale } from '@renderer/i18n'
import {
  ENTITY_TITLE_SHORT,
  entityProfileDraftSchema,
  GENDER_VALUES,
  type EntityProfileDraft
} from '@shared/validation'
import { useEntityStore } from '@renderer/stores'
import { useToast } from '@renderer/contexts/ToastContext'
import { AlertBanner, Button, Card, DialogShell, Input, Select } from '@renderer/components/ui'

interface EntityFormErrors {
  firmName?: string
  form?: string
}

type ManagedFieldsTab = 'contactRoles' | 'contacts' | 'dates' | 'references'

function createEmptyManagedField(type: ManagedFieldDefinition['type']): ManagedFieldDefinition {
  return {
    label: '',
    type
  }
}

function createEmptyRole(): string {
  return ''
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1)
}

function createEmptyDraft(locale: AppLocale): EntityProfileDraft {
  return {
    firmName: '',
    gender: undefined,
    firstName: '',
    lastName: '',
    addressLine: '',
    addressLine2: '',
    zipCode: '',
    city: '',
    country: '',
    vatNumber: '',
    siren: '',
    siret: '',
    legalForm: '',
    shareCapital: '',
    rcsNumber: '',
    rcsCity: '',
    iban: '',
    bic: '',
    carpaIban: '',
    phone: '',
    email: '',
    barreau: '',
    toque: '',
    managedFields: normalizeManagedFieldsConfig(undefined, locale)
  }
}

function normalizeDraft(draft: EntityProfileDraft, locale: AppLocale): EntityProfileDraft {
  // Migrate legacy free-text address to structured fields if new fields are absent
  const parsed =
    !draft.addressLine && !draft.zipCode && !draft.city && draft.address
      ? parseAddress(draft.address)
      : null
  return {
    firmName: draft.firmName ?? '',
    gender: draft.gender,
    firstName: draft.firstName ?? '',
    lastName: draft.lastName ?? '',
    addressLine: draft.addressLine ?? parsed?.addressLine ?? '',
    addressLine2: draft.addressLine2 ?? parsed?.addressLine2 ?? '',
    zipCode: draft.zipCode ?? parsed?.zipCode ?? '',
    city: draft.city ?? parsed?.city ?? '',
    country: draft.country ?? '',
    vatNumber: draft.vatNumber ?? '',
    siren: draft.siren ?? '',
    siret: draft.siret ?? '',
    legalForm: draft.legalForm ?? '',
    shareCapital: draft.shareCapital ?? '',
    rcsNumber: draft.rcsNumber ?? '',
    rcsCity: draft.rcsCity ?? '',
    iban: draft.iban ?? '',
    bic: draft.bic ?? '',
    carpaIban: draft.carpaIban ?? '',
    phone: draft.phone ?? '',
    email: draft.email ?? '',
    barreau: draft.barreau ?? '',
    toque: draft.toque ?? '',
    managedFields: normalizeManagedFieldsConfig(draft.managedFields, locale)
  }
}

function updateManagedFieldDefinition(
  definitions: ManagedFieldDefinition[],
  index: number,
  patch: Partial<ManagedFieldDefinition>
): ManagedFieldDefinition[] {
  return definitions.map((definition, currentIndex) => {
    if (currentIndex !== index) {
      return definition
    }

    return {
      ...definition,
      ...patch
    }
  })
}

function ManagedFieldsTable({
  addLabel,
  deleteLabel,
  definitions,
  emptyLabel,
  onAdd,
  onChange,
  onDelete,
  title
}: {
  addLabel: string
  deleteLabel: string
  definitions: ManagedFieldDefinition[]
  emptyLabel: string
  onAdd: () => void
  onChange: (index: number, patch: Partial<ManagedFieldDefinition>) => void
  onDelete: (index: number) => void
  title: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#e5e3da]">
        <div
          className="min-h-0 flex-1 overflow-y-auto pr-2"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 text-left text-[11px] uppercase tracking-[0.14em] text-[#5c5c5a]">
              <tr>
                <th className="bg-[#f4f3ee] px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#1a1a1a] backdrop-blur-sm">
                  {title}
                </th>
                <th className="bg-[#f4f3ee] px-3 py-2 text-right backdrop-blur-sm">
                  <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
                    {addLabel}
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {definitions.length === 0 ? (
                <tr className="border-t border-[#e5e3da]">
                  <td colSpan={2} className="px-3 py-3 text-sm text-[#5c5c5a]">
                    {emptyLabel}
                  </td>
                </tr>
              ) : (
                definitions.map((definition, index) => (
                  <tr
                    key={`managed-field-row-${index}`}
                    className="border-t border-[#e5e3da] align-top"
                  >
                    <td className="px-3 py-2">
                      <Input
                        density="compact"
                        value={definition.label}
                        placeholder="Libellé"
                        onChange={(event) => onChange(index, { label: event.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(index)}
                      >
                        {deleteLabel}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ManagedRolesTable({
  addLabel,
  deleteLabel,
  emptyLabel,
  onAdd,
  onChange,
  onDelete,
  roles,
  title
}: {
  addLabel: string
  deleteLabel: string
  emptyLabel: string
  onAdd: () => void
  onChange: (index: number, value: string) => void
  onDelete: (index: number) => void
  roles: string[]
  title: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#e5e3da]">
        <div
          className="min-h-0 flex-1 overflow-y-auto pr-2"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 text-left text-[11px] uppercase tracking-[0.14em] text-[#5c5c5a]">
              <tr>
                <th className="bg-[#f4f3ee] px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#1a1a1a] backdrop-blur-sm">
                  {title}
                </th>
                <th className="bg-[#f4f3ee] px-3 py-2 text-right backdrop-blur-sm">
                  <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
                    {addLabel}
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {roles.length === 0 ? (
                <tr className="border-t border-[#e5e3da]">
                  <td colSpan={2} className="px-3 py-3 text-sm text-[#5c5c5a]">
                    {emptyLabel}
                  </td>
                </tr>
              ) : (
                roles.map((role, index) => (
                  <tr
                    key={`managed-role-row-${index}`}
                    className="border-t border-[#e5e3da] align-top"
                  >
                    <td className="px-3 py-2">
                      <Input
                        density="compact"
                        value={role}
                        placeholder="Rôle"
                        onChange={(event) => onChange(index, event.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(index)}
                      >
                        {deleteLabel}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ProfileRow({
  label,
  value
}: {
  label: string
  value: string | undefined
}): React.JSX.Element | null {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a8a85]">
        {label}
      </span>
      <span className="whitespace-pre-wrap text-sm text-[#1a1a1a]">{value}</span>
    </div>
  )
}

function EntityDialogPanel({
  children,
  className = '',
  title
}: {
  children: React.ReactNode
  className?: string
  title: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={`flex min-h-0 flex-col gap-3 ${className}`}>
      <h3 className="text-sm font-semibold text-[#1a1a1a]">{title}</h3>
      {children}
    </section>
  )
}

export function EntityDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const currentLocale = useMemo<AppLocale>(() => normalizeAppLocale(i18n.language), [i18n.language])
  const profile = useEntityStore((state) => state.profile)
  const isLoading = useEntityStore((state) => state.isLoading)
  const saveProfile = useEntityStore((state) => state.save)

  const { showToast } = useToast()
  const [values, setValues] = useState<EntityProfileDraft>(() => createEmptyDraft(currentLocale))
  const [errors, setErrors] = useState<EntityFormErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [activeManagedFieldsTab, setActiveManagedFieldsTab] =
    useState<ManagedFieldsTab>('contactRoles')

  useEffect(() => {
    if (open) {
      setValues(profile ? normalizeDraft(profile, currentLocale) : createEmptyDraft(currentLocale))
      setErrors({})
      setActiveManagedFieldsTab('contactRoles')
    }
  }, [open, profile, currentLocale])

  // Close dialog on Escape key
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  function updateField(field: keyof EntityProfileDraft, value: string | undefined): void {
    setValues((current) => ({
      ...current,
      [field]: value
    }))
    setErrors((current) => ({
      ...current,
      [field === 'firmName' ? 'firmName' : 'form']: undefined
    }))
  }

  function updateManagedFields(
    updater: (current: EntityManagedFieldsConfig) => EntityManagedFieldsConfig
  ): void {
    setValues((current) => ({
      ...current,
      managedFields: updater(current.managedFields!)
    }))
  }

  if (!open) return null

  const managedFields = values.managedFields!

  return (
    <DialogShell
      size="xl"
      panelClassName="max-h-[min(44rem,calc(100vh-3rem))] max-w-[80rem] overflow-hidden p-4"
      aria-label={t('entity.section_title')}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold text-[#1a1a1a]">{t('entity.section_title')}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[#5c5c5a] transition hover:bg-[#e4e1d5] hover:text-[#1a1a1a]"
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </div>

      <form
        className="flex min-h-0 flex-1 flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault()

          const parsed = entityProfileDraftSchema.safeParse(values)

          if (!parsed.success) {
            const firmNameIssue = parsed.error.issues.find((issue) => issue.path[0] === 'firmName')
            setErrors({
              firmName: firmNameIssue ? t('entity.form.requiredError') : undefined,
              form: firmNameIssue ? undefined : parsed.error.issues[0]?.message
            })
            return
          }

          setErrors({})
          setIsSaving(true)

          try {
            await saveProfile(parsed.data as EntityProfileDraft)

            if (!useEntityStore.getState().error) {
              showToast(t('entity.toast.saved'))
              onClose()
            }
          } finally {
            setIsSaving(false)
          }
        }}
      >
        {errors.form ? <AlertBanner tone="error">{errors.form}</AlertBanner> : null}

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(28rem,0.8fr)] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(34rem,0.9fr)]">
          <EntityDialogPanel title={t('entity.form.firmSection')}>
            <section className="space-y-2">
              <div>
                <Input
                  id="entity-firm-name"
                  type="text"
                  density="compact"
                  value={values.firmName}
                  placeholder={t('entity.form.firmName')}
                  aria-label={t('entity.form.firmName')}
                  aria-invalid={errors.firmName ? true : undefined}
                  onChange={(event) => updateField('firmName', event.target.value)}
                />
                {errors.firmName ? (
                  <p className="mt-1 text-xs text-red-600">{errors.firmName}</p>
                ) : null}
              </div>
              <div className="grid gap-2 md:grid-cols-[1fr_1fr_8rem]">
                <Input
                  id="entity-first-name"
                  type="text"
                  density="compact"
                  value={values.firstName ?? ''}
                  placeholder={t('entity.form.firstName')}
                  onChange={(event) => updateField('firstName', event.target.value)}
                />
                <Input
                  id="entity-last-name"
                  type="text"
                  density="compact"
                  value={values.lastName ?? ''}
                  placeholder={t('entity.form.lastName')}
                  onChange={(event) => updateField('lastName', event.target.value)}
                />
                <Select
                  id="entity-gender"
                  density="compact"
                  value={values.gender ?? ''}
                  onChange={(event) => updateField('gender', event.target.value)}
                >
                  <option value="">{t('contacts.form.genderUnset')}</option>
                  {GENDER_VALUES.map((g) => (
                    <option key={g} value={g}>
                      {t(`contacts.form.gender${g}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  id="entity-phone"
                  type="tel"
                  density="compact"
                  value={values.phone ?? ''}
                  placeholder={t('entity.form.phone')}
                  onChange={(event) => updateField('phone', event.target.value)}
                />
                <Input
                  id="entity-email"
                  type="email"
                  density="compact"
                  value={values.email ?? ''}
                  placeholder={t('entity.form.email')}
                  aria-label={t('entity.form.email')}
                  onChange={(event) => updateField('email', event.target.value)}
                />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  id="entity-barreau"
                  type="text"
                  density="compact"
                  value={values.barreau ?? ''}
                  placeholder={t('entity.form.barreau', { defaultValue: 'Barreau' })}
                  onChange={(event) => updateField('barreau', event.target.value)}
                />
                <Input
                  id="entity-toque"
                  type="text"
                  density="compact"
                  value={values.toque ?? ''}
                  placeholder={t('entity.form.toque', { defaultValue: 'Toque' })}
                  onChange={(event) => updateField('toque', event.target.value)}
                />
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-[#1a1a1a]">
                {t('entity.form.headquartersSection')}
              </h4>
              <Input
                id="entity-address-line"
                type="text"
                density="compact"
                value={values.addressLine ?? ''}
                placeholder={t('contacts.form.addressLine_placeholder')}
                onChange={(event) => updateField('addressLine', event.target.value)}
              />
              <Input
                id="entity-address-line2"
                type="text"
                density="compact"
                value={values.addressLine2 ?? ''}
                placeholder={t('contacts.form.addressLine2_placeholder')}
                onChange={(event) => updateField('addressLine2', event.target.value)}
              />
              <div className="grid grid-cols-[6.5rem_1fr_1fr] gap-2">
                <Input
                  id="entity-zip-code"
                  type="text"
                  density="compact"
                  value={values.zipCode ?? ''}
                  placeholder={t('contacts.form.zipCode_placeholder')}
                  onChange={(event) => updateField('zipCode', event.target.value)}
                />
                <Input
                  id="entity-city"
                  type="text"
                  density="compact"
                  value={values.city ?? ''}
                  placeholder={t('contacts.form.city_placeholder')}
                  onChange={(event) => updateField('city', event.target.value)}
                />
                <Input
                  id="entity-country"
                  type="text"
                  density="compact"
                  value={values.country ?? ''}
                  placeholder={t('contacts.form.country_placeholder')}
                  onChange={(event) => updateField('country', event.target.value)}
                />
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-[#1a1a1a]">
                {t('entity.form.legalIdentitySection')}
              </h4>
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  id="entity-siren"
                  type="text"
                  density="compact"
                  value={values.siren ?? ''}
                  placeholder={t('entity.form.siren')}
                  onChange={(event) => updateField('siren', event.target.value)}
                />
                <Input
                  id="entity-siret"
                  type="text"
                  density="compact"
                  value={values.siret ?? ''}
                  placeholder={t('entity.form.siret')}
                  onChange={(event) => updateField('siret', event.target.value)}
                />
                <Input
                  id="entity-legal-form"
                  type="text"
                  density="compact"
                  value={values.legalForm ?? ''}
                  placeholder={t('entity.form.legalForm')}
                  onChange={(event) => updateField('legalForm', event.target.value)}
                />
                <Input
                  id="entity-share-capital"
                  type="text"
                  density="compact"
                  value={values.shareCapital ?? ''}
                  placeholder={t('entity.form.shareCapital')}
                  onChange={(event) => updateField('shareCapital', event.target.value)}
                />
                <Input
                  id="entity-vat-number"
                  type="text"
                  density="compact"
                  value={values.vatNumber ?? ''}
                  placeholder={t('entity.form.vatNumber')}
                  aria-label={t('entity.form.vatNumber')}
                  onChange={(event) => updateField('vatNumber', event.target.value)}
                />
                <Input
                  id="entity-rcs-number"
                  type="text"
                  density="compact"
                  value={values.rcsNumber ?? ''}
                  placeholder={t('entity.form.rcsNumber')}
                  onChange={(event) => updateField('rcsNumber', event.target.value)}
                />
                <Input
                  id="entity-rcs-city"
                  type="text"
                  density="compact"
                  value={values.rcsCity ?? ''}
                  placeholder={t('entity.form.rcsCity')}
                  onChange={(event) => updateField('rcsCity', event.target.value)}
                />
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-[#1a1a1a]">
                {t('entity.form.bankingSection')}
              </h4>
              <Input
                id="entity-iban"
                type="text"
                density="compact"
                value={values.iban ?? ''}
                placeholder={t('entity.form.iban')}
                onChange={(event) => updateField('iban', event.target.value)}
              />
              <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
                <Input
                  id="entity-bic"
                  type="text"
                  density="compact"
                  value={values.bic ?? ''}
                  placeholder={t('entity.form.bic')}
                  onChange={(event) => updateField('bic', event.target.value)}
                />
                <Input
                  id="entity-carpa-iban"
                  type="text"
                  density="compact"
                  value={values.carpaIban ?? ''}
                  placeholder={t('entity.form.carpaIban')}
                  onChange={(event) => updateField('carpaIban', event.target.value)}
                />
              </div>
            </section>
          </EntityDialogPanel>

          <EntityDialogPanel
            title={t('entity.form.managedFieldsTitle')}
            className="overflow-hidden"
          >
            <div className="flex gap-1 overflow-x-auto pb-1 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(
                [
                  ['contactRoles', t('entity.form.contactRoles')],
                  ['contacts', t('entity.form.contactManagedFields')],
                  ['dates', t('entity.form.keyDateManagedFields')],
                  ['references', t('entity.form.keyReferenceManagedFields')]
                ] as const
              ).map(([tab, label]) => {
                const active = activeManagedFieldsTab === tab
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveManagedFieldsTab(tab)}
                    className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition ${
                      active
                        ? 'border-aurora/45 bg-aurora/15 text-[#1a1a1a]'
                        : 'border-[#e5e3da] bg-white text-[#1a1a1a] hover:border-aurora/25'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {activeManagedFieldsTab === 'contactRoles' ? (
              <ManagedRolesTable
                title={t('entity.form.contactRoles')}
                addLabel={t('entity.form.addContactRole')}
                deleteLabel={t('contacts.deleteButton')}
                emptyLabel={t('entity.form.noRoleConfigured')}
                roles={managedFields.contactRoles}
                onAdd={() =>
                  updateManagedFields((current) => ({
                    ...current,
                    contactRoles: [createEmptyRole(), ...current.contactRoles]
                  }))
                }
                onChange={(index, value) =>
                  updateManagedFields((current) => ({
                    ...current,
                    contactRoles: current.contactRoles.map((role, currentIndex) =>
                      currentIndex === index ? capitalizeFirst(value) : role
                    )
                  }))
                }
                onDelete={(index) =>
                  updateManagedFields((current) => ({
                    ...current,
                    contactRoles: current.contactRoles.filter(
                      (_, currentIndex) => currentIndex !== index
                    )
                  }))
                }
              />
            ) : null}

            {activeManagedFieldsTab === 'contacts' ? (
              <ManagedFieldsTable
                title={t('entity.form.contactManagedFields')}
                addLabel={t('entity.form.addManagedField')}
                deleteLabel={t('contacts.deleteButton')}
                emptyLabel={t('entity.form.noFieldConfigured')}
                definitions={managedFields.contacts}
                onAdd={() =>
                  updateManagedFields((current) => ({
                    ...current,
                    contacts: [createEmptyManagedField('text'), ...current.contacts]
                  }))
                }
                onChange={(index, patch) =>
                  updateManagedFields((current) => ({
                    ...current,
                    contacts: updateManagedFieldDefinition(current.contacts, index, patch)
                  }))
                }
                onDelete={(index) =>
                  updateManagedFields((current) => {
                    const nextContacts = current.contacts.filter(
                      (_, currentIndex) => currentIndex !== index
                    )
                    const allowedKeys = new Set(
                      nextContacts.map((field) => getManagedFieldKey(field))
                    )

                    return {
                      ...current,
                      contacts: nextContacts,
                      contactRoleFields: Object.fromEntries(
                        Object.entries(current.contactRoleFields).map(([roleKey, fieldKeys]) => [
                          roleKey,
                          fieldKeys.filter((fieldKey) => allowedKeys.has(fieldKey))
                        ])
                      )
                    }
                  })
                }
              />
            ) : null}

            {activeManagedFieldsTab === 'dates' ? (
              <ManagedFieldsTable
                title={t('entity.form.keyDateManagedFields')}
                addLabel={t('entity.form.addManagedField')}
                deleteLabel={t('contacts.deleteButton')}
                emptyLabel={t('entity.form.noFieldConfigured')}
                definitions={managedFields.keyDates}
                onAdd={() =>
                  updateManagedFields((current) => ({
                    ...current,
                    keyDates: [createEmptyManagedField('date'), ...current.keyDates]
                  }))
                }
                onChange={(index, patch) =>
                  updateManagedFields((current) => ({
                    ...current,
                    keyDates: updateManagedFieldDefinition(current.keyDates, index, patch)
                  }))
                }
                onDelete={(index) =>
                  updateManagedFields((current) => ({
                    ...current,
                    keyDates: current.keyDates.filter((_, currentIndex) => currentIndex !== index)
                  }))
                }
              />
            ) : null}

            {activeManagedFieldsTab === 'references' ? (
              <ManagedFieldsTable
                title={t('entity.form.keyReferenceManagedFields')}
                addLabel={t('entity.form.addManagedField')}
                deleteLabel={t('contacts.deleteButton')}
                emptyLabel={t('entity.form.noFieldConfigured')}
                definitions={managedFields.keyReferences}
                onAdd={() =>
                  updateManagedFields((current) => ({
                    ...current,
                    keyReferences: [createEmptyManagedField('text'), ...current.keyReferences]
                  }))
                }
                onChange={(index, patch) =>
                  updateManagedFields((current) => ({
                    ...current,
                    keyReferences: updateManagedFieldDefinition(current.keyReferences, index, patch)
                  }))
                }
                onDelete={(index) =>
                  updateManagedFields((current) => ({
                    ...current,
                    keyReferences: current.keyReferences.filter(
                      (_, currentIndex) => currentIndex !== index
                    )
                  }))
                }
              />
            ) : null}
          </EntityDialogPanel>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#e5e3da] pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('templates.editor.cancelButton')}
          </Button>
          <Button type="submit" disabled={isLoading || isSaving}>
            {t('entity.form.saveButton')}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}

export function EntityPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const profile = useEntityStore((state) => state.profile)
  const storeError = useEntityStore((state) => state.error)
  const loadProfile = useEntityStore((state) => state.load)

  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const displayName = profile
    ? [ENTITY_TITLE_SHORT, profile.firstName, profile.lastName].filter(Boolean).join(' ')
    : ''
  const managedFields = normalizeManagedFieldsConfig(profile?.managedFields)

  return (
    <Card className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-[#1a1a1a]">{t('entity.section_title')}</h3>
          <p className="text-sm text-[#1a1a1a]">{t('entity.section_summary')}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
          {t('entity.editButton')}
        </Button>
      </div>

      {storeError ? <AlertBanner tone="error">{storeError}</AlertBanner> : null}

      {/* Read-only display */}
      {profile ? (
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <ProfileRow label={t('entity.form.firmName')} value={profile.firmName} />
          {displayName ? <ProfileRow label={t('entity.form.name')} value={displayName} /> : null}
          <ProfileRow label={t('entity.form.vatNumber')} value={profile.vatNumber} />
          <ProfileRow label={t('entity.form.siren')} value={profile.siren} />
          <ProfileRow label={t('entity.form.siret')} value={profile.siret} />
          <ProfileRow label={t('entity.form.legalForm')} value={profile.legalForm} />
          <ProfileRow label={t('entity.form.shareCapital')} value={profile.shareCapital} />
          <ProfileRow label={t('entity.form.rcsNumber')} value={profile.rcsNumber} />
          <ProfileRow label={t('entity.form.rcsCity')} value={profile.rcsCity} />
          <ProfileRow label={t('entity.form.iban')} value={profile.iban} />
          <ProfileRow label={t('entity.form.bic')} value={profile.bic} />
          <ProfileRow label={t('entity.form.carpaIban')} value={profile.carpaIban} />
          <ProfileRow label={t('entity.form.phone')} value={profile.phone} />
          <ProfileRow label={t('entity.form.email')} value={profile.email} />
          <ProfileRow
            label={t('entity.form.barreau', { defaultValue: 'Barreau' })}
            value={profile.barreau}
          />
          <ProfileRow
            label={t('entity.form.toque', { defaultValue: 'Toque' })}
            value={profile.toque}
          />
          <ProfileRow
            label={t('entity.form.managedFieldsSummary')}
            value={`${managedFields.contacts.length} contact, ${managedFields.keyDates.length} dates, ${managedFields.keyReferences.length} références`}
          />
          {(profile.addressLine ?? profile.zipCode ?? profile.city ?? profile.address) ? (
            <div className="md:col-span-2">
              <ProfileRow
                label={t('entity.form.address')}
                value={
                  (profile.addressLine ?? profile.zipCode ?? profile.city)
                    ? buildAddressFields(profile).addressFormatted
                    : buildAddressFields({ addressLine: profile.address }).addressFormatted
                }
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-[#5c5c5a]">{t('entity.emptyHint')}</p>
      )}

      <EntityDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Card>
  )
}
