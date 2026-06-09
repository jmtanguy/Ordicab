import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  ContactRecord,
  DossierBillingItem,
  DossierDetail,
  DossierSummary,
  GeneratedDocumentResult,
  GenerateDocumentInput,
  InvoiceCreateInput
} from '@shared/types'

import type { EntityProfile } from '@shared/domain/entity'

import { createInvoiceService } from '../invoiceService'
import type { DossierRegistryService } from '../dossierRegistryService'
import type { GenerateService } from '../generateService'
import type { ContactService } from '../contactService'
import type { EntityService } from '../entityService'

function createEntityServiceMock(profile: EntityProfile | null): EntityService {
  return {
    get: async () => profile,
    update: async () => profile ?? ({ firmName: '' } as EntityProfile),
    importDefaultTemplate: async () => profile ?? ({ firmName: '' } as EntityProfile),
    getDefaultTemplatePath: async () => '',
    removeDefaultTemplate: async () => profile ?? ({ firmName: '' } as EntityProfile)
  }
}

const TEST_ENTITY_PROFILE: EntityProfile = {
  firmName: 'Cabinet Test',
  siren: '123456789',
  siret: '12345678900012',
  vatNumber: 'FR12345678901',
  iban: 'FR7630006000011234567890189',
  addressLine: '1 rue de la Paix',
  zipCode: '75002',
  city: 'Paris'
}

const tempDirs: string[] = []
async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-invoice-'))
  tempDirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

interface MockState {
  dossier: DossierDetail
  generateCalls: GenerateDocumentInput[]
  registryMarkCalls: Array<{
    dossierId: string
    billingItemIds: string[]
    invoiceId: string
    invoiceNumber: string
  }>
  registryUnmarkCalls: Array<{ dossierId: string; invoiceId: string }>
}

function makeBillingItem(overrides: Partial<DossierBillingItem> = {}): DossierBillingItem {
  return {
    id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
    dossierId: overrides.dossierId ?? 'dossier-1',
    date: '2026-05-01',
    label: 'Prestation A',
    quantity: 1,
    quantityUnit: 'units',
    unitPriceHtCents: 10_000,
    subtotalHtCents: 10_000,
    discountHtCents: 0,
    totalHtCents: 10_000,
    vatRateBasisPoints: 2000,
    totalTtcCents: 12_000,
    status: 'draft',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides
  }
}

function makeDossier(items: DossierBillingItem[]): DossierDetail {
  return {
    id: 'dossier-1',
    uuid: 'dossier-1-uuid',
    name: 'Dossier Test',
    status: 'active',
    type: 'general',
    updatedAt: '2026-05-01T00:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null,
    registeredAt: '2026-01-01T00:00:00.000Z',
    feeAgreements: [],
    billingItems: items,
    keyDates: [],
    keyReferences: [],
    documents: []
  } as unknown as DossierDetail
}

