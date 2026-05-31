import { useEffect, useMemo, useState } from 'react'

import { useTranslation } from 'react-i18next'

import {
  DEFAULT_INVOICE_SETTINGS,
  INVOICE_NUMBER_PATTERN_PRESETS,
  type InvoiceSettings,
  type InvoiceSettingsUpdateInput,
  previewInvoiceNumber
} from '@shared/types'

import { Button, DialogShell, Field, Input, Select } from '@renderer/components/ui'
import { useInvoiceStore } from '@renderer/stores/invoiceStore'
import { useTemplateStore } from '@renderer/stores/templateStore'

const CUSTOM_PRESET_VALUE = '__custom__'

interface FormState {
  patternPreset: string
  numberPattern: string
  sequencePadding: string
  resetSequenceYearly: boolean
  nextSequence: string
  creditNoteNumberPattern: string
  creditNoteNextSequence: string
  correctiveInvoiceNumberPattern: string
  correctiveInvoiceNextSequence: string
  defaultTemplateId: string
  defaultCreditNoteTemplateId: string
  defaultCorrectiveInvoiceTemplateId: string
  issuerName: string
  issuerAddress: string
  issuerSiret: string
  issuerVatNumber: string
  issuerIban: string
  legalFooter: string
  defaultPaymentTerms: string
}

function settingsToForm(settings: InvoiceSettings): FormState {
  const matchedPreset = INVOICE_NUMBER_PATTERN_PRESETS.find(
    (p) => p.pattern === settings.numberPattern
  )
  return {
    patternPreset: matchedPreset ? matchedPreset.pattern : CUSTOM_PRESET_VALUE,
    numberPattern: settings.numberPattern,
    sequencePadding: String(settings.sequencePadding),
    resetSequenceYearly: settings.resetSequenceYearly,
    nextSequence: String(settings.nextSequence),
    creditNoteNumberPattern: settings.creditNoteNumberPattern,
    creditNoteNextSequence: String(settings.creditNoteNextSequence),
    correctiveInvoiceNumberPattern: settings.correctiveInvoiceNumberPattern,
    correctiveInvoiceNextSequence: String(settings.correctiveInvoiceNextSequence),
    defaultTemplateId: settings.defaultTemplateId ?? '',
    defaultCreditNoteTemplateId: settings.defaultCreditNoteTemplateId ?? '',
    defaultCorrectiveInvoiceTemplateId: settings.defaultCorrectiveInvoiceTemplateId ?? '',
    issuerName: settings.issuerName ?? '',
    issuerAddress: settings.issuerAddress ?? '',
    issuerSiret: settings.issuerSiret ?? '',
    issuerVatNumber: settings.issuerVatNumber ?? '',
    issuerIban: settings.issuerIban ?? '',
    legalFooter: settings.legalFooter ?? '',
    defaultPaymentTerms: settings.defaultPaymentTerms ?? ''
  }
}

function formToPatch(form: FormState): InvoiceSettingsUpdateInput {
  return {
    numberPattern: form.numberPattern.trim(),
    sequencePadding: Number(form.sequencePadding) || 0,
    resetSequenceYearly: form.resetSequenceYearly,
    nextSequence: Math.max(1, Number(form.nextSequence) || 1),
    creditNoteNumberPattern: form.creditNoteNumberPattern.trim(),
    creditNoteNextSequence: Math.max(1, Number(form.creditNoteNextSequence) || 1),
    correctiveInvoiceNumberPattern: form.correctiveInvoiceNumberPattern.trim(),
    correctiveInvoiceNextSequence: Math.max(1, Number(form.correctiveInvoiceNextSequence) || 1),
    defaultTemplateId: form.defaultTemplateId || null,
    defaultCreditNoteTemplateId: form.defaultCreditNoteTemplateId || null,
    defaultCorrectiveInvoiceTemplateId: form.defaultCorrectiveInvoiceTemplateId || null,
    issuerName: form.issuerName || null,
    issuerAddress: form.issuerAddress || null,
    issuerSiret: form.issuerSiret || null,
    issuerVatNumber: form.issuerVatNumber || null,
    issuerIban: form.issuerIban || null,
    legalFooter: form.legalFooter || null,
    defaultPaymentTerms: form.defaultPaymentTerms || null
  }
}

