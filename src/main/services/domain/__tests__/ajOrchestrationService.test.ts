import { describe, expect, it } from 'vitest'

import type {
  DossierBillingItem,
  DossierDetail,
  DossierFeeAgreement,
  InvoiceRecord,
  KeyDate,
  TemplateRecord
} from '@shared/types'

import { createAjOrchestrationService } from '../ajOrchestrationService'
import type { DossierRegistryService } from '../dossierRegistryService'
import type { InvoiceService } from '../invoiceService'
import type { GenerateService } from '../generateService'
import type { TemplateService } from '../templateService'

const AJ_TEMPLATES: TemplateRecord[] = [
  {
    id: 'tpl-desig',
    name: 'Désignation',
    tags: ['aide-juridictionnelle', 'designation'],
    macros: [],
    hasDocxSource: true,
    updatedAt: ''
  },
  {
    id: 'tpl-attest',
    name: 'Attestation',
    tags: ['aide-juridictionnelle', 'attestation'],
    macros: [],
    hasDocxSource: true,
    updatedAt: ''
  },
  {
    id: 'tpl-conv',
    name: 'Convention complément',
    tags: ['aide-juridictionnelle', 'complement'],
    macros: [],
    hasDocxSource: true,
    updatedAt: ''
  },
  {
    id: 'tpl-fac-etat',
    name: 'Facture État',
    tags: ['aide-juridictionnelle', 'facture', 'etat'],
    macros: [],
    hasDocxSource: true,
    updatedAt: ''
  },
  {
    id: 'tpl-fac-comp',
    name: 'Facture complément',
    tags: ['aide-juridictionnelle', 'facture', 'complement'],
    macros: [],
    hasDocxSource: true,
    updatedAt: ''
  }
]

function makeDossier(legalAidType: 'total' | 'partial'): DossierDetail {
  return {
    id: 'dossier-1',
    name: 'Dupont c/ Société X',
    type: 'social',
    status: 'active',
    updatedAt: '2026-06-01T00:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null,
    registeredAt: '2026-06-01T00:00:00.000Z',
    legalAid: {
      status: 'granted',
      type: legalAidType,
      shareBasisPoints: legalAidType === 'partial' ? 5500 : undefined,
      stateRetributionHtCents: 108_000,
      complementHtCents: legalAidType === 'partial' ? 50_000 : undefined
    },
    feeAgreements: [],
    billingItems: [],
    keyDates: [],
    keyReferences: [],
    notes: []
  }
}

interface Harness {
  setup: ReturnType<typeof createAjOrchestrationService>
  state: { dossier: DossierDetail; invoiceCreateCalls: string[] }
}