function buildMocks(
  domainPath: string,
  items: DossierBillingItem[]
): {
  state: MockState
  invoiceService: ReturnType<typeof createInvoiceService>
} {
  const state: MockState = {
    dossier: makeDossier(items),
    generateCalls: [],
    registryMarkCalls: [],
    registryUnmarkCalls: []
  }

  const dossierRegistryService: DossierRegistryService = {
    listEligibleFolders: async () => [],
    listRegisteredDossiers: async () =>
      [{ id: state.dossier.id, name: state.dossier.name }] as unknown as DossierSummary[],
    getDossier: async () => state.dossier,
    openDossier: async () => state.dossier,
    registerDossier: async () => ({ id: state.dossier.id }) as unknown as DossierSummary,
    createDossier: async () => ({ id: state.dossier.id }) as unknown as DossierSummary,
    unregisterDossier: async () => null,
    updateDossier: async () => state.dossier,
    updateLegalAid: async () => state.dossier,
    upsertKeyDate: async () => state.dossier,
    deleteKeyDate: async () => state.dossier,
    upsertFeeAgreement: async () => state.dossier,
    deleteFeeAgreement: async () => state.dossier,
    archiveFeeAgreement: async () => state.dossier,
    setActiveFeeAgreement: async () => state.dossier,
    upsertBillingItem: async () => state.dossier,
    deleteBillingItem: async () => state.dossier,
    upsertNote: async () => state.dossier,
    deleteNote: async () => state.dossier,
    searchNotes: async () => [],
    markBillingItemsInvoiced: async (input) => {
      state.registryMarkCalls.push(input)
      state.dossier = {
        ...state.dossier,
        billingItems: state.dossier.billingItems.map((item) =>
          input.billingItemIds.includes(item.id)
            ? {
                ...item,
                status: 'billed' as const,
                invoiceId: input.invoiceId,
                invoiceNumber: input.invoiceNumber
              }
            : item
        )
      }
      return state.dossier
    },
    unmarkBillingItemsInvoiced: async (input) => {
      state.registryUnmarkCalls.push(input)
      state.dossier = {
        ...state.dossier,
        billingItems: state.dossier.billingItems.map((item) =>
          item.invoiceId === input.invoiceId
            ? { ...item, status: 'draft' as const, invoiceId: undefined, invoiceNumber: undefined }
            : item
        )
      }
      return state.dossier
    },
    upsertKeyReference: async () => state.dossier,
    deleteKeyReference: async () => state.dossier
  }

  const generateService: GenerateService = {
    generateDocument: async (input): Promise<GeneratedDocumentResult> => {
      state.generateCalls.push(input)
      return {
        outputPath: input.outputPath ?? join(domainPath, `${input.filename ?? 'doc'}.docx`),
        documentUuid: 'doc-uuid'
      }
    },
    previewDocument: async () => ({
      draftHtml: '',
      suggestedFilename: '',
      unresolvedTags: [],
      resolvedTags: {}
    }),
    previewDocxDocument: async () => ({
      tagPaths: [],
      resolvedTags: {},
      suggestedFilename: '',
      htmlPreview: ''
    }),
    saveGeneratedDocument: async (input) => ({ outputPath: input.outputPath ?? '' })
  }

  const contactService: ContactService = {
    list: async () => [] as ContactRecord[],
    upsert: async () => ({ uuid: 'c1' }) as unknown as ContactRecord,
    delete: async () => undefined
  }

  const invoiceService = createInvoiceService({
    domainService: {
      getStatus: async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 1
      })
    },
    dossierRegistryService,
    generateService,
    contactService,
    entityService: createEntityServiceMock(TEST_ENTITY_PROFILE),
    now: () => new Date('2026-05-23T10:00:00.000Z')
  })

  return { state, invoiceService }
}

