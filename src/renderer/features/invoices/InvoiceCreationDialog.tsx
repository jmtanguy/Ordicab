import { useEffect, useMemo, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import type { DossierBillingItem } from '@shared/types'
import { previewInvoiceNumber } from '@shared/domain/invoiceNumbering'
import { normalizeManagedFieldsConfig } from '@shared/managedFields'

import { Button, DialogShell, Field, Input, Select } from '@renderer/components/ui'
import { useInvoiceStore } from '@renderer/stores/invoiceStore'
import { useTemplateStore } from '@renderer/stores/templateStore'
import { useContactStore, useDossierStore, useEntityStore } from '@renderer/stores'
import { getOrdicabApi } from '@renderer/stores/ipc'

import { roleToTagKey } from '../dossiers/rolePresets'
import { TagFillingStep } from '../templates/generateDocument/TagFillingStep'
import { type ComboOption } from '../templates/generateDocument/ComboField'
import { hydrateAutoSelectedContactTags } from '../templates/generateDocument/tagFillingHelpers'
import { buildKeyDateOptions } from '../templates/generateDocument/tagValueHelpers'

interface InvoiceCreationDialogProps {
  dossierId: string
  selectedItems: DossierBillingItem[]
  onClose: () => void
  onCreated: (invoiceId: string) => void
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

export function InvoiceCreationDialog({
  dossierId,
  selectedItems,
  onClose,
  onCreated
}: InvoiceCreationDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const templates = useTemplateStore((s) => s.templates)
  const loadTemplates = useTemplateStore((s) => s.load)
  const settings = useInvoiceStore((s) => s.settings)
  const loadSettings = useInvoiceStore((s) => s.loadSettings)
  const create = useInvoiceStore((s) => s.create)
  const storeError = useInvoiceStore((s) => s.error)
  const loadDetail = useDossierStore((s) => s.loadDetail)
  const loadContacts = useContactStore((s) => s.load)
  const contactsByDossierId = useContactStore((s) => s.contactsByDossierId)
  const profile = useEntityStore((s) => s.profile)

  // Show templates explicitly marked for invoices AND generic ("document"/unmarked)
  // templates — those act as legacy/all-purpose templates the user can use here.
  const templatesForKind = useMemo(
    () =>
      templates.filter((tpl) => {
        const kind = tpl.documentKind ?? 'document'
        return kind === 'invoice' || kind === 'document'
      }),
    [templates]
  )

  const [templateId, setTemplateId] = useState<string>('')
  const [rememberDefault, setRememberDefault] = useState(false)
  const [issuedAt, setIssuedAt] = useState<string>(new Date().toISOString().slice(0, 10))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingTags, setIsLoadingTags] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Tags state
  const [tagPaths, setTagPaths] = useState<string[]>([])
  const [tagValues, setTagValues] = useState<Record<string, string>>({})
  const [primaryContactId, setPrimaryContactId] = useState('')
  const [roleContactIds, setRoleContactIds] = useState<Record<string, string>>({})
  const [keyDateOptions, setKeyDateOptions] = useState<ComboOption[]>([])

  const managedFieldsConfig = useMemo(
    () => normalizeManagedFieldsConfig(profile?.managedFields),
    [profile?.managedFields]
  )

  useEffect(() => {
    void loadTemplates()
    void loadSettings()
    void loadContacts({ dossierId })
    void loadDetail(dossierId).then(() => {
      const detail = useDossierStore.getState().activeDossier
      if (detail?.id === dossierId) {
        setKeyDateOptions(buildKeyDateOptions(detail, 'fr'))
      }
    })
  }, [loadTemplates, loadSettings, loadContacts, loadDetail, dossierId])

  useEffect(() => {
    if (templateId) return
    const defaultId = settings?.defaultTemplateId
    if (defaultId && templatesForKind.some((t) => t.id === defaultId)) {
      setTemplateId(defaultId)
    } else if (templatesForKind.length > 0 && templatesForKind[0]) {
      setTemplateId(templatesForKind[0].id)
    }
  }, [templateId, settings?.defaultTemplateId, templatesForKind])

  const totals = useMemo(() => {
    const totalHt = selectedItems.reduce((acc, item) => acc + item.totalHtCents, 0)
    const totalTtc = selectedItems.reduce((acc, item) => acc + item.totalTtcCents, 0)
    return { totalHt, totalTtc }
  }, [selectedItems])

  const previewNumber = useMemo(() => {
    if (!settings || !issuedAt) return null
    try {
      return previewInvoiceNumber(settings, new Date(`${issuedAt}T12:00:00`))
    } catch {
      return null
    }
  }, [settings, issuedAt])

  const dossierContacts = contactsByDossierId[dossierId] ?? []
  const selectedTemplate = templatesForKind.find((t) => t.id === templateId)
  const templateUsesDocxSource = selectedTemplate?.hasDocxSource === true

  // Eagerly fetch tag paths whenever the docx template, date, or items change so that
  // the entire dialog stays on a single screen rather than splitting into a wizard.
  const billingItemIdsKey = useMemo(
    () => selectedItems.map((item) => item.id).join('|'),
    [selectedItems]
  )
  const previewSeqRef = useRef(0)
  useEffect(() => {
    if (!templateUsesDocxSource || !templateId) {
      setTagPaths([])
      setTagValues({})
      setPrimaryContactId('')
      setRoleContactIds({})
      return
    }

    const seq = ++previewSeqRef.current
    setIsLoadingTags(true)
    void (async () => {
      try {
        await Promise.all([loadContacts({ dossierId }), loadDetail(dossierId)])
        if (seq !== previewSeqRef.current) return
        const loadedContacts = useContactStore.getState().contactsByDossierId[dossierId] ?? []
        const detail = useDossierStore.getState().activeDossier
        if (detail?.id === dossierId) {
          setKeyDateOptions(buildKeyDateOptions(detail, 'fr'))
        }

        const api = getOrdicabApi()
        if (!api) {
          setLocalError('API indisponible.')
          return
        }
        const result = await api.generate.previewInvoiceDocx({
          dossierId,
          templateId,
          billingItemIds: selectedItems.map((item) => item.id),
          issuedAt
        })
        if (seq !== previewSeqRef.current) return
        if (!result.success) {
          setLocalError(result.error || 'Aperçu impossible.')
          return
        }

        const paths = result.data.tagPaths
        const initial: Record<string, string> = {}
        for (const path of paths) {
          initial[path] = result.data.resolvedTags[path] ?? ''
        }

        const firstContact = loadedContacts[0]
        const initPrimaryId = primaryContactId || firstContact?.uuid || ''

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
        const initRoleIds: Record<string, string> = { ...roleContactIds }
        for (const roleKey of roleKeys) {
          if (initRoleIds[roleKey]) continue
          const matched = loadedContacts.find((c) => c.role && roleToTagKey(c.role) === roleKey)
          if (matched) initRoleIds[roleKey] = matched.uuid
        }

        setTagPaths(paths)
        setPrimaryContactId(initPrimaryId)
        setRoleContactIds(initRoleIds)
        setTagValues((prev) =>
          hydrateAutoSelectedContactTags(
            // Preserve user-edited values for paths that already had a non-empty value.
            paths.reduce<Record<string, string>>((acc, path) => {
              const existing = prev[path]
              acc[path] = existing && existing !== '' ? existing : (initial[path] ?? '')
              return acc
            }, {}),
            initPrimaryId,
            initRoleIds,
            loadedContacts,
            managedFieldsConfig
          )
        )
        setLocalError(null)
      } finally {
        if (seq === previewSeqRef.current) setIsLoadingTags(false)
      }
    })()
    // We intentionally exclude tagValues/primary/role state from deps to avoid refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    templateUsesDocxSource,
    templateId,
    dossierId,
    billingItemIdsKey,
    issuedAt,
    loadContacts,
    loadDetail,
    managedFieldsConfig
  ])

  async function submit(): Promise<void> {
    if (!templateId) {
      setLocalError('Sélectionnez un modèle.')
      return
    }
    setLocalError(null)
    setIsSubmitting(true)

    const extra: {
      tagOverrides?: Record<string, string>
      primaryContactId?: string
      contactRoleOverrides?: Record<string, string>
    } = {}

    if (templateUsesDocxSource) {
      const contactRoleOverrides = Object.fromEntries(
        Object.entries(roleContactIds).filter(([, id]) => id)
      )
      extra.tagOverrides = tagValues
      extra.primaryContactId = primaryContactId || undefined
      extra.contactRoleOverrides = Object.keys(contactRoleOverrides).length
        ? contactRoleOverrides
        : undefined
    }

    const created = await create({
      dossierId,
      billingItemIds: selectedItems.map((item) => item.id),
      templateId,
      issuedAt,
      rememberTemplateAsDefault: rememberDefault,
      ...extra
    })
    setIsSubmitting(false)
    if (created) {
      await loadDetail(dossierId)
      onCreated(created.id)
      onClose()
    }
  }

  return (
    <DialogShell onDismiss={onClose} size="lg">
      <div className="flex max-h-[85vh] flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#1a1a1a]">
              {t('invoices.creation_dialog_title', { defaultValue: 'Générer une facture' })}
            </h2>
            <p className="text-xs text-[#8a8a85]">
              {t('invoices.creation_dialog_subtitle', {
                count: selectedItems.length,
                total: formatCents(totals.totalTtc),
                defaultValue: '{{count}} prestation(s) — Total TTC {{total}}'
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[#8a8a85] hover:text-[#1a1a1a]"
          >
            ✕
          </button>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
            <section className="rounded-md border border-[#e5e3da] bg-[#fbf9f4] p-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-widest text-[#8a8a85]">
                {t('invoices.creation_selected_items_label', {
                  defaultValue: 'Prestations sélectionnées'
                })}
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                {selectedItems.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3">
                    <span className="truncate">
                      <span className="tabular-nums text-[#8a8a85]">{item.date}</span> ·{' '}
                      {item.label}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatCents(item.totalTtcCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex justify-between border-t border-[#e5e3da] pt-2 text-sm font-medium">
                <span>{t('invoices.creation_total_ht', { defaultValue: 'Total HT' })}</span>
                <span className="tabular-nums">{formatCents(totals.totalHt)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span>{t('invoices.creation_total_ttc', { defaultValue: 'Total TTC' })}</span>
                <span className="tabular-nums">{formatCents(totals.totalTtc)}</span>
              </div>
            </section>

            <Field label="Modèle de facture">
              <Select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={templatesForKind.length === 0}
              >
                {templatesForKind.length === 0 ? (
                  <option value="">
                    {t('invoices.creation_no_template_option', {
                      defaultValue: '— Aucun modèle de facture —'
                    })}
                  </option>
                ) : (
                  templatesForKind.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))
                )}
              </Select>
              {templatesForKind.length === 0 ? (
                <p className="mt-1 text-xs text-amber-700">
                  {t('invoices.creation_no_template_hint', {
                    defaultValue:
                      'Aucun modèle de facture configuré. Créez-en un dans la section Modèles ou importez « Facture — Standard » depuis la bibliothèque.'
                  })}
                </p>
              ) : null}
              <label className="mt-1 flex items-center gap-2 text-xs text-[#5c5c5a]">
                <input
                  type="checkbox"
                  checked={rememberDefault}
                  onChange={(e) => setRememberDefault(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-aurora"
                />
                {t('invoices.creation_remember_default', {
                  defaultValue: 'Mémoriser ce modèle comme défaut'
                })}
              </label>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date d'émission">
                <Input
                  type="date"
                  value={issuedAt}
                  onChange={(e) => setIssuedAt(e.target.value)}
                  required
                />
              </Field>
              <Field label="Numéro attribué (aperçu)">
                <Input value={previewNumber ?? '—'} readOnly />
              </Field>
            </div>

            {templateUsesDocxSource ? (
              isLoadingTags && tagPaths.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#e5e3da] bg-white px-4 py-8 text-center text-sm text-[#5c5c5a]">
                  {t('invoices.creation_loading_tags', {
                    defaultValue: 'Chargement des tags du modèle…'
                  })}
                </div>
              ) : (
                <TagFillingStep
                  tagPaths={tagPaths}
                  tagValues={tagValues}
                  onTagValuesChange={setTagValues}
                  primaryContactId={primaryContactId}
                  onPrimaryContactChange={setPrimaryContactId}
                  roleContactIds={roleContactIds}
                  onRoleContactIdsChange={setRoleContactIds}
                  dossierContacts={dossierContacts}
                  keyDateOptions={keyDateOptions}
                  managedFieldsConfig={managedFieldsConfig}
                />
              )
            ) : null}
          </div>

          {(localError || storeError) && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {localError ?? storeError}
            </p>
          )}

          <footer className="flex justify-end gap-2 border-t border-[#e5e3da] pt-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel', { defaultValue: 'Annuler' })}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !templateId || (templateUsesDocxSource && isLoadingTags)}
            >
              {isSubmitting ? 'Génération…' : 'Générer la facture'}
            </Button>
          </footer>
        </form>
      </div>
    </DialogShell>
  )
}