function makeHarness(legalAidType: 'total' | 'partial', templates = AJ_TEMPLATES): Harness {
  const state = {
    dossier: makeDossier(legalAidType),
    invoiceCreateCalls: [] as string[]
  }
  let agreementSeq = 0
  let itemSeq = 0
  let keyDateSeq = 0
  let invoiceSeq = 0

  const dossierService = {
    getDossier: async () => state.dossier,
    updateDossier: async (input) => {
      state.dossier = { ...state.dossier, legalAid: input.legalAid ?? state.dossier.legalAid }
      return state.dossier
    },
    updateLegalAid: async (input) => {
      state.dossier = { ...state.dossier, legalAid: input.legalAid }
      return state.dossier
    },
    upsertFeeAgreement: async (input) => {
      const agreement = {
        id: `fa-${++agreementSeq}`,
        createdAt: '',
        updatedAt: '',
        isActive: true,
        status: input.status,
        matterLabel: input.matterLabel,
        scopeDescription: input.scopeDescription,
        billingType: input.billingType,
        vatRateBasisPoints: input.vatRateBasisPoints,
        stateRetributionHtCents: input.stateRetributionHtCents,
        complementHtCents: input.complementHtCents,
        legalAidMode: input.legalAidMode,
        legalAidType: input.legalAidType,
        legalAidVatExempt: input.legalAidVatExempt
      } as DossierFeeAgreement
      state.dossier = {
        ...state.dossier,
        feeAgreements: [...state.dossier.feeAgreements, agreement]
      }
      return state.dossier
    },
    upsertBillingItem: async (input) => {
      const item = { ...input, id: `bi-${++itemSeq}` } as unknown as DossierBillingItem
      state.dossier = {
        ...state.dossier,
        billingItems: [...state.dossier.billingItems, item]
      }
      return state.dossier
    },
    upsertKeyDate: async (input) => {
      const keyDate = { ...input, id: `kd-${++keyDateSeq}` } as unknown as KeyDate
      state.dossier = {
        ...state.dossier,
        keyDates: [...state.dossier.keyDates, keyDate]
      }
      return state.dossier
    }
  } as unknown as DossierRegistryService

  const invoiceService = {
    create: async (input) => {
      state.invoiceCreateCalls.push(input.templateId)
      return {
        id: `inv-${++invoiceSeq}`,
        number: `FAC-2026-000${invoiceSeq}`
      } as unknown as InvoiceRecord
    }
  } as unknown as InvoiceService

  const generateService = {
    generateDocument: async () => ({
      outputPath: '/tmp/doc.docx',
      documentUuid: `doc-${Math.random()}`
    })
  } as unknown as GenerateService

  const templateService = {
    list: async () => templates
  } as unknown as TemplateService

  const setup = createAjOrchestrationService({
    dossierService,
    invoiceService,
    generateService,
    templateService,
    now: () => new Date('2026-06-06T00:00:00.000Z')
  })

  return { setup, state }
}

describe('ajOrchestrationService.setupLegalAid', () => {
  it('creates one fee agreement, one State invoice, documents and deadlines for full legal aid', async () => {
    const { setup, state } = makeHarness('total')
    const result = await setup.setupLegalAid({ dossierId: 'dossier-1' })

    expect(result.feeAgreementId).toBe('fa-1')
    expect(result.billingItemIds).toHaveLength(1) // État only
    expect(result.invoiceIds).toHaveLength(1)
    expect(state.invoiceCreateCalls).toEqual(['tpl-fac-etat'])
    expect(result.documentUuids.length).toBeGreaterThanOrEqual(2) // designation + attestation
    expect(result.keyDateIds).toHaveLength(3)
    expect(state.dossier.legalAid?.autoSetupDone).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('creates two invoices (État + complément) for partial legal aid', async () => {
    const { setup, state } = makeHarness('partial')
    const result = await setup.setupLegalAid({ dossierId: 'dossier-1' })

    expect(result.billingItemIds).toHaveLength(2)
    expect(state.invoiceCreateCalls).toEqual(['tpl-fac-etat', 'tpl-fac-comp'])
    expect(result.invoiceIds).toHaveLength(2)
    expect(result.warnings).toHaveLength(0)
  })

  it('is idempotent unless force is set', async () => {
    const { setup } = makeHarness('total')
    await setup.setupLegalAid({ dossierId: 'dossier-1' })
    await expect(setup.setupLegalAid({ dossierId: 'dossier-1' })).rejects.toThrow()
    // With force, it runs again.
    const forced = await setup.setupLegalAid({ dossierId: 'dossier-1', force: true })
    expect(forced.feeAgreementId).toBeTruthy()
  })

  it('throws when legal aid is not granted', async () => {
    const { setup, state } = makeHarness('total')
    state.dossier = { ...state.dossier, legalAid: { status: 'requested' } }
    await expect(setup.setupLegalAid({ dossierId: 'dossier-1' })).rejects.toThrow()
  })

  it('warns (does not throw) when invoice templates are missing', async () => {
    const { setup, state } = makeHarness('total', [])
    const result = await setup.setupLegalAid({ dossierId: 'dossier-1' })
    expect(state.invoiceCreateCalls).toHaveLength(0)
    expect(result.invoiceIds).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