interface InvoiceSettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function InvoiceSettingsDialog({
  open,
  onClose
}: InvoiceSettingsDialogProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const settings = useInvoiceStore((s) => s.settings)
  const loadSettings = useInvoiceStore((s) => s.loadSettings)
  const updateSettings = useInvoiceStore((s) => s.updateSettings)
  const storeError = useInvoiceStore((s) => s.error)
  const templates = useTemplateStore((s) => s.templates)
  const loadTemplates = useTemplateStore((s) => s.load)

  const [form, setForm] = useState<FormState>(() => settingsToForm(DEFAULT_INVOICE_SETTINGS))
  const [isSaving, setIsSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Reload data + reset draft on each open.
  useEffect(() => {
    if (!open) return
    void loadSettings()
    void loadTemplates()
    const handle = window.requestAnimationFrame(() => setValidationError(null))
    return () => window.cancelAnimationFrame(handle)
  }, [open, loadSettings, loadTemplates])

  useEffect(() => {
    if (!open || !settings) return
    const handle = window.requestAnimationFrame(() => setForm(settingsToForm(settings)))
    return () => window.cancelAnimationFrame(handle)
  }, [open, settings])

  const liveSettings: InvoiceSettings = useMemo(
    () => ({
      numberPattern: form.numberPattern,
      sequencePadding: Number(form.sequencePadding) || 0,
      resetSequenceYearly: form.resetSequenceYearly,
      nextSequence: Math.max(1, Number(form.nextSequence) || 1),
      currentSequenceYear: settings?.currentSequenceYear ?? new Date().getFullYear(),
      creditNoteNumberPattern: form.creditNoteNumberPattern,
      creditNoteNextSequence: Math.max(1, Number(form.creditNoteNextSequence) || 1),
      creditNoteCurrentSequenceYear:
        settings?.creditNoteCurrentSequenceYear ?? new Date().getFullYear(),
      correctiveInvoiceNumberPattern: form.correctiveInvoiceNumberPattern,
      correctiveInvoiceNextSequence: Math.max(1, Number(form.correctiveInvoiceNextSequence) || 1),
      correctiveInvoiceCurrentSequenceYear:
        settings?.correctiveInvoiceCurrentSequenceYear ?? new Date().getFullYear(),
      defaultTemplateId: form.defaultTemplateId || undefined,
      defaultCreditNoteTemplateId: form.defaultCreditNoteTemplateId || undefined,
      defaultCorrectiveInvoiceTemplateId: form.defaultCorrectiveInvoiceTemplateId || undefined
    }),
    [
      form,
      settings?.currentSequenceYear,
      settings?.creditNoteCurrentSequenceYear,
      settings?.correctiveInvoiceCurrentSequenceYear
    ]
  )

  // Each default-template select shows templates of the matching kind PLUS the
  // generic 'document'/unmarked ones (legacy and all-purpose templates).
  const invoiceTemplates = useMemo(
    () =>
      templates.filter((tpl) => {
        const kind = tpl.documentKind ?? 'document'
        return kind === 'invoice' || kind === 'document'
      }),
    [templates]
  )
  const creditNoteTemplates = useMemo(
    () =>
      templates.filter((tpl) => {
        const kind = tpl.documentKind ?? 'document'
        return kind === 'creditNote' || kind === 'document'
      }),
    [templates]
  )
  const correctiveTemplates = useMemo(
    () =>
      templates.filter((tpl) => {
        const kind = tpl.documentKind ?? 'document'
        return kind === 'correctiveInvoice' || kind === 'document'
      }),
    [templates]
  )

  const preview = useMemo(() => {
    try {
      return previewInvoiceNumber(liveSettings, new Date())
    } catch {
      return null
    }
  }, [liveSettings])

  if (!open) return null

  async function handleSave(): Promise<void> {
    if (
      !form.numberPattern.includes('{SEQ}') ||
      !form.creditNoteNumberPattern.includes('{SEQ}') ||
      !form.correctiveInvoiceNumberPattern.includes('{SEQ}')
    ) {
      setValidationError('Chaque motif de numérotation doit contenir {SEQ}.')
      return
    }
    setValidationError(null)
    setIsSaving(true)
    const ok = await updateSettings(formToPatch(form))
    setIsSaving(false)
    if (ok) onClose()
  }

  function setPatternPreset(value: string): void {
    if (value === CUSTOM_PRESET_VALUE) {
      setForm((prev) => ({ ...prev, patternPreset: CUSTOM_PRESET_VALUE }))
    } else {
      setForm((prev) => ({ ...prev, patternPreset: value, numberPattern: value }))
    }
  }

  const isCustom = form.patternPreset === CUSTOM_PRESET_VALUE

  return (
    <DialogShell
      onDismiss={onClose}
      size="lg"
      panelClassName="flex max-h-[85vh] flex-col"
      aria-label={t('invoices.settings_dialog_title', {
        defaultValue: 'Paramètres de facturation'
      })}
    >
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold text-[#1a1a1a]">
          {t('invoices.settings_dialog_title', { defaultValue: 'Paramètres de facturation' })}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[#5c5c5a] transition hover:bg-[#e4e1d5] hover:text-[#1a1a1a]"
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a]">
              {t('invoices.settings_numbering_title', { defaultValue: 'Numérotation' })}
            </h3>
            <p className="mt-0.5 text-xs text-[#8a8a85]">
              {t('invoices.settings_numbering_hint', {
                defaultValue: 'Motif appliqué à chaque nouvelle facture émise.'
              })}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Motif (preset)">
              <Select value={form.patternPreset} onChange={(e) => setPatternPreset(e.target.value)}>
                {INVOICE_NUMBER_PATTERN_PRESETS.map((preset) => (
                  <option key={preset.pattern} value={preset.pattern}>
                    {preset.pattern} → {preset.label}
                  </option>
                ))}
                <option value={CUSTOM_PRESET_VALUE}>
                  {t('invoices.settings_pattern_custom', { defaultValue: 'Personnalisé…' })}
                </option>
              </Select>
            </Field>
            <Field label="Motif appliqué">
              <Input
                value={form.numberPattern}
                disabled={!isCustom}
                onChange={(e) => setForm((p) => ({ ...p, numberPattern: e.target.value }))}
              />
            </Field>
          </div>
          <div className="rounded-md border border-[#e5e3da] bg-[#fbf9f4] px-3 py-2 text-xs text-[#5c5c5a]">
            <p>
              {t('invoices.settings_pattern_tokens', {
                defaultValue:
                  'Tokens : {YYYY} année 4 chiffres, {YY} année 2 chiffres, {MM} mois, {DD} jour, {SEQ} numéro séquentiel. Tout autre texte est conservé tel quel.'
              })}
            </p>
            <p className="mt-1">
              {t('invoices.settings_pattern_preview', {
                preview: preview ?? '—',
                defaultValue: "Aperçu prochaine facture (aujourd'hui) : {{preview}}"
              })}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Padding (zéros)">
              <Input
                type="number"
                min={0}
                max={12}
                value={form.sequencePadding}
                onChange={(e) => setForm((p) => ({ ...p, sequencePadding: e.target.value }))}
              />
            </Field>
            <Field label="Prochaine séquence">
              <Input
                type="number"
                min={1}
                value={form.nextSequence}
                onChange={(e) => setForm((p) => ({ ...p, nextSequence: e.target.value }))}
              />
            </Field>
            <Field label="Reset annuel">
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.resetSequenceYearly}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, resetSequenceYearly: e.target.checked }))
                  }
                  className="h-4 w-4 cursor-pointer accent-aurora"
                />
                {t('invoices.settings_reset_yearly', { defaultValue: 'Remettre à 1 chaque année' })}
              </label>
            </Field>
          </div>
          <div className="grid gap-3 border-t border-[#e5e3da] pt-3 md:grid-cols-2">
            <Field label="Motif avoirs">
              <Input
                value={form.creditNoteNumberPattern}
                onChange={(e) =>
                  setForm((p) => ({ ...p, creditNoteNumberPattern: e.target.value }))
                }
              />
            </Field>
            <Field label="Prochaine séquence avoir">
              <Input
                type="number"
                min={1}
                value={form.creditNoteNextSequence}
                onChange={(e) => setForm((p) => ({ ...p, creditNoteNextSequence: e.target.value }))}
              />
            </Field>
            <Field label="Motif rectificatives">
              <Input
                value={form.correctiveInvoiceNumberPattern}
                onChange={(e) =>
                  setForm((p) => ({ ...p, correctiveInvoiceNumberPattern: e.target.value }))
                }
              />
            </Field>
            <Field label="Prochaine séquence rectificative">
              <Input
                type="number"
                min={1}
                value={form.correctiveInvoiceNextSequence}
                onChange={(e) =>
                  setForm((p) => ({ ...p, correctiveInvoiceNextSequence: e.target.value }))
                }
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3 border-t border-[#e5e3da] pt-4">
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a]">
              {t('invoices.settings_templates_title', { defaultValue: 'Modèles par défaut' })}
            </h3>
            <p className="mt-0.5 text-xs text-[#8a8a85]">
              {t('invoices.settings_templates_hint', {
                defaultValue:
                  'Un modèle par type de document, proposé par défaut lors de la génération.'
              })}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Facture">
              <Select
                value={form.defaultTemplateId}
                onChange={(e) => setForm((p) => ({ ...p, defaultTemplateId: e.target.value }))}
              >
                <option value="">
                  {t('invoices.settings_no_template', { defaultValue: '— Aucun —' })}
                </option>
                {invoiceTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Avoir">
              <Select
                value={form.defaultCreditNoteTemplateId}
                onChange={(e) =>
                  setForm((p) => ({ ...p, defaultCreditNoteTemplateId: e.target.value }))
                }
              >
                <option value="">
                  {t('invoices.settings_no_template', { defaultValue: '— Aucun —' })}
                </option>
                {creditNoteTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Facture rectificative">
              <Select
                value={form.defaultCorrectiveInvoiceTemplateId}
                onChange={(e) =>
                  setForm((p) => ({ ...p, defaultCorrectiveInvoiceTemplateId: e.target.value }))
                }
              >
                <option value="">
                  {t('invoices.settings_no_template', { defaultValue: '— Aucun —' })}
                </option>
                {correctiveTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <section className="space-y-3 border-t border-[#e5e3da] pt-4">
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a]">
              {t('invoices.settings_issuer_title', { defaultValue: 'Émetteur' })}
            </h3>
            <p className="mt-0.5 text-xs text-[#8a8a85]">
              {t('invoices.settings_issuer_hint', {
                defaultValue: 'Informations injectées dans les tags {{invoice.issuer.*}} du modèle.'
              })}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Raison sociale">
              <Input
                value={form.issuerName}
                onChange={(e) => setForm((p) => ({ ...p, issuerName: e.target.value }))}
              />
            </Field>
            <Field label="SIRET">
              <Input
                value={form.issuerSiret}
                onChange={(e) => setForm((p) => ({ ...p, issuerSiret: e.target.value }))}
              />
            </Field>
            <Field label="N° TVA intracom">
              <Input
                value={form.issuerVatNumber}
                onChange={(e) => setForm((p) => ({ ...p, issuerVatNumber: e.target.value }))}
              />
            </Field>
            <Field label="IBAN">
              <Input
                value={form.issuerIban}
                onChange={(e) => setForm((p) => ({ ...p, issuerIban: e.target.value }))}
              />
            </Field>
            <Field className="md:col-span-2" label="Adresse">
              <textarea
                value={form.issuerAddress}
                onChange={(e) => setForm((p) => ({ ...p, issuerAddress: e.target.value }))}
                className="min-h-15 rounded-md border border-[#e5e3da] bg-white px-2 py-1 text-sm"
              />
            </Field>
            <Field className="md:col-span-2" label="Mention légale (pied de facture)">
              <textarea
                value={form.legalFooter}
                onChange={(e) => setForm((p) => ({ ...p, legalFooter: e.target.value }))}
                className="min-h-15 rounded-md border border-[#e5e3da] bg-white px-2 py-1 text-sm"
              />
            </Field>
            <Field className="md:col-span-2" label="Conditions de paiement par défaut">
              <textarea
                value={form.defaultPaymentTerms}
                onChange={(e) => setForm((p) => ({ ...p, defaultPaymentTerms: e.target.value }))}
                className="min-h-15 rounded-md border border-[#e5e3da] bg-white px-2 py-1 text-sm"
                placeholder="Paiement à réception. Tout retard donne lieu à des pénalités…"
              />
              <p className="mt-1 text-xs text-[#8a8a85]">
                {t('invoices.settings_payment_terms_hint', {
                  defaultValue:
                    'Injecté dans {{facture.conditionsPaiement}}. Identique pour toutes les factures émises.'
                })}
              </p>
            </Field>
          </div>
        </section>

        {(validationError || storeError) && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {validationError ?? storeError}
          </p>
        )}
      </div>

      <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-[#e5e3da] pt-3">
        <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
          {t('common.cancel', { defaultValue: 'Annuler' })}
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </DialogShell>
  )
}
