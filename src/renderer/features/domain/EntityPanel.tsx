import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildAddressFields, parseAddress } from '@shared/addressFormatting'
import {
  createDefaultManagedFieldsConfig,
  getManagedFieldKey,
  normalizeManagedFieldsConfig,
  type EntityManagedFieldsConfig,
  type ManagedFieldDefinition
} from '@shared/managedFields'
import {
  entityProfileDraftSchema,
  GENDER_VALUES,
  PROFESSION_VALUES,
  TITLE_VALUES,
  type EntityProfileDraft
} from '@renderer/schemas'
import { useEntityStore } from '@renderer/stores'
import { useToast } from '@renderer/contexts/ToastContext'
import {
  AlertBanner,
  Button,
  Card,
  DialogShell,
  Field,
  Input,
  Select
} from '@renderer/components/ui'

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

function createEmptyDraft(): EntityProfileDraft {
  return {
    firmName: '',
    profession: undefined,
    title: '',
    gender: undefined,
    firstName: '',
    lastName: '',
    addressLine: '',
    addressLine2: '',
    zipCode: '',
    city: '',
    country: '',
    vatNumber: '',
    phone: '',
    email: '',
    managedFields: normalizeManagedFieldsConfig(undefined, undefined)
  }
}

function normalizeDraft(draft: EntityProfileDraft): EntityProfileDraft {
  // Migrate legacy free-text address to structured fields if new fields are absent
  const parsed =
    !draft.addressLine && !draft.zipCode && !draft.city && draft.address
      ? parseAddress(draft.address)
      : null
  return {
    firmName: draft.firmName ?? '',
    profession: draft.profession,
    title: draft.title ?? '',
    gender: draft.gender,
    firstName: draft.firstName ?? '',
    lastName: draft.lastName ?? '',
    addressLine: draft.addressLine ?? parsed?.addressLine ?? '',
    addressLine2: draft.addressLine2 ?? parsed?.addressLine2 ?? '',
    zipCode: draft.zipCode ?? parsed?.zipCode ?? '',
    city: draft.city ?? parsed?.city ?? '',
    country: draft.country ?? '',
    vatNumber: draft.vatNumber ?? '',
    phone: draft.phone ?? '',
    email: draft.email ?? '',
    managedFields: normalizeManagedFieldsConfig(draft.managedFields, draft.profession)
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
    <div>
      <div className="overflow-hidden rounded-xl border border-white/10">
        <div
          className="max-h-[28rem] overflow-y-auto pr-2"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
              <tr>
                <th className="bg-slate-900/95 px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-100 backdrop-blur-sm">
                  {title}
                </th>
                <th className="bg-slate-900/95 px-3 py-2 text-right backdrop-blur-sm">
                  <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
                    {addLabel}
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {definitions.length === 0 ? (
                <tr className="border-t border-white/10 bg-slate-950/20">
                  <td colSpan={2} className="px-3 py-3 text-sm text-slate-400">
                    {emptyLabel}
                  </td>
                </tr>
              ) : (
                definitions.map((definition, index) => (
                  <tr
                    key={`managed-field-row-${index}`}
                    className="border-t border-white/10 bg-slate-950/20 align-top"
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
    <div>
      <div className="overflow-hidden rounded-xl border border-white/10">
        <div
          className="max-h-[28rem] overflow-y-auto pr-2"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
              <tr>
                <th className="bg-slate-900/95 px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-100 backdrop-blur-sm">
                  {title}
                </th>
                <th className="bg-slate-900/95 px-3 py-2 text-right backdrop-blur-sm">
                  <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
                    {addLabel}
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {roles.length === 0 ? (
                <tr className="border-t border-white/10 bg-slate-950/20">
                  <td colSpan={2} className="px-3 py-3 text-sm text-slate-400">
                    {emptyLabel}
                  </td>
                </tr>
              ) : (
                roles.map((role, index) => (
                  <tr
                    key={`managed-role-row-${index}`}
                    className="border-t border-white/10 bg-slate-950/20 align-top"
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
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </span>
      <span className="whitespace-pre-wrap text-sm text-slate-100">{value}</span>
    </div>
  )
}

export function EntityDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const profile = useEntityStore((state) => state.profile)
  const isLoading = useEntityStore((state) => state.isLoading)
  const saveProfile = useEntityStore((state) => state.save)

  const { showToast } = useToast()
  const [values, setValues] = useState<EntityProfileDraft>(createEmptyDraft)
  const [errors, setErrors] = useState<EntityFormErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [activeManagedFieldsTab, setActiveManagedFieldsTab] =
    useState<ManagedFieldsTab>('contactRoles')
  const [professionDefaultsAppliedFor, setProfessionDefaultsAppliedFor] = useState<
    EntityProfileDraft['profession'] | null
  >(null)

  useEffect(() => {
    if (open) {
      setValues(profile ? normalizeDraft(profile) : createEmptyDraft())
      setErrors({})
      setActiveManagedFieldsTab('contactRoles')
      setProfessionDefaultsAppliedFor(null)
    }
  }, [open, profile])

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
    setValues((current) => {
      const nextValue = value === '' && field === 'profession' ? undefined : value

      if (field === 'profession') {
        setProfessionDefaultsAppliedFor(null)
        return {
          ...current,
          profession: nextValue as EntityProfileDraft['profession']
        }
      }

      return {
        ...current,
        [field]: nextValue
      }
    })
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
  const professionHasChanged = (profile?.profession ?? '') !== (values.profession ?? '')
  const requiresProfessionDefaultsConfirmation =
    professionHasChanged && professionDefaultsAppliedFor !== (values.profession ?? null)

  return (
    <DialogShell size="xl" panelClassName="max-w-[82rem]" aria-label={t('entity.section_title')}>
      <div className="mb-5 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-50">{t('entity.section_title')}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </div>

      <form
        className="flex flex-col gap-5"
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

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(30rem,0.95fr)]">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('entity.form.profession')} htmlFor="entity-profession">
                <Select
                  id="entity-profession"
                  value={values.profession ?? ''}
                  onChange={(event) => updateField('profession', event.target.value)}
                >
                  <option value="">{t('entity.form.profession_placeholder')}</option>
                  {PROFESSION_VALUES.map((p) => (
                    <option key={p} value={p}>
                      {t(`entity.profession.${p}`)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t('entity.form.title')} htmlFor="entity-title">
                <Input
                  id="entity-title"
                  type="text"
                  list="entity-title-options"
                  value={values.title ?? ''}
                  onChange={(event) => updateField('title', event.target.value)}
                />
                <datalist id="entity-title-options">
                  {TITLE_VALUES.map((title) => (
                    <option key={title} value={title} />
                  ))}
                </datalist>
              </Field>
            </div>

            {requiresProfessionDefaultsConfirmation ? (
              <div className="rounded-2xl border border-rose-400/35 bg-rose-400/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-300">
                  {t('entity.form.dangerZoneTitle')}
                </p>
                <p className="mt-2 text-sm text-rose-100">
                  {t('entity.form.professionChangeWarning')}
                </p>
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setValues((current) => ({
                        ...current,
                        managedFields: createDefaultManagedFieldsConfig(current.profession)
                      }))
                      setProfessionDefaultsAppliedFor(values.profession ?? null)
                      setActiveManagedFieldsTab('contactRoles')
                    }}
                  >
                    {t('entity.form.professionChangeConfirmButton')}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label={t('entity.form.firmName')}
                htmlFor="entity-firm-name"
                error={errors.firmName}
              >
                <Input
                  id="entity-firm-name"
                  type="text"
                  value={values.firmName}
                  onChange={(event) => updateField('firmName', event.target.value)}
                />
              </Field>

              <Field label={t('entity.form.vatNumber')} htmlFor="entity-vat-number">
                <Input
                  id="entity-vat-number"
                  type="text"
                  value={values.vatNumber ?? ''}
                  onChange={(event) => updateField('vatNumber', event.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-[8rem_1fr_1fr] gap-3">
              <Field label={t('entity.form.gender')} htmlFor="entity-gender">
                <Select
                  id="entity-gender"
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
              </Field>

              <Field label={t('entity.form.firstName')} htmlFor="entity-first-name">
                <Input
                  id="entity-first-name"
                  type="text"
                  value={values.firstName ?? ''}
                  onChange={(event) => updateField('firstName', event.target.value)}
                />
              </Field>

              <Field label={t('entity.form.lastName')} htmlFor="entity-last-name">
                <Input
                  id="entity-last-name"
                  type="text"
                  value={values.lastName ?? ''}
                  onChange={(event) => updateField('lastName', event.target.value)}
                />
              </Field>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-300">{t('entity.form.address')}</span>
              <Input
                id="entity-address-line"
                type="text"
                value={values.addressLine ?? ''}
                placeholder={t('contacts.form.addressLine_placeholder')}
                onChange={(event) => updateField('addressLine', event.target.value)}
              />
              <Input
                id="entity-address-line2"
                type="text"
                value={values.addressLine2 ?? ''}
                placeholder={t('contacts.form.addressLine2_placeholder')}
                onChange={(event) => updateField('addressLine2', event.target.value)}
              />
              <div className="grid grid-cols-[7rem_1fr_1fr] gap-2">
                <Input
                  id="entity-zip-code"
                  type="text"
                  value={values.zipCode ?? ''}
                  placeholder={t('contacts.form.zipCode_placeholder')}
                  onChange={(event) => updateField('zipCode', event.target.value)}
                />
                <Input
                  id="entity-city"
                  type="text"
                  value={values.city ?? ''}
                  placeholder={t('contacts.form.city_placeholder')}
                  onChange={(event) => updateField('city', event.target.value)}
                />
                <Input
                  id="entity-country"
                  type="text"
                  value={values.country ?? ''}
                  placeholder={t('contacts.form.country_placeholder')}
                  onChange={(event) => updateField('country', event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('entity.form.phone')} htmlFor="entity-phone">
                <Input
                  id="entity-phone"
                  type="tel"
                  value={values.phone ?? ''}
                  onChange={(event) => updateField('phone', event.target.value)}
                />
              </Field>

              <Field label={t('entity.form.email')} htmlFor="entity-email">
                <Input
                  id="entity-email"
                  type="email"
                  value={values.email ?? ''}
                  onChange={(event) => updateField('email', event.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <span className="text-sm font-medium text-slate-300">
                {t('entity.form.managedFieldsTitle')}
              </span>
            </div>

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
                        ? 'border-aurora/45 bg-aurora/15 text-slate-50'
                        : 'border-white/10 bg-slate-950/40 text-slate-300 hover:border-aurora/25'
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
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
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

  const displayName = [profile?.title, profile?.firstName, profile?.lastName]
    .filter(Boolean)
    .join(' ')
  const managedFields = normalizeManagedFieldsConfig(profile?.managedFields, profile?.profession)

  return (
    <Card className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-slate-50">{t('entity.section_title')}</h3>
          <p className="text-sm text-slate-300">{t('entity.section_summary')}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
          {t('entity.editButton')}
        </Button>
      </div>

      {storeError ? <AlertBanner tone="error">{storeError}</AlertBanner> : null}

      {/* Read-only display */}
      {profile ? (
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          {profile.profession ? (
            <ProfileRow
              label={t('entity.form.profession')}
              value={t(`entity.profession.${profile.profession}`)}
            />
          ) : null}
          <ProfileRow label={t('entity.form.firmName')} value={profile.firmName} />
          {displayName ? <ProfileRow label={t('entity.form.name')} value={displayName} /> : null}
          <ProfileRow label={t('entity.form.vatNumber')} value={profile.vatNumber} />
          <ProfileRow label={t('entity.form.phone')} value={profile.phone} />
          <ProfileRow label={t('entity.form.email')} value={profile.email} />
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
        <p className="text-sm text-slate-400">{t('entity.emptyHint')}</p>
      )}

      <EntityDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Card>
  )
}
