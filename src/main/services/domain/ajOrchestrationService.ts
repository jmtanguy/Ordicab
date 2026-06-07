import {
  type DossierBillingItem,
  type DossierDetail,
  type DossierFeeAgreement,
  type DossierLegalAid,
  type DossierSetupLegalAidInput,
  type DossierSetupLegalAidResult,
  type GeneratedDocumentResult,
  type InvoiceRecord,
  type KeyDate,
  IpcErrorCode
} from '@shared/types'
import { buildBillingItemFromFeeAgreement } from '@shared/billingCalculations'

import type { TemplateRecord } from '@shared/types'

import type { DossierRegistryService } from './dossierRegistryService'
import type { GenerateService } from './generateService'
import type { InvoiceService } from './invoiceService'
import type { TemplateService } from './templateService'

/**
 * Tags portés par les modèles AJ de la bibliothèque (templateLibrary). Les
 * modèles étant persistés avec un UUID, on les résout dynamiquement par tag
 * plutôt que par identifiant figé.
 */
const AJ_TEMPLATE_TAGS = {
  designation: ['aide-juridictionnelle', 'designation'],
  attestationFinMission: ['aide-juridictionnelle', 'attestation'],
  conventionComplement: ['aide-juridictionnelle', 'complement'],
  factureRetributionEtat: ['aide-juridictionnelle', 'facture', 'etat'],
  factureComplement: ['aide-juridictionnelle', 'facture', 'complement']
} as const

function findTemplateByTags(
  templates: TemplateRecord[],
  requiredTags: readonly string[]
): TemplateRecord | undefined {
  return templates.find((template) =>
    requiredTags.every((tag) => (template.tags ?? []).includes(tag))
  )
}

export type AjSetupInput = DossierSetupLegalAidInput
export type AjSetupResult = DossierSetupLegalAidResult

export interface AjOrchestrationService {
  setupLegalAid(input: AjSetupInput): Promise<AjSetupResult>
}

export class AjOrchestrationError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AjOrchestrationError'
  }
}

export interface AjOrchestrationServiceOptions {
  dossierService: DossierRegistryService
  invoiceService: InvoiceService
  generateService: GenerateService
  templateService: TemplateService
  now?: () => Date
}

function idsOf(entries: Array<{ id: string }>): Set<string> {
  return new Set(entries.map((entry) => entry.id))
}

function findNew<T extends { id: string }>(before: Set<string>, after: T[]): T | undefined {
  return after.find((entry) => !before.has(entry.id))
}

