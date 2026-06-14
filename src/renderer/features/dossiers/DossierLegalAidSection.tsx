import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type DossierDetail,
  type DossierLegalAid,
  type LegalAidStatus,
  type LegalAidType,
  LEGAL_AID_STATUS_VALUES,
  LEGAL_AID_TYPE_VALUES
} from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Field, Input, Select, Textarea } from '@renderer/components/ui/form'
import { useDossierStore } from '@renderer/stores/dossierStore'
import {
  formatEurosFromCents,
  formatPercentInput,
  parseEurosToCents,
  parsePercentToBasisPoints
} from '@renderer/lib/billingFormatters'

import { SectionHeader } from './sectionLayout'

interface DossierLegalAidSectionProps {
  dossier: DossierDetail
  disabled?: boolean
}

interface LegalAidEditorState {
  enabled: boolean
  status: LegalAidStatus
  type: LegalAidType
  share: string
  bajDecisionNumber: string
  bajDecisionDate: string
  bajOffice: string
  aidNumber: string
  stateRetribution: string
  complement: string
  notes: string
}

function toEditorState(legalAid: DossierLegalAid | undefined): LegalAidEditorState {
  return {
    enabled: Boolean(legalAid && legalAid.status !== 'none'),
    status: legalAid?.status && legalAid.status !== 'none' ? legalAid.status : 'requested',
    type: legalAid?.type ?? 'total',
    share: formatPercentInput(legalAid?.shareBasisPoints),
    bajDecisionNumber: legalAid?.bajDecisionNumber ?? '',
    bajDecisionDate: legalAid?.bajDecisionDate ?? '',
    bajOffice: legalAid?.bajOffice ?? '',
    aidNumber: legalAid?.aidNumber ?? '',
    stateRetribution: formatEurosFromCents(legalAid?.stateRetributionHtCents).replace(
      /[^\d.,]/g,
      ''
    ),
    complement: formatEurosFromCents(legalAid?.complementHtCents).replace(/[^\d.,]/g, ''),
    notes: legalAid?.notes ?? ''
  }
}

function buildLegalAid(state: LegalAidEditorState, autoSetupDone?: boolean): DossierLegalAid {
  if (!state.enabled) {
    return { status: 'none', autoSetupDone }
  }
  const isGranted = state.status === 'granted'
  const isPartial = isGranted && state.type === 'partial'
  return {
    status: state.status,
    type: isGranted ? state.type : undefined,
    shareBasisPoints: isPartial ? parsePercentToBasisPoints(state.share) : undefined,
    bajDecisionNumber: state.bajDecisionNumber.trim() || undefined,
    bajDecisionDate: state.bajDecisionDate || undefined,
    bajOffice: state.bajOffice.trim() || undefined,
    aidNumber: state.aidNumber.trim() || undefined,
    stateRetributionHtCents: isGranted ? parseEurosToCents(state.stateRetribution) : undefined,
    complementHtCents: isPartial ? parseEurosToCents(state.complement) : undefined,
    notes: state.notes.trim() || undefined,
    autoSetupDone
  }
}

