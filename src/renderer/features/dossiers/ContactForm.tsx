import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getManagedFieldKey,
  getContactManagedFieldValues,
  normalizeManagedFieldsConfig,
  setContactManagedFieldValue,
  type ContactRecord,
  type ContactUpsertInput,
  type ManagedFieldDefinition
} from '@shared/types'

import { Button, Field, Input, Select, Textarea } from '@renderer/components/ui'
import { TITLE_VALUES } from '@renderer/schemas'
import { useEntityStore } from '@renderer/stores'

import { formatIsoDateForLocaleInput } from './contactDateOfBirth'
import type { ContactFormErrors, ContactFormValues } from './contactFormValidation'
import { validateContactFormInput } from './contactFormValidation'
import { roleToTagKey } from './rolePresets'

interface ContactFormProps {
  dossierId: string
  initialValue?: Partial<ContactRecord>
  existingContacts?: ContactRecord[]
  disabled: boolean
  onCancel: () => void
  onSubmit: (input: ContactUpsertInput) => Promise<boolean>
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1)
}

function buildDisplayName(
  title: string,
  firstName: string,
  additionalFirstNames: string,
  lastName: string,
  institution: string
): string {
  const personName = [title, firstName, additionalFirstNames, lastName]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(' ')

  return personName || institution.trim()
}

function formatManagedFieldValue(
  definition: ManagedFieldDefinition | undefined,
  value: string | undefined,
  locale: string
): string {
  if (!value) return ''

  if (definition?.type === 'date') {
    return formatIsoDateForLocaleInput(value, locale)
  }

  return value
}

function getManagedFieldLabel(
  definition: ManagedFieldDefinition,
  t: (key: string) => string
): string {
  const translationKeyByField: Record<string, string> = {
    additionalFirstNames: 'contacts.form.additionalFirstNames',
    maidenName: 'contacts.form.maidenName',
    dateOfBirth: 'contacts.form.dateOfBirth',
    nationality: 'contacts.form.nationality',
    countryOfBirth: 'contacts.form.countryOfBirth',
    occupation: 'contacts.form.occupation',
    socialSecurityNumber: 'contacts.form.socialSecurityNumber'
  }

  const fieldKey = getManagedFieldKey(definition)

  return translationKeyByField[fieldKey] ? t(translationKeyByField[fieldKey]) : definition.label
}

function createInitialValues(
  locale: string,
  initialValue: Partial<ContactRecord> | undefined,
  definitions: ManagedFieldDefinition[]
): ContactFormValues {
  const managedFieldMap = new Map(
    definitions.map((definition) => [getManagedFieldKey(definition), definition])
  )
  const customFields = getContactManagedFieldValues(initialValue ?? {})

  return {
    id: initialValue?.uuid,
    title: initialValue?.title ?? '',
    firstName: initialValue?.firstName ?? '',
    additionalFirstNames: formatManagedFieldValue(
      managedFieldMap.get('additionalFirstNames'),
      customFields.additionalFirstNames,
      locale
    ),
    lastName: initialValue?.lastName ?? '',
    gender: initialValue?.gender ?? '',
    displayName: '',
    role: initialValue?.role ?? '',
    institution: initialValue?.institution ?? '',
    addressLine: initialValue?.addressLine ?? '',
    addressLine2: initialValue?.addressLine2 ?? '',
    zipCode: initialValue?.zipCode ?? '',
    city: initialValue?.city ?? '',
    country: initialValue?.country ?? '',
    phone: initialValue?.phone ?? '',
    email: initialValue?.email ?? '',
    dateOfBirth: formatManagedFieldValue(
      managedFieldMap.get('dateOfBirth'),
      customFields.dateOfBirth,
      locale
    ),
    countryOfBirth: formatManagedFieldValue(
      managedFieldMap.get('countryOfBirth'),
      customFields.countryOfBirth,
      locale
    ),
    nationality: formatManagedFieldValue(
      managedFieldMap.get('nationality'),
      customFields.nationality,
      locale
    ),
    occupation: formatManagedFieldValue(
      managedFieldMap.get('occupation'),
      customFields.occupation,
      locale
    ),
    socialSecurityNumber: formatManagedFieldValue(
      managedFieldMap.get('socialSecurityNumber'),
      customFields.socialSecurityNumber,
      locale
    ),
    maidenName: formatManagedFieldValue(
      managedFieldMap.get('maidenName'),
      customFields.maidenName,
      locale
    ),
    customFields: Object.fromEntries(
      Object.entries(customFields).map(([key, value]) => [
        key,
        formatManagedFieldValue(managedFieldMap.get(key), value, locale)
      ])
    ),
    information: initialValue?.information ?? ''
  }
}

