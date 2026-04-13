import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildAddressFields } from '@shared/addressFormatting'
import { buildSalutationFields } from '@shared/contactSalutation'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import {
  getContactManagedFieldTemplateValues,
  getContactManagedFieldValue,
  getContactManagedFieldValues,
  normalizeManagedFieldsConfig,
  type ManagedFieldDefinition
} from '@shared/managedFields'
import { buildTagPathLocalizer, templateRoutineCatalog } from '@shared/templateRoutines'

import { Button } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import type { ContactRecord, DossierStatus } from '@renderer/schemas'
import {
  useContactStore,
  useDossierStore,
  useEntityStore,
  useTemplateStore
} from '@renderer/stores'

import { roleToTagKey } from '../dossiers/rolePresets'
import { RichTextEditor } from './RichTextEditor'

// ── ComboField ────────────────────────────────────────────────────────────────
// Free-text input with a styled dropdown of preset suggestions.

interface ComboOption {
  label: string
  value: string
}

function ComboField({
  value,
  onChange,
  options,
  placeholder,
  inputClassName
}: {
  value: string
  onChange: (v: string) => void
  options: ComboOption[]
  placeholder?: string
  inputClassName?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={inputClassName}
      />
      {open && options.length > 0 ? (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-[0_8px_24px_rgba(2,6,23,0.55)]">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault() // prevent input blur before click
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition hover:bg-slate-800',
                  opt.value === value ? 'text-aurora' : 'text-slate-100'
                )}
              >
                <span className="font-medium">{opt.label}</span>
                <span className="shrink-0 font-mono text-xs text-slate-400">{opt.value}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

const statusBadgeClasses: Record<DossierStatus, string> = {
  active: 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100',
  pending: 'border-amber-300/40 bg-amber-300/15 text-amber-100',
  completed: 'border-sky-300/40 bg-sky-300/15 text-sky-100',
  archived: 'border-slate-400/40 bg-slate-400/15 text-slate-100'
}

function getFilenameFromPath(path: string): string {
  const segments = path.split(/[/\\]/)
  return segments[segments.length - 1] ?? path
}

/**
 * Parses a user-entered date string to ISO YYYY-MM-DD.
 * Accepts ISO format directly, or DD/MM/YYYY (and variants) for FR locale.
 * Returns null if the input cannot be reliably parsed as a date.
 */
function parseLocalDateToIso(value: string, locale: string): string | null {
  const v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  if (locale.startsWith('fr')) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v)
    if (m) {
      const [, day, month, yearRaw] = m
      const year = yearRaw?.length === 2 ? `20${yearRaw}` : yearRaw
      const iso = `${year}-${month?.padStart(2, '0')}-${day?.padStart(2, '0')}`
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(new Date(`${iso}T12:00:00`).getTime()))
        return iso
    }
  }
  const d = new Date(v)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

function formatIsoDateShort(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(
      new Date(`${iso}T12:00:00`)
    )
  } catch {
    return iso
  }
}

/**
 * Applies a keyDate base path override and auto-derives all formatted variants.
 * If the value is a parseable date (ISO or local format), the .formatted / .long / .short
 * sub-overrides are populated automatically. Otherwise they are cleared.
 */
function applyKeyDateOverride(
  path: string,
  value: string,
  locale: string,
  current: Record<string, string>
): Record<string, string> {
  const updated: Record<string, string> = { ...current, [path]: value }
  const isoDate = parseLocalDateToIso(value, locale)
  if (isoDate) {
    const d = new Date(`${isoDate}T12:00:00`)
    updated[`${path}.formatted`] = d.toLocaleDateString(locale)
    updated[`${path}.long`] = d.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
    updated[`${path}.short`] = d.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: '2-digit'
    })
  } else {
    delete updated[`${path}.formatted`]
    delete updated[`${path}.long`]
    delete updated[`${path}.short`]
  }
  return updated
}

function buildKeyDateOptions(
  detail:
    | {
        keyDates: Array<{ label: string; date: string }>
      }
    | null
    | undefined,
  locale: string
): ComboOption[] {
  return (detail?.keyDates ?? [])
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((keyDate) => ({
      label: `${keyDate.label} (${formatIsoDateShort(keyDate.date, locale)})`,
      value: keyDate.date
    }))
}

function buildKeyReferenceOptions(
  detail:
    | {
        keyReferences: Array<{ label: string; value: string }>
      }
    | null
    | undefined
): ComboOption[] {
  return (detail?.keyReferences ?? []).map((keyReference) => ({
    label: keyReference.label,
    value: keyReference.value
  }))
}