export function DossierLegalAidSection({
  dossier,
  disabled
}: DossierLegalAidSectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const updateLegalAid = useDossierStore((s) => s.updateLegalAid)
  const setupLegalAid = useDossierStore((s) => s.setupLegalAid)
  const isSaving = useDossierStore((s) => s.isSavingDetail)

  const [state, setState] = useState<LegalAidEditorState>(() => toEditorState(dossier.legalAid))

  const autoSetupDone = dossier.legalAid?.autoSetupDone
  const busy = disabled || isSaving

  const update = <K extends keyof LegalAidEditorState>(
    key: K,
    value: LegalAidEditorState[K]
  ): void => {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async (): Promise<void> => {
    await updateLegalAid({ dossierId: dossier.slug, legalAid: buildLegalAid(state, autoSetupDone) })
  }

  const handleAutoSetup = async (): Promise<void> => {
    const saved = await updateLegalAid({
      dossierId: dossier.slug,
      legalAid: buildLegalAid(state, autoSetupDone)
    })
    if (!saved) {
      return
    }
    await setupLegalAid({ dossierId: dossier.slug, force: Boolean(autoSetupDone) })
  }

  const canAutoSetup = state.enabled && state.status === 'granted' && !busy

  return (
    <div className="flex h-full flex-col gap-4">
      <SectionHeader
        badge={t('dossiers.legal_aid_badge', { defaultValue: 'Aide juridictionnelle' })}
        actions={
          <div className="flex items-center gap-2.5 text-sm text-[#3c3c3a]">
            <span id="legal-aid-toggle-label">
              {t('dossiers.legal_aid_toggle', {
                defaultValue: 'Dossier à l’aide juridictionnelle'
              })}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={state.enabled}
              aria-labelledby="legal-aid-toggle-label"
              disabled={busy}
              onClick={() => update('enabled', !state.enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                state.enabled ? 'bg-aurora' : 'bg-hairline-strong'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                  state.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        }
      />

      {!state.enabled ? (
        <p className="text-sm text-[#6c6c68]">
          {t('dossiers.legal_aid_disabled_hint', {
            defaultValue:
              'Cochez « Dossier à l’aide juridictionnelle » en haut à droite pour suivre la décision du BAJ et automatiser la convention, les factures et les échéances.'
          })}
        </p>
      ) : (
        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('dossiers.legal_aid_status', { defaultValue: 'Statut' })}>
              <Select
                value={state.status}
                disabled={busy}
                onChange={(event) => update('status', event.target.value as LegalAidStatus)}
              >
                {LEGAL_AID_STATUS_VALUES.filter((value) => value !== 'none').map((value) => (
                  <option key={value} value={value}>
                    {t(`dossiers.legal_aid_status_${value}`, { defaultValue: value })}
                  </option>
                ))}
              </Select>
            </Field>

            {state.status === 'granted' ? (
              <Field label={t('dossiers.legal_aid_type', { defaultValue: 'Type d’AJ' })}>
                <Select
                  value={state.type}
                  disabled={busy}
                  onChange={(event) => update('type', event.target.value as LegalAidType)}
                >
                  {LEGAL_AID_TYPE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {t(`dossiers.legal_aid_type_${value}`, { defaultValue: value })}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>

          {state.status === 'granted' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={t('dossiers.legal_aid_state_retribution', {
                  defaultValue: 'Rétribution État HT (€)'
                })}
              >
                <Input
                  inputMode="decimal"
                  value={state.stateRetribution}
                  disabled={busy}
                  onChange={(event) => update('stateRetribution', event.target.value)}
                />
              </Field>
              {state.type === 'partial' ? (
                <Field label={t('dossiers.legal_aid_share', { defaultValue: 'Taux AJ (%)' })}>
                  <Input
                    inputMode="decimal"
                    value={state.share}
                    disabled={busy}
                    onChange={(event) => update('share', event.target.value)}
                    placeholder="55"
                  />
                </Field>
              ) : null}
              {state.type === 'partial' ? (
                <Field
                  label={t('dossiers.legal_aid_complement', {
                    defaultValue: 'Complément d’honoraires HT (€)'
                  })}
                >
                  <Input
                    inputMode="decimal"
                    value={state.complement}
                    disabled={busy}
                    onChange={(event) => update('complement', event.target.value)}
                  />
                </Field>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={t('dossiers.legal_aid_baj_decision_number', {
                defaultValue: 'N° décision BAJ'
              })}
            >
              <Input
                value={state.bajDecisionNumber}
                disabled={busy}
                onChange={(event) => update('bajDecisionNumber', event.target.value)}
              />
            </Field>
            <Field
              label={t('dossiers.legal_aid_baj_decision_date', {
                defaultValue: 'Date de décision'
              })}
            >
              <Input
                type="date"
                value={state.bajDecisionDate}
                disabled={busy}
                onChange={(event) => update('bajDecisionDate', event.target.value)}
              />
            </Field>
            <Field
              label={t('dossiers.legal_aid_baj_office', { defaultValue: 'BAJ / juridiction' })}
            >
              <Input
                value={state.bajOffice}
                disabled={busy}
                onChange={(event) => update('bajOffice', event.target.value)}
              />
            </Field>
            <Field
              label={t('dossiers.legal_aid_aid_number', { defaultValue: 'N° AJ / réf. CARPA' })}
            >
              <Input
                value={state.aidNumber}
                disabled={busy}
                onChange={(event) => update('aidNumber', event.target.value)}
              />
            </Field>
          </div>

          <Field label={t('dossiers.legal_aid_notes', { defaultValue: 'Notes' })}>
            <Textarea
              rows={2}
              value={state.notes}
              disabled={busy}
              onChange={(event) => update('notes', event.target.value)}
            />
          </Field>

          <div className="rounded-md border border-hairline bg-[#f6f4ec] p-3 text-xs text-ink-muted">
            <p className="font-medium text-[#3c3c3a]">
              {t('dossiers.legal_aid_auto_setup_title', {
                defaultValue: 'À quoi sert « Tout configurer automatiquement » ?'
              })}
            </p>
            <p className="mt-1">
              {t('dossiers.legal_aid_auto_setup_hint', {
                defaultValue:
                  'En un seul clic, à partir des informations et des montants saisis ci-dessus, l’application crée pour vous :'
              })}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>
                {t('dossiers.legal_aid_auto_setup_step_agreement', {
                  defaultValue:
                    'la convention d’honoraires AJ (ou convention de complément si AJ partielle) ;'
                })}
              </li>
              <li>
                {t('dossiers.legal_aid_auto_setup_step_invoices', {
                  defaultValue:
                    'les factures : rétribution de l’État (réglée via la CARPA) et, en AJ partielle, le complément facturé au client ;'
                })}
              </li>
              <li>
                {t('dossiers.legal_aid_auto_setup_step_documents', {
                  defaultValue:
                    'les documents pré-remplis : désignation et attestation de fin de mission ;'
                })}
              </li>
              <li>
                {t('dossiers.legal_aid_auto_setup_step_deadlines', {
                  defaultValue:
                    'les échéances : dépôt de la demande, attestation de fin de mission et recouvrement CARPA.'
                })}
              </li>
            </ul>
            <p className="mt-1 italic">
              {t('dossiers.legal_aid_auto_setup_note', {
                defaultValue:
                  'Disponible une fois l’AJ « accordée ». Le bouton se transforme ensuite en « Reconfigurer » pour éviter les doublons.'
              })}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => void handleSave()}>
              {t('dossiers.legal_aid_save', { defaultValue: 'Enregistrer' })}
            </Button>
            <Button
              disabled={!canAutoSetup}
              title={t('dossiers.legal_aid_auto_setup_tooltip', {
                defaultValue:
                  'Crée automatiquement la convention, les factures (rétribution État + complément), les documents et les échéances à partir des montants saisis.'
              })}
              onClick={() => void handleAutoSetup()}
            >
              {autoSetupDone
                ? t('dossiers.legal_aid_reconfigure', {
                    defaultValue: 'Reconfigurer automatiquement'
                  })
                : t('dossiers.legal_aid_auto_setup', {
                    defaultValue: 'Tout configurer automatiquement'
                  })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