export function ContactForm({
  dossierId,
  initialValue,
  existingContacts,
  disabled,
  onCancel,
  onSubmit
}: ContactFormProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const profile = useEntityStore((state) => state.profile)
  const loadProfile = useEntityStore((state) => state.load)
  const locale = i18n.resolvedLanguage ?? i18n.language

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const managedFieldsConfig = useMemo(
    () => normalizeManagedFieldsConfig(profile?.managedFields, profile?.profession),
    [profile?.managedFields, profile?.profession]
  )
  const managedFieldDefinitions = managedFieldsConfig.contacts

  const [values, setValues] = useState<ContactFormValues>(() =>
    createInitialValues(locale, initialValue, managedFieldDefinitions)
  )
  const [errors, setErrors] = useState<ContactFormErrors>({})
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const roleInputRef = useRef<HTMLInputElement>(null)
  const [titleDropdownOpen, setTitleDropdownOpen] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValues(createInitialValues(locale, initialValue, managedFieldDefinitions))
  }, [initialValue, locale, managedFieldDefinitions])

  const isEditing = Boolean(values.id)
  const customFields = values.customFields ?? {}
  const rolePresets = managedFieldsConfig.contactRoles
  const filteredRolePresets = rolePresets.filter((preset) =>
    preset.toLowerCase().includes(values.role.toLowerCase())
  )
  const hasDuplicateRole =
    values.role.trim().length > 0 &&
    (existingContacts ?? []).some(
      (contact) =>
        contact.uuid !== values.id &&
        contact.role?.toLowerCase() === values.role.trim().toLowerCase()
    )

  const activeRoleKey = values.role.trim().length > 0 ? roleToTagKey(values.role) : ''
  const hasExplicitRoleFieldConfig = activeRoleKey in managedFieldsConfig.contactRoleFields
  const roleManagedFieldKeys = activeRoleKey
    ? (managedFieldsConfig.contactRoleFields[activeRoleKey] ?? [])
    : []

  const visibleManagedFields = managedFieldDefinitions.filter((definition) => {
    if (!activeRoleKey || !hasExplicitRoleFieldConfig) {
      return true
    }

    return (
      roleManagedFieldKeys.includes(getManagedFieldKey(definition)) ||
      Boolean(customFields[getManagedFieldKey(definition)]?.trim())
    )
  })

  function updateNameField(
    field: 'title' | 'firstName' | 'lastName' | 'institution',
    value: string
  ): void {
    setValues((current) => {
      const next = { ...current, [field]: value }
      next.displayName = buildDisplayName(
        next.title,
        next.firstName,
        (next.customFields ?? {}).additionalFirstNames ?? '',
        next.lastName,
        next.institution
      )
      return next
    })
    setErrors((current) => ({ ...current, displayName: undefined, [field]: undefined }))
  }

  function updateField(
    field: Exclude<
      keyof ContactFormValues,
      'id' | 'title' | 'firstName' | 'lastName' | 'customFields'
    >,
    value: string
  ): void {
    setValues((current) => ({
      ...current,
      [field]: value
    }))

    setErrors((current) => ({
      ...current,
      [field]: undefined
    }))
  }

  function updateManagedField(key: string, value: string): void {
    setValues((current) => {
      const next = {
        ...current,
        customFields: setContactManagedFieldValue(current.customFields ?? {}, key, value),
        additionalFirstNames: key === 'additionalFirstNames' ? value : current.additionalFirstNames,
        dateOfBirth: key === 'dateOfBirth' ? value : current.dateOfBirth,
        countryOfBirth: key === 'countryOfBirth' ? value : current.countryOfBirth,
        nationality: key === 'nationality' ? value : current.nationality,
        occupation: key === 'occupation' ? value : current.occupation,
        socialSecurityNumber: key === 'socialSecurityNumber' ? value : current.socialSecurityNumber,
        maidenName: key === 'maidenName' ? value : current.maidenName
      }
      next.displayName = buildDisplayName(
        next.title,
        next.firstName,
        (next.customFields ?? {}).additionalFirstNames ?? '',
        next.lastName,
        next.institution
      )
      return next
    })

    setErrors((current) => {
      const nextCustomFields = { ...(current.customFields ?? {}) }
      delete nextCustomFields[key]

      return {
        ...current,
        customFields: Object.keys(nextCustomFields).length > 0 ? nextCustomFields : undefined,
        displayName: undefined
      }
    })
  }

  return (
    <form
      className="flex flex-col gap-0"
      onSubmit={async (event) => {
        event.preventDefault()

        const result = validateContactFormInput(
          {
            dossierId,
            ...values
          },
          {
            required: t('contacts.form.requiredError'),
            invalidEmail: t('contacts.form.invalidEmailError'),
            invalidDate: t('contacts.form.invalidDateError')
          },
          {
            locale,
            customFieldDefinitions: managedFieldDefinitions
          }
        )

        if (!result.success) {
          setErrors(result.errors)
          return
        }

        const saved = await onSubmit(result.data)

        if (saved) {
          setErrors({})
          onCancel()
        }
      }}
    >
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-slate-50">
          {isEditing ? t('contacts.form.editTitle') : t('contacts.form.addTitle')}
        </h3>
        <p className="text-sm text-slate-300">{t('contacts.form.requiredHint')}</p>
      </div>

      <div className="grid gap-6 py-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t('contacts.form.identitySection')}
          </span>

          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <div className="relative flex flex-col gap-2 text-sm text-slate-100">
              <label htmlFor="contact-role">{t('contacts.form.role')}</label>
              <input
                ref={roleInputRef}
                id="contact-role"
                type="text"
                value={values.role}
                placeholder={t('contacts.form.role_placeholder')}
                onChange={(event) => {
                  updateField('role', capitalizeFirst(event.target.value))
                  setRoleDropdownOpen(true)
                }}
                onFocus={() => setRoleDropdownOpen(true)}
                onBlur={() => setTimeout(() => setRoleDropdownOpen(false), 150)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
              {roleDropdownOpen && filteredRolePresets.length > 0 ? (
                <ul className="absolute left-0 right-0 top-[calc(100%-0.25rem)] z-10 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
                  {filteredRolePresets.map((preset) => (
                    <li key={preset}>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          updateField('role', capitalizeFirst(preset))
                          setRoleDropdownOpen(false)
                          roleInputRef.current?.blur()
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm text-slate-100 transition hover:bg-aurora/15 hover:text-slate-50"
                      >
                        {capitalizeFirst(preset)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {errors.role ? <span className="text-xs text-rose-300">{errors.role}</span> : null}
              {hasDuplicateRole ? (
                <span className="text-xs text-amber-300">
                  {t('contacts.form.role_duplicate_warning')}
                </span>
              ) : null}
            </div>

            <div className="relative flex flex-col gap-2 text-sm text-slate-100">
              <label htmlFor="contact-title">{t('contacts.form.title')}</label>
              <input
                ref={titleInputRef}
                id="contact-title"
                type="text"
                value={values.title}
                onChange={(event) => {
                  updateNameField('title', event.target.value)
                  setTitleDropdownOpen(true)
                }}
                onFocus={() => setTitleDropdownOpen(true)}
                onBlur={() => setTimeout(() => setTitleDropdownOpen(false), 150)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm text-slate-100 outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
              {titleDropdownOpen &&
              TITLE_VALUES.filter((entry) =>
                entry.toLowerCase().includes(values.title.toLowerCase())
              ).length > 0 ? (
                <ul className="absolute left-0 right-0 top-[calc(100%-0.25rem)] z-10 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
                  {TITLE_VALUES.filter((entry) =>
                    entry.toLowerCase().includes(values.title.toLowerCase())
                  ).map((titleOption) => (
                    <li key={titleOption}>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          updateNameField('title', titleOption)
                          setTitleDropdownOpen(false)
                          titleInputRef.current?.blur()
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm text-slate-100 transition hover:bg-aurora/15 hover:text-slate-50"
                      >
                        {titleOption}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-[8rem_1fr_1fr] gap-3">
            <label className="flex flex-col gap-2 text-sm text-slate-100" htmlFor="contact-gender">
              <span>{t('contacts.form.gender')}</span>
              <Select
                id="contact-gender"
                value={values.gender}
                onChange={(event) => updateField('gender', event.target.value)}
              >
                <option value="">{t('contacts.form.genderUnset')}</option>
                <option value="M">{t('contacts.form.genderM')}</option>
                <option value="F">{t('contacts.form.genderF')}</option>
                <option value="N">{t('contacts.form.genderN')}</option>
              </Select>
            </label>

            <label
              className="flex flex-col gap-2 text-sm text-slate-100"
              htmlFor="contact-last-name"
            >
              <span>{t('contacts.form.lastName')}</span>
              <input
                id="contact-last-name"
                type="text"
                value={values.lastName}
                onChange={(event) => updateNameField('lastName', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
            </label>

            <label
              className="flex flex-col gap-2 text-sm text-slate-100"
              htmlFor="contact-first-name"
            >
              <span>{t('contacts.form.firstName')}</span>
              <input
                id="contact-first-name"
                type="text"
                value={values.firstName}
                onChange={(event) => updateNameField('firstName', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
            </label>

            {errors.displayName ? (
              <span className="col-span-3 -mt-1 text-xs text-rose-300">{errors.displayName}</span>
            ) : null}
          </div>

          <label
            className="flex flex-col gap-2 text-sm text-slate-100"
            htmlFor="contact-institution"
          >
            <span>{t('contacts.form.institution')}</span>
            <input
              id="contact-institution"
              type="text"
              value={values.institution}
              onChange={(event) => updateNameField('institution', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-2 text-sm text-slate-100" htmlFor="contact-phone">
              <span>{t('contacts.form.phone')}</span>
              <input
                id="contact-phone"
                type="tel"
                value={values.phone}
                onChange={(event) => updateField('phone', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-100" htmlFor="contact-email">
              <span>{t('contacts.form.email')}</span>
              <input
                id="contact-email"
                type="email"
                value={values.email}
                onChange={(event) => updateField('email', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
              {errors.email ? <span className="text-xs text-rose-300">{errors.email}</span> : null}
            </label>
          </div>

          <div className="flex flex-col gap-2 text-sm text-slate-100">
            <span>{t('contacts.form.address')}</span>
            <input
              id="contact-address-line"
              type="text"
              value={values.addressLine}
              placeholder={t('contacts.form.addressLine_placeholder')}
              onChange={(event) => updateField('addressLine', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
            />
            <input
              id="contact-address-line2"
              type="text"
              value={values.addressLine2}
              placeholder={t('contacts.form.addressLine2_placeholder')}
              onChange={(event) => updateField('addressLine2', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
            />
            <div className="grid grid-cols-[7rem_1fr_1fr] gap-2">
              <input
                id="contact-zip-code"
                type="text"
                value={values.zipCode}
                placeholder={t('contacts.form.zipCode_placeholder')}
                onChange={(event) => updateField('zipCode', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
              <input
                id="contact-city"
                type="text"
                value={values.city}
                placeholder={t('contacts.form.city_placeholder')}
                onChange={(event) => updateField('city', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
              <input
                id="contact-country"
                type="text"
                value={values.country}
                placeholder={t('contacts.form.country_placeholder')}
                onChange={(event) => updateField('country', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t('contacts.form.personalInfo')}
          </span>

          <div className="grid gap-3 md:grid-cols-2">
            {visibleManagedFields.length > 0 ? (
              visibleManagedFields.map((definition) => (
                <Field
                  key={getManagedFieldKey(definition)}
                  className={
                    getManagedFieldKey(definition) === 'additionalFirstNames'
                      ? 'md:col-span-2'
                      : undefined
                  }
                  label={getManagedFieldLabel(definition, t)}
                  htmlFor={`contact-managed-${getManagedFieldKey(definition)}`}
                  error={errors.customFields?.[getManagedFieldKey(definition)]}
                  density="compact"
                >
                  <Input
                    id={`contact-managed-${getManagedFieldKey(definition)}`}
                    type="text"
                    density="compact"
                    value={customFields[getManagedFieldKey(definition)] ?? ''}
                    placeholder={
                      definition.type === 'date'
                        ? t('contacts.form.dateOfBirth_placeholder')
                        : undefined
                    }
                    inputMode={definition.type === 'date' ? 'numeric' : undefined}
                    onChange={(event) =>
                      updateManagedField(getManagedFieldKey(definition), event.target.value)
                    }
                  />
                </Field>
              ))
            ) : (
              <p className="md:col-span-2 text-sm text-slate-400">
                {t('contacts.form.noManagedFieldsForRole')}
              </p>
            )}
          </div>

          <label
            className="flex min-h-[10rem] grow flex-col gap-2 text-sm text-slate-100"
            htmlFor="contact-information"
          >
            <span>{t('contacts.form.information')}</span>
            <Textarea
              id="contact-information"
              value={values.information}
              onChange={(event) => updateField('information', event.target.value)}
              rows={8}
              placeholder={t('contacts.form.information_placeholder')}
              className="grow"
            />
          </label>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={disabled}>
          {t('contacts.form.cancelButton')}
        </Button>
        <Button type="submit" disabled={disabled}>
          {t('contacts.form.saveButton')}
        </Button>
      </div>
    </form>
  )
}