/** Returns all contact field values for a given tag prefix (e.g. "contact" or "contact.client") */
function contactFieldValues(
  contact: ContactRecord | undefined,
  prefix: string,
  managedFieldDefinitions: ManagedFieldDefinition[]
): Record<string, string> {
  if (!contact) return {}
  const displayName = computeContactDisplayName(contact)
  const firstNames = [
    contact.firstName,
    getContactManagedFieldValue(contact, 'additionalFirstNames')
  ]
    .map((v) => v?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
  const fields: Record<string, string | undefined> = {
    displayName,
    title: contact.title,
    firstName: contact.firstName,
    additionalFirstNames: getContactManagedFieldValue(contact, 'additionalFirstNames'),
    firstNames: firstNames || undefined,
    lastName: contact.lastName,
    gender: contact.gender,
    role: contact.role,
    email: contact.email,
    phone: contact.phone,
    institution: contact.institution,
    addressLine: contact.addressLine,
    addressLine2: contact.addressLine2,
    zipCode: contact.zipCode,
    city: contact.city,
    country: contact.country,
    ...getContactManagedFieldValues(contact),
    ...getContactManagedFieldTemplateValues(contact, managedFieldDefinitions),
    ...buildAddressFields(contact),
    ...buildSalutationFields(contact.gender, contact.lastName, displayName)
  }
  const result: Record<string, string> = {}
  for (const [field, val] of Object.entries(fields)) {
    if (val) result[`${prefix}.${field}`] = String(val)
  }
  return result
}

interface ReviewDraftState {
  html: string
  filename: string
  unresolvedTags: string[]
  resolvedTags: Record<string, string>
}

interface GenerateDocumentPanelProps {
  initialTemplateId?: string | null
  initialDossierId?: string | null
  onBack?: () => void
}

export function GenerateDocumentPanel({
  initialTemplateId = null,
  initialDossierId = null,
  onBack
}: GenerateDocumentPanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const localizeTagPath = useMemo(
    () => buildTagPathLocalizer(templateRoutineCatalog, i18n.language),
    [i18n.language]
  )
  const dossiers = useDossierStore((state) => state.dossiers)
  const templates = useTemplateStore((state) => state.templates)
  const generateDocument = useTemplateStore((state) => state.generate)
  const previewDocument = useTemplateStore((state) => state.preview)
  const previewDocxDocument = useTemplateStore((state) => state.previewDocx)
  const selectOutputPath = useTemplateStore((state) => state.selectOutputPath)
  const saveGeneratedDocument = useTemplateStore((state) => state.saveGeneratedDocument)
  const openGeneratedFile = useTemplateStore((state) => state.openGeneratedFile)
  const loadDossiers = useDossierStore((state) => state.load)
  const loadDetail = useDossierStore((state) => state.loadDetail)
  const profile = useEntityStore((state) => state.profile)
  const loadContacts = useContactStore((state) => state.load)
  const contactsByDossierId = useContactStore((state) => state.contactsByDossierId)

  const [step, setStep] = useState<'setup' | 'tags' | 'save'>('setup')
  const [selectedDossierId, setSelectedDossierId] = useState(initialDossierId ?? '')
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ filename: string; outputPath: string } | null>(null)
  const [reviewDraft, setReviewDraft] = useState<ReviewDraftState | null>(null)
  const [copied, setCopied] = useState(false)
  const [dossierFilter, setDossierFilter] = useState('')
  const [dossierSort, setDossierSort] = useState<'name-asc' | 'name-desc' | 'next-date'>('name-asc')
  const [templateFilter, setTemplateFilter] = useState('')
  const [templateSort, setTemplateSort] = useState<'name-asc' | 'name-desc'>('name-asc')
  // Docx-save step state
  const [docxFilename, setDocxFilename] = useState('')
  const [docxCustomOutputPath, setDocxCustomOutputPath] = useState<string | null>(null)

  // Tags step state
  const [tagPaths, setTagPaths] = useState<string[]>([])
  const [tagValues, setTagValues] = useState<Record<string, string>>({})
  const [primaryContactId, setPrimaryContactId] = useState('')
  const [roleContactIds, setRoleContactIds] = useState<Record<string, string>>({})
  const [openTagSections, setOpenTagSections] = useState<Record<string, boolean>>({})
  const [keyDateOptions, setKeyDateOptions] = useState<ComboOption[]>([])
  const [keyReferenceOptions, setKeyReferenceOptions] = useState<ComboOption[]>([])
  const managedFieldsConfig = useMemo(
    () => normalizeManagedFieldsConfig(profile?.managedFields, profile?.profession),
    [profile?.managedFields, profile?.profession]
  )

  useEffect(() => {
    void loadDossiers()
  }, [loadDossiers])

  // Dismiss success banner when leaving setup (not when arriving at it after a save)
  useEffect(() => {
    if (step !== 'setup') {
      setSuccess(null)
    }
  }, [step])

  useEffect(() => {
    if (initialTemplateId) {
      setSelectedTemplateId(initialTemplateId)
    }
  }, [initialTemplateId])

  useEffect(() => {
    let isCancelled = false

    if (selectedDossierId) {
      void loadContacts({ dossierId: selectedDossierId })
      void loadDetail(selectedDossierId).then(() => {
        if (isCancelled) {
          return
        }

        const detail = useDossierStore.getState().activeDossier

        if (detail?.id !== selectedDossierId) {
          return
        }

        setKeyDateOptions(buildKeyDateOptions(detail, i18n.resolvedLanguage ?? 'fr'))
        setKeyReferenceOptions(buildKeyReferenceOptions(detail))
      })
      return () => {
        isCancelled = true
      }
    }

    setKeyDateOptions([])
    setKeyReferenceOptions([])

    return () => {
      isCancelled = true
    }
  }, [selectedDossierId, loadContacts, loadDetail, i18n.resolvedLanguage])

  const dossierContacts = selectedDossierId ? (contactsByDossierId[selectedDossierId] ?? []) : []
  const selectedTemplate = templates.find((tmpl) => tmpl.id === selectedTemplateId)
  const selectedTemplateUsesDocxSource = selectedTemplate?.hasDocxSource === true

  const canSubmitSetup =
    selectedDossierId.trim().length > 0 &&
    selectedTemplateId.trim().length > 0 &&
    templates.some((tmpl) => tmpl.id === selectedTemplateId) &&
    !isSubmitting

  const canSave = reviewDraft !== null && reviewDraft.filename.trim().length > 0 && !isSubmitting

  // When a contact is selected for primary, update all contact.* tag values
  function applyPrimaryContact(
    contactId: string,
    currentTagValues: Record<string, string>,
    contacts: ContactRecord[] = dossierContacts
  ): Record<string, string> {
    const contact = contacts.find((c) => c.uuid === contactId)
    const fields = contactFieldValues(contact, 'contact', managedFieldsConfig.contacts)
    // Only apply to flat contact.* tags (2 segments)
    const next = { ...currentTagValues }
    for (const path of Object.keys(next)) {
      const parts = path.split('.')
      if (parts[0] === 'contact' && parts.length === 2) {
        next[path] = fields[path] ?? ''
      }
    }
    return next
  }

  // When a contact is selected for a role, update all contact.<roleKey>.* tag values
  function applyRoleContact(
    roleKey: string,
    contactId: string,
    currentTagValues: Record<string, string>,
    contacts: ContactRecord[] = dossierContacts
  ): Record<string, string> {
    const contact = contacts.find((c) => c.uuid === contactId)
    const fields = contactFieldValues(contact, `contact.${roleKey}`, managedFieldsConfig.contacts)
    const next = { ...currentTagValues }
    for (const path of Object.keys(next)) {
      const parts = path.split('.')
      if (parts[0] === 'contact' && parts[1] === roleKey && parts.length === 3) {
        next[path] = fields[path] ?? ''
      }
    }
    return next
  }

  function hydrateAutoSelectedContactTags(
    initialTagValues: Record<string, string>,
    initialPrimaryContactId: string,
    initialRoleContactIds: Record<string, string>,
    contacts: ContactRecord[]
  ): Record<string, string> {
    let next = { ...initialTagValues }

    if (initialPrimaryContactId) {
      next = applyPrimaryContact(initialPrimaryContactId, next, contacts)
    }

    for (const [roleKey, contactId] of Object.entries(initialRoleContactIds)) {
      if (contactId) {
        next = applyRoleContact(roleKey, contactId, next, contacts)
      }
    }

    return next
  }

  async function handleSetupNext(): Promise<void> {
    if (!canSubmitSetup || !selectedTemplate) return

    setError(null)
    setIsSubmitting(true)

    try {
      await Promise.all([
        loadContacts({ dossierId: selectedDossierId }),
        loadDetail(selectedDossierId)
      ])

      const loadedContacts = useContactStore.getState().contactsByDossierId[selectedDossierId] ?? []
      const loadedDossier = (() => {
        const detail = useDossierStore.getState().activeDossier
        return detail?.id === selectedDossierId ? detail : null
      })()

      setKeyDateOptions(buildKeyDateOptions(loadedDossier, i18n.resolvedLanguage ?? 'fr'))
      setKeyReferenceOptions(buildKeyReferenceOptions(loadedDossier))

      // Docx-sourced templates: preview tags first for reconciliation
      if (selectedTemplateUsesDocxSource) {
        const result = await previewDocxDocument({
          dossierId: selectedDossierId,
          templateId: selectedTemplateId
        })

        if (!result.success) {
          setError(result.error || t('generate.previewError'))
          return
        }

        const paths = result.data.tagPaths
        setTagPaths(paths)
        setDocxFilename(result.data.suggestedFilename)
        setDocxCustomOutputPath(null)

        // Init tagValues from resolved values; empty string for unresolved
        const initial: Record<string, string> = {}
        for (const path of paths) {
          initial[path] = result.data.resolvedTags[path] ?? ''
        }

        // Auto-select primary contact
        const firstContact = loadedContacts[0]
        const initPrimaryId = firstContact?.uuid ?? ''
        setPrimaryContactId(initPrimaryId)

        // Auto-select role contacts
        const initRoleIds: Record<string, string> = {}
        const roleKeys = [
          ...new Set(
            paths
              .filter((p) => {
                const s = p.split('.')
                return s[0] === 'contact' && s.length === 3
              })
              .map((p) => p.split('.')[1] as string)
          )
        ]
        for (const roleKey of roleKeys) {
          const matched = loadedContacts.find((c) => c.role && roleToTagKey(c.role) === roleKey)
          if (matched) initRoleIds[roleKey] = matched.uuid
        }
        setRoleContactIds(initRoleIds)

        setTagValues(
          hydrateAutoSelectedContactTags(initial, initPrimaryId, initRoleIds, loadedContacts)
        )
        setOpenTagSections({})
        setStep('tags')
        return
      }

      // Dry-run preview to get pre-filled tag values from dossier data
      const result = await previewDocument({
        dossierId: selectedDossierId,
        templateId: selectedTemplateId
      })

      if (!result.success) {
        setError(result.error || t('generate.previewError'))
        return
      }

      const paths = [
        ...new Set([...result.data.unresolvedTags, ...Object.keys(result.data.resolvedTags)])
      ]
      setTagPaths(paths)

      // Init tagValues from resolved values; empty string for unresolved
      const initial: Record<string, string> = {}
      for (const path of paths) {
        initial[path] = result.data.resolvedTags[path] ?? ''
      }

      // Auto-select primary contact: first contact, or one matching a contact.* tag
      const firstContact = loadedContacts[0]
      const initPrimaryId = firstContact?.uuid ?? ''
      setPrimaryContactId(initPrimaryId)

      // Auto-select role contacts based on contact role
      const initRoleIds: Record<string, string> = {}
      const roleKeys = [
        ...new Set(
          paths
            .filter((p) => {
              const s = p.split('.')
              return s[0] === 'contact' && s.length === 3
            })
            .map((p) => p.split('.')[1] as string)
        )
      ]
      for (const roleKey of roleKeys) {
        const matched = loadedContacts.find((c) => c.role && roleToTagKey(c.role) === roleKey)
        if (matched) initRoleIds[roleKey] = matched.uuid
      }
      setRoleContactIds(initRoleIds)

      setTagValues(
        hydrateAutoSelectedContactTags(initial, initPrimaryId, initRoleIds, loadedContacts)
      )
      setOpenTagSections({})
      setStep('tags')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleTagsNext(): Promise<void> {
    setError(null)
    setIsSubmitting(true)

    try {
      if (selectedTemplateUsesDocxSource) {
        // For docx templates, reload tag resolution from the .docx source directly —
        // the HTML snapshot may be stale and is not the source of truth.
        const contactRoleOverrides = Object.fromEntries(
          Object.entries(roleContactIds).filter(([, id]) => id)
        )
        const result = await previewDocxDocument({
          dossierId: selectedDossierId,
          templateId: selectedTemplateId,
          tagOverrides: tagValues,
          primaryContactId: primaryContactId || undefined,
          contactRoleOverrides: Object.keys(contactRoleOverrides).length
            ? contactRoleOverrides
            : undefined
        })

        if (!result.success) {
          setError(result.error || t('generate.previewError'))
          return
        }

        const unresolvedTags = result.data.tagPaths.filter((p) => !(p in result.data.resolvedTags))

        setReviewDraft({
          html: result.data.htmlPreview,
          filename: result.data.suggestedFilename,
          unresolvedTags,
          resolvedTags: result.data.resolvedTags
        })
        setDocxCustomOutputPath(null)
        setStep('save')
        return
      }

      const contactRoleOverrides = Object.fromEntries(
        Object.entries(roleContactIds).filter(([, id]) => id)
      )
      const result = await previewDocument({
        dossierId: selectedDossierId,
        templateId: selectedTemplateId,
        tagOverrides: tagValues,
        primaryContactId: primaryContactId || undefined,
        contactRoleOverrides: Object.keys(contactRoleOverrides).length
          ? contactRoleOverrides
          : undefined
      })

      if (!result.success) {
        setError(result.error || t('generate.previewError'))
        return
      }

      setReviewDraft({
        html: result.data.draftHtml,
        filename: result.data.suggestedFilename,
        unresolvedTags: result.data.unresolvedTags,
        resolvedTags: result.data.resolvedTags
      })
      setDocxCustomOutputPath(null)
      setStep('save')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSaveSelectOutputPath(): Promise<void> {
    const filename = reviewDraft?.filename ?? docxFilename
    const result = await selectOutputPath({ defaultFilename: filename })
    if (result.success && result.data) {
      setDocxCustomOutputPath(result.data)
    }
  }

  async function handleSave(): Promise<void> {
    if (!reviewDraft) return

    setError(null)
    setIsSubmitting(true)

    try {
      if (selectedTemplateUsesDocxSource) {
        // Use docxtemplater path — preserves Word formatting
        const contactRoleOverrides = Object.fromEntries(
          Object.entries(roleContactIds).filter(([, id]) => id)
        )
        const result = await generateDocument({
          dossierId: selectedDossierId,
          templateId: selectedTemplateId,
          tagOverrides: tagValues,
          primaryContactId: primaryContactId || undefined,
          contactRoleOverrides: Object.keys(contactRoleOverrides).length
            ? contactRoleOverrides
            : undefined,
          outputPath: docxCustomOutputPath ?? undefined,
          filename: docxCustomOutputPath ? undefined : reviewDraft.filename
        })

        if (!result.success) {
          setError(result.error || t('generate.saveError'))
          return
        }

        setSuccess({
          filename: getFilenameFromPath(result.data.outputPath),
          outputPath: result.data.outputPath
        })
      } else {
        // HTML → DOCX conversion path
        const result = await saveGeneratedDocument({
          dossierId: selectedDossierId,
          filename: reviewDraft.filename,
          format: 'docx',
          html: reviewDraft.html,
          outputPath: docxCustomOutputPath ?? undefined
        })

        if (!result.success) {
          setError(result.error || t('generate.saveError'))
          return
        }

        setSuccess({
          filename: getFilenameFromPath(result.data.outputPath),
          outputPath: result.data.outputPath
        })
      }

      setStep('setup')
      setReviewDraft(null)
      setDocxFilename('')
      setDocxCustomOutputPath(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Derived: which tag paths are contact tags
  const primaryTagPaths = tagPaths.filter((p) => {
    const s = p.split('.')
    return s[0] === 'contact' && s.length === 2
  })
  const roleTagGroups = (() => {
    const map: Record<string, string[]> = {}
    for (const p of tagPaths) {
      const s = p.split('.')
      if (s[0] === 'contact' && s.length === 3) {
        const roleKey = s[1] as string
        ;(map[roleKey] ??= []).push(p)
      }
    }
    return map
  })()
  const keyDateBasePaths = tagPaths.filter((p) => {
    const s = p.split('.')
    return s[0] === 'dossier' && s[1] === 'keyDate' && s.length === 3
  })
  // If a template only uses a variant (e.g. dossier.keyDate.audienceDate.long) without the base
  // path, surface the base path so the user can still fill in the date.
  const variantOnlyBasePaths = tagPaths
    .filter((p) => {
      const s = p.split('.')
      return s[0] === 'dossier' && s[1] === 'keyDate' && s.length === 4
    })
    .map((p) => p.split('.').slice(0, 3).join('.'))
    .filter((bp) => !keyDateBasePaths.includes(bp))
  const keyDatePaths = [...new Set([...keyDateBasePaths, ...variantOnlyBasePaths])]
  const keyRefPaths = tagPaths.filter((p) => {
    const s = p.split('.')
    return s[0] === 'dossier' && s[1] === 'keyRef' && s.length === 3
  })
  const otherTagPaths = tagPaths.filter((p) => {
    const s = p.split('.')
    return (
      !(s[0] === 'contact') && !(s[0] === 'dossier' && (s[1] === 'keyDate' || s[1] === 'keyRef'))
    )
  })

  const otherAddressPaths = otherTagPaths.filter((p) => {
    const entry = templateRoutineCatalog.find(
      (e) =>
        e.tag.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '') === p ||
        e.tagFr?.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '') === p
    )
    return entry?.subGroup === 'address'
  })
  const otherNonAddressPaths = otherTagPaths.filter((p) => !otherAddressPaths.includes(p))

  const filteredSortedTemplates = useMemo(() => {
    const needle = templateFilter.trim().toLowerCase()
    const filtered = needle
      ? templates.filter(
          (tmpl) =>
            tmpl.name.toLowerCase().includes(needle) ||
            (tmpl.description ?? '').toLowerCase().includes(needle)
        )
      : templates
    return [...filtered].sort((a, b) =>
      templateSort === 'name-desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
    )
  }, [templates, templateFilter, templateSort])

  const filteredSortedDossiers = useMemo(() => {
    const needle = dossierFilter.trim().toLowerCase()
    const filtered = needle
      ? dossiers.filter(
          (d) =>
            d.name.toLowerCase().includes(needle) || (d.type ?? '').toLowerCase().includes(needle)
        )
      : dossiers
    return [...filtered].sort((a, b) => {
      if (dossierSort === 'name-desc') return b.name.localeCompare(a.name)
      if (dossierSort === 'next-date') {
        if (!a.nextUpcomingKeyDate && !b.nextUpcomingKeyDate) return 0
        if (!a.nextUpcomingKeyDate) return 1
        if (!b.nextUpcomingKeyDate) return -1
        return a.nextUpcomingKeyDate.localeCompare(b.nextUpcomingKeyDate)
      }
      return a.name.localeCompare(b.name)
    })
  }, [dossiers, dossierFilter, dossierSort])

  const inputClass =
    'w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-slate-100 outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35'

  return (
    <div className="ord-glass-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl p-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-7">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
            {t('generate.title')}
          </p>
          <p className="text-sm text-slate-400">
            {step === 'setup'
              ? t('generate.setupDescription')
              : step === 'tags'
                ? t('generate.tagsDescription')
                : t('generate.reviewDescription')}
          </p>
        </div>
        <div className="flex gap-2">
          {step === 'tags' ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep('setup')}>
              {t('generate.backToSetup')}
            </Button>
          ) : null}
          {step === 'save' ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep('tags')}>
              {t('generate.backToTags')}
            </Button>
          ) : null}
          {onBack ? (
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>
              {t('templates.workspace.backToLibrary')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Success */}
      {success ? (
        <div
          role="status"
          className="flex shrink-0 items-start justify-between gap-4 rounded-xl border border-emerald-300/35 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100 mb-5"
        >
          <div>
            <p>{t('generate.toast.success', { filename: success.filename })}</p>
            <p className="mt-1 break-all font-mono text-xs text-emerald-50/90">
              {success.outputPath}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 border border-emerald-300/30 text-emerald-100 hover:bg-emerald-300/15"
            onClick={() => void openGeneratedFile(success.outputPath)}
          >
            {t('generate.openFile')}
          </Button>
        </div>
      ) : null}

      {/* Error */}
      {error ? (
        <div className="shrink-0 rounded-xl border border-rose-300/35 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {/* Setup step */}
      {step === 'setup' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Two-column layout */}
          <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
            {/* Left: Templates */}
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-medium text-slate-100">
                  {t('generate.templateLabel')}
                </span>
                <input
                  type="search"
                  value={templateFilter}
                  onChange={(e) => setTemplateFilter(e.target.value)}
                  placeholder={t('templates.list.searchPlaceholder')}
                  className="ml-auto w-36 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-aurora/45 focus:ring-1 focus:ring-aurora/25"
                />
                <select
                  value={templateSort}
                  onChange={(e) => setTemplateSort(e.target.value as 'name-asc' | 'name-desc')}
                  className="rounded-xl border border-white/10 bg-slate-950/60 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-aurora/45"
                >
                  <option value="name-asc">{t('templates.list.sortNameAsc')}</option>
                  <option value="name-desc">{t('templates.list.sortNameDesc')}</option>
                </select>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {filteredSortedTemplates.length === 0 ? (
                  <div className="flex items-center justify-center rounded-2xl border border-dashed border-white/12 bg-slate-950/20 py-8 text-sm text-slate-400">
                    {t('generate.noDossiers')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredSortedTemplates.map((template) => {
                      const isSelected = template.id === selectedTemplateId
                      return (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => setSelectedTemplateId(template.id)}
                          className={cn(
                            'w-full flex flex-col gap-1 rounded-2xl border p-3.5 text-left transition',
                            isSelected
                              ? 'border-aurora/50 bg-aurora/5 shadow-[0_0_0_1px_rgba(34,211,238,0.2)]'
                              : 'border-white/10 bg-slate-950/35 hover:border-white/20 hover:bg-slate-950/50'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-50">
                              {template.name}
                            </span>
                            {template.hasDocxSource ? (
                              <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-emerald-200">
                                {t('templates.list.docxBadge')}
                              </span>
                            ) : null}
                          </div>
                          {template.description ? (
                            <p className="truncate text-xs text-slate-400">
                              {template.description}
                            </p>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="w-px shrink-0 bg-white/8" />

            {/* Right: Dossiers */}
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-medium text-slate-100">
                  {t('generate.dossierLabel')}
                </span>
                <input
                  type="search"
                  value={dossierFilter}
                  onChange={(e) => setDossierFilter(e.target.value)}
                  placeholder={t('generate.dossierFilterPlaceholder')}
                  className="ml-auto w-36 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-aurora/45 focus:ring-1 focus:ring-aurora/25"
                />
                <select
                  value={dossierSort}
                  onChange={(e) =>
                    setDossierSort(e.target.value as 'name-asc' | 'name-desc' | 'next-date')
                  }
                  className="rounded-xl border border-white/10 bg-slate-950/60 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-aurora/45"
                >
                  <option value="name-asc">{t('templates.list.sortNameAsc')}</option>
                  <option value="name-desc">{t('templates.list.sortNameDesc')}</option>
                  <option value="next-date">{t('dossiers.sort_next_key_date')}</option>
                </select>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {filteredSortedDossiers.length === 0 ? (
                  <div className="flex items-center justify-center rounded-2xl border border-dashed border-white/12 bg-slate-950/20 py-8 text-sm text-slate-400">
                    {t('generate.noDossiers')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredSortedDossiers.map((dossier) => {
                      const isSelected = dossier.id === selectedDossierId
                      return (
                        <button
                          key={dossier.id}
                          type="button"
                          onClick={() => setSelectedDossierId(dossier.id)}
                          className={cn(
                            'w-full flex flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition',
                            isSelected
                              ? 'border-aurora/50 bg-aurora/5 shadow-[0_0_0_1px_rgba(34,211,238,0.2)]'
                              : 'border-white/10 bg-slate-950/35 hover:border-white/20 hover:bg-slate-950/50'
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className="truncate text-sm font-semibold leading-snug text-slate-50"
                              title={dossier.name}
                            >
                              {dossier.name}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
                                statusBadgeClasses[dossier.status]
                              )}
                            >
                              {t(`dossiers.status_${dossier.status}`)}
                            </span>
                          </div>
                          {dossier.type ? (
                            <span className="truncate text-xs text-slate-400">{dossier.type}</span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 pt-4">
            {onBack ? (
              <Button type="button" variant="ghost" onClick={onBack}>
                {t('templates.editor.cancelButton')}
              </Button>
            ) : null}
            <Button onClick={() => void handleSetupNext()} disabled={!canSubmitSetup}>
              {isSubmitting ? t('generate.buttonLoading') : t('generate.nextButton')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Tags step */}
      {step === 'tags'
        ? (() => {
            // Compute completion stats using all displayed paths (including synthesized keyDate base paths)
            const allDisplayedPaths = [
              ...primaryTagPaths,
              ...Object.values(roleTagGroups).flat(),
              ...keyDatePaths,
              ...keyRefPaths,
              ...otherTagPaths
            ]
            const filledCount = allDisplayedPaths.filter(
              (p) => (tagValues[p] ?? '').trim() !== ''
            ).length
            const totalCount = allDisplayedPaths.length
            const allFilled = filledCount === totalCount
            const progressPct =
              totalCount === 0 ? 100 : Math.round((filledCount / totalCount) * 100)

            // Helper: count empty paths
            const emptyCount = (paths: string[]): number =>
              paths.filter((p) => (tagValues[p] ?? '').trim() === '').length

            // Toggle a collapsible section
            const toggleSection = (key: string, defaultOpen: boolean): void =>
              setOpenTagSections((prev) => ({ ...prev, [key]: !(prev[key] ?? defaultOpen) }))

            const isSectionOpen = (key: string, defaultOpen: boolean): boolean =>
              openTagSections[key] ?? defaultOpen

            // Reusable field grid component
            const renderFieldGrid = (paths: string[]): React.JSX.Element => (
              <div className="grid gap-3 md:grid-cols-2">
                {paths.map((path) => {
                  const isEmpty = (tagValues[path] ?? '').trim() === ''
                  return (
                    <label key={path} className="flex flex-col gap-1 text-sm text-slate-100">
                      <span className="text-xs text-slate-400">{localizeTagPath(path)}</span>
                      <input
                        type="text"
                        value={tagValues[path] ?? ''}
                        onChange={(event) =>
                          setTagValues((current) => ({ ...current, [path]: event.target.value }))
                        }
                        className={
                          inputClass +
                          (isEmpty
                            ? ' border-amber-500/40 focus:border-amber-400 focus:ring-amber-400/30'
                            : '')
                        }
                        placeholder={t('generate.tags.emptyPlaceholder')}
                      />
                    </label>
                  )
                })}
              </div>
            )

            // Reusable section header
            const SectionHeader = ({
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
                  <span className="text-sm font-medium text-slate-100">{title}</span>
                  <div className="flex items-center gap-2">
                    {empty > 0 ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        {empty}{' '}
                        {t(
                          'generate.tags.toFill',
                          i18n.language === 'fr' ? 'à compléter' : 'to fill'
                        )}
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        ✓
                      </span>
                    )}
                    <svg
                      className={`size-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
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

            // Contact row: compact role → assigned contact
            const ContactRow = ({
              roleLabel,
              contactId,
              paths,
              onContactChange
            }: {
              roleLabel: string
              contactId: string
              paths: string[]
              onContactChange: (id: string) => void
            }): React.JSX.Element => {
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
                  {/* Role + contact assignment row */}
                  <div className="flex items-center gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-aurora/20 text-[10px] font-bold text-aurora">
                        {initials}
                      </div>
                      <span className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-slate-400">
                        {roleLabel}
                      </span>
                    </div>
                    {dossierContacts.length > 0 ? (
                      <select
                        value={contactId}
                        onChange={(e) => onContactChange(e.target.value)}
                        className="min-w-0 flex-[2] rounded-xl border border-white/10 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
                      >
                        <option value="">{t('generate.contactMapping.no_match')}</option>
                        {dossierContacts.map((c) => {
                          const displayName = computeContactDisplayName(c)
                          return (
                            <option key={c.uuid} value={c.uuid}>
                              {displayName} ({c.role})
                            </option>
                          )
                        })}
                      </select>
                    ) : null}
                    {paths.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleSection(sectionKey, empty > 0)}
                        className="shrink-0 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition"
                      >
                        {empty > 0 ? (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                            {empty}
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
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

                  {/* Fields — only shown when expanded */}
                  {showFields && paths.length > 0 ? (
                    <div className="ml-9 rounded-xl border border-white/5 bg-slate-950/40 p-3">
                      {renderFieldGrid(paths)}
                    </div>
                  ) : null}
                </div>
              )
            }

            const hasContactSection =
              (primaryTagPaths.length > 0 && dossierContacts.length > 0) ||
              Object.keys(roleTagGroups).length > 0

            return (
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                {/* Progress bar */}
                {totalCount > 0 ? (
                  <div className="shrink-0 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs text-slate-400">
                        {allFilled
                          ? i18n.language === 'fr'
                            ? 'Tous les tags sont prêts'
                            : 'All tags are ready'
                          : i18n.language === 'fr'
                            ? `${filledCount} / ${totalCount} tags remplis`
                            : `${filledCount} / ${totalCount} tags filled`}
                      </span>
                      <span
                        className={`text-xs font-medium ${allFilled ? 'text-emerald-400' : 'text-amber-400'}`}
                      >
                        {progressPct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${allFilled ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
                  {/* Contacts section — merged primary + role groups */}
                  {hasContactSection ? (
                    <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-100">
                          {i18n.language === 'fr' ? 'Contacts' : 'Contacts'}
                        </p>
                        <p className="text-xs text-slate-500">{t('generate.tags.selectContact')}</p>
                      </div>

                      <div className="space-y-4 divide-y divide-white/5">
                        {primaryTagPaths.length > 0 && dossierContacts.length > 0 ? (
                          <div className="pt-0">
                            <ContactRow
                              roleLabel={t('generate.tags.primaryContactTitle')}
                              contactId={primaryContactId}
                              paths={primaryTagPaths}
                              onContactChange={(id) => {
                                setPrimaryContactId(id)
                                setTagValues((current) => applyPrimaryContact(id, current))
                              }}
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
                              className={
                                idx === 0 && primaryTagPaths.length === 0 ? 'pt-0' : 'pt-4'
                              }
                            >
                              <ContactRow
                                roleLabel={roleDisplayLabel}
                                contactId={roleContactIds[roleKey] ?? ''}
                                paths={paths}
                                onContactChange={(id) => {
                                  setRoleContactIds((current) => ({ ...current, [roleKey]: id }))
                                  setTagValues((current) => applyRoleContact(roleKey, id, current))
                                }}
                              />
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  ) : null}

                  {/* KeyDate tags */}
                  {keyDatePaths.length > 0
                    ? (() => {
                        const open = isSectionOpen('keyDates', emptyCount(keyDatePaths) > 0)
                        return (
                          <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 space-y-4">
                            <SectionHeader
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
                                    inputClass +
                                    (isEmpty
                                      ? ' border-amber-500/40 focus:border-amber-400 focus:ring-amber-400/30'
                                      : '')
                                  const formatHint = locale.startsWith('fr')
                                    ? 'JJ/MM/AAAA ou AAAA-MM-JJ'
                                    : 'DD/MM/YYYY or YYYY-MM-DD'
                                  return (
                                    <div
                                      key={path}
                                      className="flex flex-col gap-1 text-sm text-slate-100"
                                    >
                                      <span className="text-xs text-slate-400">
                                        {localizeTagPath(path)}
                                      </span>
                                      <ComboField
                                        value={value}
                                        onChange={(v) =>
                                          setTagValues((current) =>
                                            applyKeyDateOverride(path, v, locale, current)
                                          )
                                        }
                                        options={keyDateOptions}
                                        placeholder={formatHint}
                                        inputClassName={fieldClass}
                                      />
                                      {value && !isValidDate ? (
                                        <span className="text-xs text-amber-400">{formatHint}</span>
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

                  {/* KeyRef tags */}
                  {keyRefPaths.length > 0
                    ? (() => {
                        const open = isSectionOpen('keyRefs', emptyCount(keyRefPaths) > 0)
                        return (
                          <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 space-y-4">
                            <SectionHeader
                              sectionKey="keyRefs"
                              title={t('generate.tags.keyRefsTitle')}
                              paths={keyRefPaths}
                              defaultOpen={emptyCount(keyRefPaths) > 0}
                            />
                            {open ? (
                              <div className="grid gap-3 md:grid-cols-2">
                                {keyRefPaths.map((path) => {
                                  const isEmpty = (tagValues[path] ?? '').trim() === ''
                                  const fieldClass =
                                    inputClass +
                                    (isEmpty
                                      ? ' border-amber-500/40 focus:border-amber-400 focus:ring-amber-400/30'
                                      : '')
                                  return (
                                    <div
                                      key={path}
                                      className="flex flex-col gap-1 text-sm text-slate-100"
                                    >
                                      <span className="text-xs text-slate-400">
                                        {localizeTagPath(path)}
                                      </span>
                                      <ComboField
                                        value={tagValues[path] ?? ''}
                                        onChange={(v) =>
                                          setTagValues((current) => ({ ...current, [path]: v }))
                                        }
                                        options={keyReferenceOptions}
                                        placeholder={t('generate.tags.emptyPlaceholder')}
                                        inputClassName={fieldClass}
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            ) : null}
                          </section>
                        )
                      })()
                    : null}

                  {/* Other tags (entity, system, etc.) — collapsed by default if all filled */}
                  {otherTagPaths.length > 0
                    ? (() => {
                        const open = isSectionOpen('otherTags', emptyCount(otherTagPaths) > 0)
                        return (
                          <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 space-y-4">
                            <SectionHeader
                              sectionKey="otherTags"
                              title={t('generate.tags.otherTagsTitle')}
                              paths={otherTagPaths}
                              defaultOpen={emptyCount(otherTagPaths) > 0}
                            />
                            {open ? (
                              <div className="space-y-4">
                                {otherNonAddressPaths.length > 0
                                  ? renderFieldGrid(otherNonAddressPaths)
                                  : null}
                                {otherAddressPaths.length > 0 ? (
                                  <div className="space-y-3">
                                    <p className="text-xs font-medium text-slate-400">
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
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/20 px-4 py-8 text-center text-sm text-slate-400">
                      {t('generate.tags.noTags')}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 pt-4">
                  <Button type="button" variant="ghost" onClick={() => setStep('setup')}>
                    {t('templates.editor.cancelButton')}
                  </Button>
                  <Button onClick={() => void handleTagsNext()} disabled={isSubmitting}>
                    {isSubmitting ? t('generate.buttonLoading') : t('generate.reviewButton')}
                  </Button>
                </div>
              </div>
            )
          })()
        : null}

      {/* Save step — unified for both rich-text and Word templates */}
      {step === 'save' && reviewDraft ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Top controls: filename + path */}
          <div className="shrink-0 space-y-4">
            <label className="flex flex-col gap-2 text-sm text-slate-100" htmlFor="save-filename">
              <span>{t('generate.filenameLabel')}</span>
              <input
                id="save-filename"
                type="text"
                value={reviewDraft.filename}
                onChange={(event) =>
                  setReviewDraft((current) =>
                    current ? { ...current, filename: event.target.value } : current
                  )
                }
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
            </label>

            {/* Output path */}
            <section className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 space-y-3">
              <p className="text-sm font-medium text-slate-100">
                {t('generate.docxSave.outputPathTitle')}
              </p>

              <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-200">
                <input
                  type="radio"
                  name="save-output-path"
                  checked={docxCustomOutputPath === null}
                  onChange={() => setDocxCustomOutputPath(null)}
                  className="accent-aurora"
                />
                {t('generate.docxSave.saveToDossier')}
              </label>

              <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-200">
                <input
                  type="radio"
                  name="save-output-path"
                  checked={docxCustomOutputPath !== null}
                  onChange={() => void handleSaveSelectOutputPath()}
                  className="accent-aurora"
                />
                {t('generate.docxSave.saveToCustomPath')}
              </label>

              {docxCustomOutputPath !== null ? (
                <div className="flex items-center gap-3 pl-6">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-300">
                    {docxCustomOutputPath}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleSaveSelectOutputPath()}
                  >
                    {t('generate.docxSave.browsePath')}
                  </Button>
                </div>
              ) : null}
            </section>

            {/* Unresolved tags warning */}
            {reviewDraft.unresolvedTags.length > 0 ? (
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/5 px-4 py-3">
                <p className="text-sm font-medium text-amber-100">
                  {t('generate.unresolvedTitle')}
                </p>
                <p className="mt-1 text-sm text-amber-200/70">{t('generate.unresolvedTagHint')}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {reviewDraft.unresolvedTags.map((tagPath) => (
                    <li
                      key={tagPath}
                      className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-100"
                    >
                      {tagPath}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* Read-only preview */}
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10">
            <RichTextEditor
              ariaLabel={t('generate.reviewEditorLabel')}
              value={reviewDraft.html}
              onChange={() => {}}
              documentPreview
            />
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center justify-between border-t border-white/10 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const html = reviewDraft.html
                const plain = (() => {
                  const div = document.createElement('div')
                  div.innerHTML = html
                  return div.innerText
                })()
                void navigator.clipboard
                  .write([
                    new ClipboardItem({
                      'text/html': new Blob([html], { type: 'text/html' }),
                      'text/plain': new Blob([plain], { type: 'text/plain' })
                    })
                  ])
                  .then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  })
              }}
            >
              {copied ? t('generate.copiedButton') : t('generate.copyButton')}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep('tags')}>
                {t('templates.editor.cancelButton')}
              </Button>
              <Button onClick={() => void handleSave()} disabled={!canSave}>
                {isSubmitting ? t('generate.saveLoading') : t('generate.saveButton')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
