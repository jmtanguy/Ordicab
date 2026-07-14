import { useEffect, useMemo, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import type { DossierBillingItem } from '@shared/types'
import { computeDueDateIso } from '@shared/domain/invoice'
import { previewInvoiceNumber } from '@shared/domain/invoiceNumbering'
import { normalizeManagedFieldsConfig } from '@shared/managedFields'
import { normalizeTagPath } from '@shared/templateContent'

import { Button, DialogShell, Field, Input, Select } from '@renderer/components/ui'
import { formatEurosFromCents } from '@renderer/lib/billingFormatters'
import { useInvoiceStore } from '@renderer/stores/invoiceStore'
import { useTemplateStore } from '@renderer/stores/templateStore'
import { useContactStore, useDossierStore, useEntityStore } from '@renderer/stores'
import { getOrdicabApi } from '@renderer/stores/ipc'

import { roleToTagKey } from '../dossiers/rolePresets'
import { TagFillingStep } from '../templates/generateDocument/TagFillingStep'
import { type ComboOption } from '../templates/generateDocument/ComboField'
import {
  computeTagProvenance,
  hydrateAutoSelectedContactTags,
  type TagProvenance
} from '../templates/generateDocument/tagFillingHelpers'
import { buildKeyDateOptions } from '../templates/generateDocument/tagValueHelpers'

/**
 * Tags renseignés automatiquement par le module facture (numéro consommé à la création,
 * échéance pilotée par le champ « Échéance ») : leurs valeurs suivent toujours l'aperçu
 * le plus récent et sont ignorées côté création.
 */
const AUTO_RESOLVED_TAG_PATHS = new Set([
  'facture.numero',
  'facture.dateEmission',
  'facture.dateEcheance',
  // EN canonical aliases, kept for robustness — paths circulate in FR.
  'invoice.number',
  'invoice.issuedAt',
  'invoice.dueAt'
])

interface InvoiceCreationDialogProps {
  dossierId: string
  selectedItems: DossierBillingItem[]
  onClose: () => void
  onCreated: (invoiceUuid: string) => void
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

  const [templateUuid, setTemplateId] = useState<string>('')
  const [rememberDefault, setRememberDefault] = useState(false)
  const [issuedAt, setIssuedAt] = useState<string>(new Date().toISOString().slice(0, 10))
  const [dueAt, setDueAt] = useState<string>('')
  // Tant que l'utilisateur n'a pas touché l'échéance, elle suit émission + délai standard.
  const dueAtTouchedRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingTags, setIsLoadingTags] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Tags state
  const [tagPaths, setTagPaths] = useState<string[]>([])
  const [tagValues, setTagValues] = useState<Record<string, string>>({})
  const [tagProvenance, setTagProvenance] = useState<Record<string, TagProvenance>>({})
  const [primaryContactUuid, setPrimaryContactId] = useState('')
  const [roleContactUuids, setRoleContactIds] = useState<Record<string, string>>({})
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
      if (detail?.slug === dossierId) {
        setKeyDateOptions(buildKeyDateOptions(detail, 'fr'))
      }
    })
  }, [loadTemplates, loadSettings, loadContacts, loadDetail, dossierId])

  useEffect(() => {
    if (templateUuid) return
    const defaultId = settings?.defaultTemplateUuid
    if (defaultId && templatesForKind.some((t) => t.uuid === defaultId)) {
      setTemplateId(defaultId)
    } else if (templatesForKind.length > 0 && templatesForKind[0]) {
      setTemplateId(templatesForKind[0].uuid)
    }
  }, [templateUuid, settings?.defaultTemplateUuid, templatesForKind])

  // Échéance auto : émission + délai standard, tant que l'utilisateur ne l'a pas modifiée.
  useEffect(() => {
    if (dueAtTouchedRef.current || !settings || !issuedAt) return
    setDueAt(computeDueDateIso(issuedAt, settings.defaultDueDays))
  }, [settings, issuedAt])

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
  const selectedTemplate = templatesForKind.find((t) => t.uuid === templateUuid)
  const templateUsesDocxSource = selectedTemplate?.hasDocxSource === true

  // Eagerly fetch tag paths whenever the docx template, date, or items change so that
  // the entire dialog stays on a single screen rather than splitting into a wizard.
  const billingItemIdsKey = useMemo(
    () => selectedItems.map((item) => item.uuid).join('|'),
    [selectedItems]
  )
  const previewSeqRef = useRef(0)
  useEffect(() => {
    if (!templateUsesDocxSource || !templateUuid) {
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
        if (detail?.slug === dossierId) {
          setKeyDateOptions(buildKeyDateOptions(detail, 'fr'))
        }

        const api = getOrdicabApi()
        if (!api) {
          setLocalError('API indisponible.')
          return
        }
        const result = await api.generate.previewInvoiceDocx({
          dossierId,
          templateUuid,
          billingItemUuids: selectedItems.map((item) => item.uuid),
          issuedAt,
          dueAt: dueAt || undefined
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
        const initPrimaryId = primaryContactUuid || firstContact?.uuid || ''

        const roleKeys = [
          ...new Set(
            paths
              .map((p) => normalizeTagPath(p).split('.'))
              .filter((s) => s[0] === 'contact' && s.length === 3)
              .map((s) => s[1] as string)
          )
        ]
        const initRoleIds: Record<string, string> = { ...roleContactUuids }
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
            // The module-resolved tags (numéro, échéance) always follow the fresh preview.
            paths.reduce<Record<string, string>>((acc, path) => {
              const existing = prev[path]
              acc[path] = AUTO_RESOLVED_TAG_PATHS.has(path)
                ? (initial[path] ?? '')
                : existing && existing !== ''
                  ? existing
                  : (initial[path] ?? '')
              return acc
            }, {}),
            initPrimaryId,
            initRoleIds,
            loadedContacts,
            managedFieldsConfig
          )
        )
        setTagProvenance(
          computeTagProvenance(
            paths,
            result.data.resolvedTags,
            hydrateAutoSelectedContactTags(
              initial,
              initPrimaryId,
              initRoleIds,
              loadedContacts,
              managedFieldsConfig
            ),
            undefined
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
    templateUuid,
    dossierId,
    billingItemIdsKey,
    issuedAt,
    dueAt,
    loadContacts,
    loadDetail,
    managedFieldsConfig
  ])

  async function submit(): Promise<void> {
    if (!templateUuid) {
      setLocalError('Sélectionnez un modèle.')
      return
    }
    setLocalError(null)
    setIsSubmitting(true)

    const extra: {
      tagOverrides?: Record<string, string>
      primaryContactUuid?: string
      contactRoleOverrides?: Record<string, string>
    } = {}

    if (templateUsesDocxSource) {
      const contactRoleOverrides = Object.fromEntries(
        Object.entries(roleContactUuids).filter(([, id]) => id)
      )
      extra.tagOverrides = tagValues
      extra.primaryContactUuid = primaryContactUuid || undefined
      extra.contactRoleOverrides = Object.keys(contactRoleOverrides).length
        ? contactRoleOverrides
        : undefined
    }

    const created = await create({
      dossierId,
      billingItemUuids: selectedItems.map((item) => item.uuid),
      templateUuid,
      issuedAt,
      dueAt: dueAt || undefined,
      rememberTemplateAsDefault: rememberDefault,
      ...extra
    })
    setIsSubmitting(false)
    if (created) {
      await loadDetail(dossierId)
      onCreated(created.uuid)
      onClose()
    }
  }

  return (
    <DialogShell onDismiss={onClose} size="xl" panelClassName="max-w-5xl">
      <div className="flex h-[85vh] flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {t('invoices.creation_dialog_title', { defaultValue: 'Générer une facture' })}
            </h2>
            <p className="text-xs text-ink-subtle">
              {t('invoices.creation_dialog_subtitle', {
                count: selectedItems.length,
                total: formatEurosFromCents(totals.totalTtc),
                defaultValue: '{{count}} prestation(s) — Total TTC {{total}}'
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-subtle hover:text-ink"
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
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-5">
            <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
              <section className="rounded-md border border-hairline bg-parchment-bright p-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-widest text-ink-subtle">
                  {t('invoices.creation_selected_items_label', {
                    defaultValue: 'Prestations sélectionnées'
                  })}
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {selectedItems.map((item) => (
                    <li key={item.uuid} className="flex justify-between gap-3">
                      <span className="truncate">
                        <span className="tabular-nums text-ink-subtle">{item.date}</span> ·{' '}
                        {item.label}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatEurosFromCents(item.totalTtcCents)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between border-t border-hairline pt-2 text-sm font-medium">
                  <span>{t('invoices.creation_total_ht', { defaultValue: 'Total HT' })}</span>
                  <span className="tabular-nums">{formatEurosFromCents(totals.totalHt)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold">
                  <span>{t('invoices.creation_total_ttc', { defaultValue: 'Total TTC' })}</span>
                  <span className="tabular-nums">{formatEurosFromCents(totals.totalTtc)}</span>
                </div>
              </section>

              <Field label="Modèle de facture">
                <Select
                  value={templateUuid}
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
                      <option key={tpl.uuid} value={tpl.uuid}>
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
                <label className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
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
                <Field label="Échéance">
                  <Input
                    type="date"
                    value={dueAt}
                    onChange={(e) => {
                      dueAtTouchedRef.current = true
                      setDueAt(e.target.value)
                    }}
                  />
                  {settings ? (
                    <p className="mt-1 text-xs text-ink-subtle">
                      {t('invoices.creation_due_hint', {
                        count: settings.defaultDueDays,
                        defaultValue: 'Auto : émission + {{count}} j'
                      })}
                    </p>
                  ) : null}
                </Field>
                <Field className="col-span-2" label="Numéro attribué (aperçu)">
                  <Input value={previewNumber ?? '—'} readOnly />
                </Field>
              </div>
            </div>

            <div className="flex min-h-0 flex-col">
              {templateUsesDocxSource ? (
                isLoadingTags && tagPaths.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-hairline bg-white px-4 py-8 text-center text-sm text-ink-muted">
                    {t('invoices.creation_loading_tags', {
                      defaultValue: 'Chargement des tags du modèle…'
                    })}
                  </div>
                ) : (
                  <TagFillingStep
                    tagPaths={tagPaths}
                    tagValues={tagValues}
                    onTagValuesChange={setTagValues}
                    primaryContactUuid={primaryContactUuid}
                    onPrimaryContactChange={setPrimaryContactId}
                    roleContactUuids={roleContactUuids}
                    onRoleContactIdsChange={setRoleContactIds}
                    dossierContacts={dossierContacts}
                    keyDateOptions={keyDateOptions}
                    managedFieldsConfig={managedFieldsConfig}
                    tagProvenance={tagProvenance}
                  />
                )
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-hairline bg-white px-4 py-8 text-center text-sm text-ink-muted">
                  {t('invoices.creation_no_tags_for_template', {
                    defaultValue: 'Ce modèle ne comporte aucun champ à compléter.'
                  })}
                </div>
              )}
            </div>
          </div>

          {(localError || storeError) && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {localError ?? storeError}
            </p>
          )}

          <footer className="flex justify-end gap-2 border-t border-hairline pt-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel', { defaultValue: 'Annuler' })}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !templateUuid || (templateUsesDocxSource && isLoadingTags)}
            >
              {isSubmitting ? 'Génération…' : 'Générer la facture'}
            </Button>
          </footer>
        </form>
      </div>
    </DialogShell>
  )
}