describe('invoiceService', () => {
  let domainPath: string
  beforeEach(async () => {
    domainPath = await createTempDir()
  })

  describe('getSettings()', () => {
    it('returns default settings when none stored', async () => {
      const { invoiceService } = buildMocks(domainPath, [])
      const settings = await invoiceService.getSettings()
      expect(settings.numberPattern).toBe('FAC-{YYYY}-{SEQ}')
      expect(settings.nextSequence).toBe(1)
      expect(settings.sequencePadding).toBe(4)
    })
  })

  describe('create()', () => {
    const billingItemId = '11111111-1111-4111-8111-111111111111'

    function createInput(): InvoiceCreateInput {
      return {
        dossierId: 'dossier-1',
        billingItemIds: [billingItemId],
        templateId: 'tpl-1',
        issuedAt: '2026-05-23'
      }
    }

    it('creates an invoice, marks items as billed, increments sequence', async () => {
      const { state, invoiceService } = buildMocks(domainPath, [
        makeBillingItem({ id: billingItemId })
      ])
      const invoice = await invoiceService.create(createInput())

      expect(invoice.number).toBe('FAC-2026-0001')
      expect(invoice.totalHtCents).toBe(10_000)
      expect(invoice.totalTtcCents).toBe(12_000)
      expect(invoice.totalVatCents).toBe(2_000)
      expect(invoice.status).toBe('issued')

      // Generate was called with invoiceContext
      expect(state.generateCalls).toHaveLength(1)
      expect(state.generateCalls[0]?.invoiceContext?.number).toBe('FAC-2026-0001')
      expect(state.generateCalls[0]?.outputPath).toBe(
        join(domainPath, '.ordicab', 'invoices', 'FAC-2026-0001.docx')
      )
      expect(invoice.generatedDocumentPath).toBe('.ordicab/invoices/FAC-2026-0001.docx')

      // Issuer identity is sourced from the Cabinet entity profile, not invoice settings.
      expect(invoice.issuerSnapshot?.name).toBe('Cabinet Test')
      expect(invoice.issuerSnapshot?.siret).toBe('12345678900012')
      expect(invoice.issuerSnapshot?.vatNumber).toBe('FR12345678901')
      expect(invoice.issuerSnapshot?.iban).toBe('FR7630006000011234567890189')
      expect(invoice.issuerSnapshot?.address).toBe('1 rue de la Paix\n75002 Paris')
      expect(state.generateCalls[0]?.invoiceContext?.issuer?.name).toBe('Cabinet Test')

      // Items marked as billed via registry
      expect(state.registryMarkCalls).toHaveLength(1)
      expect(state.registryMarkCalls[0]?.invoiceNumber).toBe('FAC-2026-0001')

      // Sequence incremented
      const settings = await invoiceService.getSettings()
      expect(settings.nextSequence).toBe(2)
    })

    it('rejects when a billing item is already billed', async () => {
      const { invoiceService } = buildMocks(domainPath, [
        makeBillingItem({ id: billingItemId, status: 'billed' })
      ])
      await expect(invoiceService.create(createInput())).rejects.toMatchObject({
        message: expect.stringContaining('already')
      })
    })

    it('rejects when a billing item is unknown', async () => {
      const { invoiceService } = buildMocks(domainPath, [makeBillingItem({ id: billingItemId })])
      await expect(
        invoiceService.create({
          ...createInput(),
          billingItemIds: ['22222222-2222-4222-8222-222222222222']
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining('not found')
      })
    })

    it('serializes concurrent creates so each gets a distinct number', async () => {
      const { state, invoiceService } = buildMocks(domainPath, [
        makeBillingItem({ id: billingItemId }),
        makeBillingItem({
          id: '22222222-2222-4222-8222-222222222222',
          label: 'Prestation B'
        })
      ])
      const [a, b] = await Promise.all([
        invoiceService.create(createInput()),
        invoiceService.create({
          ...createInput(),
          billingItemIds: ['22222222-2222-4222-8222-222222222222']
        })
      ])
      expect(new Set([a.number, b.number]).size).toBe(2)
      expect([a.number, b.number].sort()).toEqual(['FAC-2026-0001', 'FAC-2026-0002'])
      expect(state.registryMarkCalls).toHaveLength(2)
    })

    it('persists the registered template when rememberTemplateAsDefault is true', async () => {
      const { invoiceService } = buildMocks(domainPath, [makeBillingItem({ id: billingItemId })])
      await invoiceService.create({ ...createInput(), rememberTemplateAsDefault: true })
      const settings = await invoiceService.getSettings()
      expect(settings.defaultTemplateId).toBe('tpl-1')
    })

    it('writes the invoice record to disk', async () => {
      const { invoiceService } = buildMocks(domainPath, [makeBillingItem({ id: billingItemId })])
      const invoice = await invoiceService.create(createInput())
      const recordPath = join(domainPath, '.ordicab', 'invoice-records', `${invoice.id}.json`)
      const raw = await readFile(recordPath, 'utf8')
      const parsed = JSON.parse(raw) as { number: string }
      expect(parsed.number).toBe('FAC-2026-0001')
    })

    it('emits a stateRetribution piece (RET-…) with its own sequence and CARPA client', async () => {
      const { invoiceService } = buildMocks(domainPath, [
        makeBillingItem({
          id: billingItemId,
          sourceFeeAgreementBillingKind: 'stateRetribution',
          vatRateBasisPoints: 0,
          totalTtcCents: 10_000
        })
      ])
      const invoice = await invoiceService.create(createInput())

      expect(invoice.documentType).toBe('stateRetribution')
      expect(invoice.number).toBe('RET-2026-0001')
      // Le débiteur affiché est la CARPA, pas le bénéficiaire de l'AJ.
      expect(invoice.clientLabel).toBe('CARPA — Aide juridictionnelle')
      // Séquence RET consommée, séquence FAC intacte.
      const settings = await invoiceService.getSettings()
      expect(settings.stateRetributionNextSequence).toBe(2)
      expect(settings.nextSequence).toBe(1)
    })

    it('keeps numbering FAC and RET sequences independent', async () => {
      const retributionId = '22222222-2222-4222-8222-222222222222'
      const { invoiceService } = buildMocks(domainPath, [
        makeBillingItem({ id: billingItemId }),
        makeBillingItem({
          id: retributionId,
          sourceFeeAgreementBillingKind: 'stateRetribution',
          vatRateBasisPoints: 0,
          totalTtcCents: 10_000
        })
      ])
      const facture = await invoiceService.create(createInput())
      const retribution = await invoiceService.create({
        dossierId: 'dossier-1',
        billingItemIds: [retributionId],
        templateId: 'tpl-1',
        issuedAt: '2026-05-23'
      })
      expect(facture.number).toBe('FAC-2026-0001')
      expect(retribution.number).toBe('RET-2026-0001')
    })

    it('refuses to mix a stateRetribution item with a commercial item on one piece', async () => {
      const retributionId = '22222222-2222-4222-8222-222222222222'
      const { invoiceService } = buildMocks(domainPath, [
        makeBillingItem({ id: billingItemId }),
        makeBillingItem({
          id: retributionId,
          sourceFeeAgreementBillingKind: 'stateRetribution',
          vatRateBasisPoints: 0,
          totalTtcCents: 10_000
        })
      ])
      await expect(
        invoiceService.create({
          dossierId: 'dossier-1',
          billingItemIds: [billingItemId, retributionId],
          templateId: 'tpl-1',
          issuedAt: '2026-05-23'
        })
      ).rejects.toMatchObject({ message: expect.stringContaining('rétribution AJ') })
    })
  })

  describe('cancel()', () => {
    const billingItemId = '11111111-1111-4111-8111-111111111111'

    it('marks invoice as cancelled without re-opening the linked billing items', async () => {
      const { state, invoiceService } = buildMocks(domainPath, [
        makeBillingItem({ id: billingItemId })
      ])
      const invoice = await invoiceService.create({
        dossierId: 'dossier-1',
        billingItemIds: [billingItemId],
        templateId: 'tpl-1',
        issuedAt: '2026-05-23'
      })
      const cancelled = await invoiceService.cancel({ invoiceId: invoice.id })
      expect(cancelled.status).toBe('cancelled')
      expect(state.registryUnmarkCalls).toEqual([])
      expect(state.dossier.billingItems[0]?.status).toBe('billed')
    })
  })

  describe('credit notes and payments', () => {
    const billingItemId = '11111111-1111-4111-8111-111111111111'

    it('creates a total credit note with a separate sequence and keeps source items billed', async () => {
      const { state, invoiceService } = buildMocks(domainPath, [
        makeBillingItem({ id: billingItemId })
      ])
      const invoice = await invoiceService.create({
        dossierId: 'dossier-1',
        billingItemIds: [billingItemId],
        templateId: 'tpl-1',
        issuedAt: '2026-05-23'
      })

      const creditNote = await invoiceService.createCreditNote({
        originalInvoiceId: invoice.id,
        templateId: 'tpl-1',
        issuedAt: '2026-05-24',
        reason: 'Correction'
      })

      expect(creditNote.documentType).toBe('creditNote')
      expect(creditNote.number).toBe('AV-2026-0001')
      expect(creditNote.totalHtCents).toBe(invoice.totalHtCents)
      expect(creditNote.totalVatCents).toBe(invoice.totalVatCents)
      expect(creditNote.originalInvoiceRefs[0]?.number).toBe(invoice.number)
      expect(state.registryUnmarkCalls).toEqual([])
      expect(state.dossier.billingItems[0]?.status).toBe('billed')

      const settings = await invoiceService.getSettings()
      expect(settings.nextSequence).toBe(2)
      expect(settings.creditNoteNextSequence).toBe(2)
    })

    it('creates a partial credit note with VAT recomputed for the credited amount', async () => {
      const { invoiceService } = buildMocks(domainPath, [makeBillingItem({ id: billingItemId })])
      const invoice = await invoiceService.create({
        dossierId: 'dossier-1',
        billingItemIds: [billingItemId],
        templateId: 'tpl-1',
        issuedAt: '2026-05-23'
      })

      const creditNote = await invoiceService.createCreditNote({
        originalInvoiceId: invoice.id,
        templateId: 'tpl-1',
        reason: 'Avoir partiel',
        lineCredits: [{ billingItemId, totalHtCents: 5_000 }]
      })

      expect(creditNote.totalHtCents).toBe(5_000)
      expect(creditNote.totalVatCents).toBe(1_000)
      expect(creditNote.totalTtcCents).toBe(6_000)
      expect(creditNote.vatBreakdown).toEqual([
        {
          vatRateBasisPoints: 2000,
          taxableHtCents: 5_000,
          vatCents: 1_000,
          totalTtcCents: 6_000
        }
      ])
    })

    it('tracks partial and full payments without mutating the invoice lines', async () => {
      const { invoiceService } = buildMocks(domainPath, [makeBillingItem({ id: billingItemId })])
      const invoice = await invoiceService.create({
        dossierId: 'dossier-1',
        billingItemIds: [billingItemId],
        templateId: 'tpl-1',
        issuedAt: '2026-05-23'
      })

      const partiallyPaid = await invoiceService.addPayment({
        invoiceId: invoice.id,
        amountCents: 4_000,
        method: 'transfer'
      })
      expect(partiallyPaid.paymentStatus).toBe('partiallyPaid')
      expect(partiallyPaid.status).toBe('partiallyPaid')
      expect(partiallyPaid.remainingAmountCents).toBe(8_000)

      const paid = await invoiceService.markPaid({ invoiceId: invoice.id })
      expect(paid.paymentStatus).toBe('paid')
      expect(paid.status).toBe('paid')
      expect(paid.paidAmountCents).toBe(12_000)
      expect(paid.payments).toHaveLength(2)
    })
  })

  describe('artifact integrity', () => {
    const billingItemId = '11111111-1111-4111-8111-111111111111'
    const DOCX_BYTES = Buffer.from('FAKE-DOCX-CONTENT-V1', 'utf8')

    function buildMocksWithRealDocx(items: DossierBillingItem[]): {
      state: MockState
      invoiceService: ReturnType<typeof createInvoiceService>
    } {
      const state: MockState = {
        dossier: makeDossier(items),
        generateCalls: [],
        registryMarkCalls: [],
        registryUnmarkCalls: []
      }
      const dossierRegistryService: DossierRegistryService = {
        listEligibleFolders: async () => [],
        listRegisteredDossiers: async () =>
          [{ id: state.dossier.id, name: state.dossier.name }] as unknown as DossierSummary[],
        getDossier: async () => state.dossier,
        openDossier: async () => state.dossier,
        registerDossier: async () => ({ id: state.dossier.id }) as unknown as DossierSummary,
        createDossier: async () => ({ id: state.dossier.id }) as unknown as DossierSummary,
        unregisterDossier: async () => null,
        updateDossier: async () => state.dossier,
        updateLegalAid: async () => state.dossier,
        upsertKeyDate: async () => state.dossier,
        deleteKeyDate: async () => state.dossier,
        upsertFeeAgreement: async () => state.dossier,
        deleteFeeAgreement: async () => state.dossier,
        archiveFeeAgreement: async () => state.dossier,
        setActiveFeeAgreement: async () => state.dossier,
        upsertBillingItem: async () => state.dossier,
        deleteBillingItem: async () => state.dossier,
        upsertNote: async () => state.dossier,
        deleteNote: async () => state.dossier,
        searchNotes: async () => [],
        markBillingItemsInvoiced: async (input) => {
          state.registryMarkCalls.push(input)
          state.dossier = {
            ...state.dossier,
            billingItems: state.dossier.billingItems.map((item) =>
              input.billingItemIds.includes(item.id)
                ? {
                    ...item,
                    status: 'billed' as const,
                    invoiceId: input.invoiceId,
                    invoiceNumber: input.invoiceNumber
                  }
                : item
            )
          }
          return state.dossier
        },
        unmarkBillingItemsInvoiced: async (input) => {
          state.registryUnmarkCalls.push(input)
          return state.dossier
        },
        upsertKeyReference: async () => state.dossier,
        deleteKeyReference: async () => state.dossier
      }
      const generateService: GenerateService = {
        generateDocument: async (input): Promise<GeneratedDocumentResult> => {
          state.generateCalls.push(input)
          const output = input.outputPath ?? join(domainPath, `${input.filename ?? 'doc'}.docx`)
          await mkdir(dirname(output), { recursive: true })
          await writeFile(output, DOCX_BYTES)
          return { outputPath: output, documentUuid: 'doc-uuid' }
        },
        previewDocument: async () => ({
          draftHtml: '',
          suggestedFilename: '',
          unresolvedTags: [],
          resolvedTags: {}
        }),
        previewDocxDocument: async () => ({
          tagPaths: [],
          resolvedTags: {},
          suggestedFilename: '',
          htmlPreview: ''
        }),
        saveGeneratedDocument: async (input) => ({ outputPath: input.outputPath ?? '' })
      }
      const contactService: ContactService = {
        list: async () => [] as ContactRecord[],
        upsert: async () => ({ uuid: 'c1' }) as unknown as ContactRecord,
        delete: async () => undefined
      }
      const invoiceService = createInvoiceService({
        domainService: {
          getStatus: async () => ({
            registeredDomainPath: domainPath,
            isAvailable: true,
            dossierCount: 1
          })
        },
        dossierRegistryService,
        generateService,
        contactService,
        entityService: createEntityServiceMock(TEST_ENTITY_PROFILE),
        now: () => new Date('2026-05-23T10:00:00.000Z')
      })
      return { state, invoiceService }
    }

    it('stores the DOCX SHA-256 in the invoice record at issuance', async () => {
      const { invoiceService } = buildMocksWithRealDocx([makeBillingItem({ id: billingItemId })])
      const invoice = await invoiceService.create({
        dossierId: 'dossier-1',
        billingItemIds: [billingItemId],
        templateId: 'tpl-1',
        issuedAt: '2026-05-23'
      })
      expect(invoice.documentHashes?.docxSha256).toBeDefined()
      // 64-char hex string
      expect(invoice.documentHashes?.docxSha256).toMatch(/^[a-f0-9]{64}$/)
    })

    it('reports DOCX integrity as "ok" when the file is untouched', async () => {
      const { invoiceService } = buildMocksWithRealDocx([makeBillingItem({ id: billingItemId })])
      const invoice = await invoiceService.create({
        dossierId: 'dossier-1',
        billingItemIds: [billingItemId],
        templateId: 'tpl-1',
        issuedAt: '2026-05-23'
      })
      const result = await invoiceService.resolveDocumentAbsolutePath(invoice.id)
      expect(result.integrity).toBe('ok')
    })

    it('reports DOCX integrity as "modified" when the file is edited after issuance', async () => {
      const { invoiceService } = buildMocksWithRealDocx([makeBillingItem({ id: billingItemId })])
      const invoice = await invoiceService.create({
        dossierId: 'dossier-1',
        billingItemIds: [billingItemId],
        templateId: 'tpl-1',
        issuedAt: '2026-05-23'
      })
      const docxPath = join(domainPath, invoice.generatedDocumentPath ?? '')
      // The freeze step marks the DOCX read-only (0o444); a tamperer would
      // restore write permission first, then overwrite.
      await chmod(docxPath, 0o644)
      await writeFile(docxPath, Buffer.from('TAMPERED-CONTENT', 'utf8'))
      const result = await invoiceService.resolveDocumentAbsolutePath(invoice.id)
      expect(result.integrity).toBe('modified')
    })

    it('reports integrity as "unknown" for legacy records without a stored hash', async () => {
      const { invoiceService } = buildMocksWithRealDocx([makeBillingItem({ id: billingItemId })])
      const invoice = await invoiceService.create({
        dossierId: 'dossier-1',
        billingItemIds: [billingItemId],
        templateId: 'tpl-1',
        issuedAt: '2026-05-23'
      })
      // Simulate a legacy invoice by stripping documentHashes from the persisted record.
      const recordPath = join(domainPath, '.ordicab', 'invoice-records', `${invoice.id}.json`)
      const record = JSON.parse(await readFile(recordPath, 'utf8'))
      delete record.documentHashes
      await writeFile(recordPath, JSON.stringify(record, null, 2))
      const result = await invoiceService.resolveDocumentAbsolutePath(invoice.id)
      expect(result.integrity).toBe('unknown')
    })
  })

  describe('updateSettings()', () => {
    it('persists new pattern and padding', async () => {
      const { invoiceService } = buildMocks(domainPath, [])
      const updated = await invoiceService.updateSettings({
        numberPattern: '{YYYY}/{SEQ}',
        sequencePadding: 3
      })
      expect(updated.numberPattern).toBe('{YYYY}/{SEQ}')
      expect(updated.sequencePadding).toBe(3)
    })
  })
})