export function createAjOrchestrationService(
  options: AjOrchestrationServiceOptions
): AjOrchestrationService {
  const { dossierService, invoiceService, generateService, templateService } = options
  const now = options.now ?? (() => new Date())

  async function generateAjDocument(
    dossierId: string,
    templateId: string,
    warnings: string[]
  ): Promise<string | undefined> {
    try {
      const result: GeneratedDocumentResult = await generateService.generateDocument({
        dossierId,
        templateId,
        tags: ['aide-juridictionnelle'],
        description: 'Document généré automatiquement (aide juridictionnelle)'
      })
      return result.documentUuid
    } catch (error) {
      warnings.push(
        `Impossible de générer le document « ${templateId} » : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`
      )
      return undefined
    }
  }

  async function createInvoice(
    dossierId: string,
    billingItemId: string,
    templateId: string,
    warnings: string[]
  ): Promise<InvoiceRecord | undefined> {
    try {
      return await invoiceService.create({ dossierId, billingItemIds: [billingItemId], templateId })
    } catch (error) {
      warnings.push(
        `Facture non émise (modèle ${templateId}) : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`
      )
      return undefined
    }
  }

  return {
    async setupLegalAid(input): Promise<AjSetupResult> {
      const warnings: string[] = []
      const dossier: DossierDetail = await dossierService.getDossier({
        dossierId: input.dossierId
      })
      const legalAid = dossier.legalAid
      if (!legalAid || legalAid.status !== 'granted' || !legalAid.type) {
        throw new AjOrchestrationError(
          IpcErrorCode.VALIDATION_FAILED,
          "L'aide juridictionnelle doit être accordée (totale ou partielle) avant la configuration automatique."
        )
      }
      if (legalAid.autoSetupDone && !input.force) {
        throw new AjOrchestrationError(
          IpcErrorCode.INTEGRITY_CONFLICT,
          "L'aide juridictionnelle a déjà été configurée pour ce dossier."
        )
      }

      const templates = await templateService.list()

      // Montants saisis librement par l'avocat sur le dossier (aucun barème).
      const stateRetributionHtCents = Math.max(0, legalAid.stateRetributionHtCents ?? 0)
      const complementHtCents =
        legalAid.type === 'partial' ? Math.max(0, legalAid.complementHtCents ?? 0) : 0

      const matterLabel = dossier.name ?? `Dossier ${dossier.id}`
      // TVA cabinet par défaut (20 %) pour la convention ; la rétribution État
      // est traitée comme exonérée via `legalAidVatExempt` au niveau des items.
      const vatRateBasisPoints = 2000

      // 1. Convention AJ (ou convention de complément si AJ partielle).
      const beforeAgreements = idsOf(dossier.feeAgreements)
      const afterFeeAgreement = await dossierService.upsertFeeAgreement({
        dossierId: input.dossierId,
        setActive: true,
        status: 'draft',
        matterLabel,
        scopeDescription: "Mission au titre de l'aide juridictionnelle.",
        billingType: 'flat',
        flatFeeHtCents: stateRetributionHtCents,
        vatRateBasisPoints,
        legalAidMode: true,
        legalAidType: legalAid.type,
        legalAidShareBasisPoints:
          legalAid.type === 'partial' ? legalAid.shareBasisPoints : undefined,
        stateRetributionHtCents,
        complementHtCents: legalAid.type === 'partial' ? complementHtCents : undefined,
        legalAidVatExempt: true
      })
      const feeAgreement: DossierFeeAgreement | undefined = findNew(
        beforeAgreements,
        afterFeeAgreement.feeAgreements
      )
      if (!feeAgreement) {
        throw new AjOrchestrationError(
          IpcErrorCode.UNKNOWN,
          'La convention AJ n’a pas pu être créée.'
        )
      }

      // 2. Items de facturation : rétribution État (+ complément si partielle).
      const billingItemIds: string[] = []
      const billItem = async (
        conversionKind: 'stateRetribution' | 'legalAidComplement'
      ): Promise<DossierBillingItem | undefined> => {
        const upsertInput = buildBillingItemFromFeeAgreement(feeAgreement, {
          dossierId: input.dossierId,
          today: now().toISOString().slice(0, 10),
          conversionKind
        })
        const detailBefore = await dossierService.getDossier({ dossierId: input.dossierId })
        const before = idsOf(detailBefore.billingItems)
        const after = await dossierService.upsertBillingItem(upsertInput)
        return findNew(before, after.billingItems)
      }

      const stateItem = stateRetributionHtCents > 0 ? await billItem('stateRetribution') : undefined
      if (stateItem) {
        billingItemIds.push(stateItem.id)
      }
      let complementItem: DossierBillingItem | undefined
      if (legalAid.type === 'partial' && complementHtCents > 0) {
        complementItem = await billItem('legalAidComplement')
        if (complementItem) {
          billingItemIds.push(complementItem.id)
        }
      }

      // 3. Factures séparées (État vers CARPA, complément client).
      const invoiceIds: string[] = []
      const invoiceNumbers: string[] = []
      const stateInvoiceTemplate = findTemplateByTags(
        templates,
        AJ_TEMPLATE_TAGS.factureRetributionEtat
      )
      const complementInvoiceTemplate = findTemplateByTags(
        templates,
        AJ_TEMPLATE_TAGS.factureComplement
      )
      if (stateItem && stateInvoiceTemplate) {
        const invoice = await createInvoice(
          input.dossierId,
          stateItem.id,
          stateInvoiceTemplate.id,
          warnings
        )
        if (invoice) {
          invoiceIds.push(invoice.id)
          invoiceNumbers.push(invoice.number)
        }
      } else if (stateItem) {
        warnings.push(
          'Modèle de facture « Rétribution AJ (État) » introuvable : importez-le depuis la bibliothèque de modèles.'
        )
      }
      if (complementItem && complementInvoiceTemplate) {
        const invoice = await createInvoice(
          input.dossierId,
          complementItem.id,
          complementInvoiceTemplate.id,
          warnings
        )
        if (invoice) {
          invoiceIds.push(invoice.id)
          invoiceNumbers.push(invoice.number)
        }
      } else if (complementItem) {
        warnings.push(
          "Modèle de facture « Complément d'honoraires (AJ) » introuvable : importez-le depuis la bibliothèque de modèles."
        )
      }

      // 4. Documents AJ pré-remplis.
      const documentUuids: string[] = []
      const documentTagSets: Array<readonly string[]> = [AJ_TEMPLATE_TAGS.designation]
      if (legalAid.type === 'partial') {
        documentTagSets.push(AJ_TEMPLATE_TAGS.conventionComplement)
      }
      documentTagSets.push(AJ_TEMPLATE_TAGS.attestationFinMission)
      for (const tagSet of documentTagSets) {
        const template = findTemplateByTags(templates, tagSet)
        if (!template) {
          warnings.push(
            `Modèle AJ (${tagSet.join(', ')}) introuvable : importez-le depuis la bibliothèque de modèles.`
          )
          continue
        }
        const uuid = await generateAjDocument(input.dossierId, template.id, warnings)
        if (uuid) {
          documentUuids.push(uuid)
        }
      }

      // 5. Échéances / alertes automatiques.
      const keyDateIds: string[] = []
      const todayIso = now().toISOString().slice(0, 10)
      const plusDays = (days: number): string => {
        const base = new Date(`${todayIso}T00:00:00.000Z`)
        base.setUTCDate(base.getUTCDate() + days)
        return base.toISOString().slice(0, 10)
      }
      const deadlines: Array<{ label: string; date: string; tags: KeyDate['tags'] }> = [
        { label: 'AJ — dépôt de la demande / désignation', date: plusDays(7), tags: ['important'] },
        {
          label: 'AJ — attestation de fin de mission',
          date: plusDays(60),
          tags: ['to_do']
        },
        {
          label: 'AJ — recouvrement de la rétribution (CARPA)',
          date: plusDays(90),
          tags: ['imperative']
        }
      ]
      for (const deadline of deadlines) {
        try {
          const before = idsOf(
            (await dossierService.getDossier({ dossierId: input.dossierId })).keyDates
          )
          const after = await dossierService.upsertKeyDate({
            dossierId: input.dossierId,
            label: deadline.label,
            date: deadline.date,
            tags: deadline.tags
          })
          const created = findNew(before, after.keyDates)
          if (created) {
            keyDateIds.push(created.id)
          }
        } catch (error) {
          warnings.push(
            `Échéance « ${deadline.label} » non créée : ${
              error instanceof Error ? error.message : 'erreur inconnue'
            }`
          )
        }
      }

      // 6. Marque l'orchestration comme effectuée (idempotence).
      const updatedLegalAid: DossierLegalAid = { ...legalAid, autoSetupDone: true }
      await dossierService.updateDossier({
        id: dossier.id,
        status: dossier.status,
        type: dossier.type,
        information: dossier.information,
        juridiction: dossier.juridiction,
        tribunal: dossier.tribunal,
        legalAid: updatedLegalAid
      })

      return {
        feeAgreementId: feeAgreement.id,
        billingItemIds,
        invoiceIds,
        invoiceNumbers,
        documentUuids,
        keyDateIds,
        warnings
      }
    }
  }
}
