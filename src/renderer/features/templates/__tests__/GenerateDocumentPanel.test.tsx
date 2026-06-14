// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  IpcErrorCode,
  type ContactRecord,
  type DossierDetail,
  type DossierSummary,
  type IpcResult,
  type OrdicabAPI,
  type TemplateRecord
} from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'
import { useContactStore, useDossierStore, useTemplateStore } from '@renderer/stores'

import { GenerateDocumentPanel } from '../GenerateDocumentPanel'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

function createTemplate(overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    uuid: 'tpl-1',
    name: 'Convocation',
    macros: [],
    hasDocxSource: false,
    updatedAt: '2026-03-15T12:00:00.000Z',
    ...overrides
  }
}

function createDossier(overrides: Partial<DossierSummary> = {}): DossierSummary {
  return {
    slug: 'dos-1',
    uuid: 'uuid-dos-1',
    name: 'Client Alpha',
    status: 'active',
    type: 'Civil litigation',
    updatedAt: '2026-03-15T12:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null,
    ...overrides
  }
}

function createContact(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    uuid: 'contact-1',
    dossierId: 'dos-1',
    displayName: 'Tribunal judiciaire de Paris',
    title: undefined,
    firstName: undefined,
    lastName: undefined,
    gender: undefined,
    role: 'Juridiction',
    institution: 'Tribunal judiciaire de Paris',
    addressLine: undefined,
    addressLine2: undefined,
    zipCode: undefined,
    city: undefined,
    country: undefined,
    phone: undefined,
    email: undefined,
    information: undefined,
    customFields: {
      additionalFirstNames: '',
      dateOfBirth: '',
      countryOfBirth: '',
      nationality: '',
      occupation: '',
      socialSecurityNumber: '',
      maidenName: ''
    },
    ...overrides
  }
}

async function renderPanel({ dossierId = 'dos-1' }: { dossierId?: string } = {}): Promise<void> {
  const i18n = await createRendererI18n('en')

  render(
    <I18nextProvider i18n={i18n}>
      <GenerateDocumentPanel dossierId={dossierId} />
    </I18nextProvider>
  )
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useTemplateStore.setState(useTemplateStore.getInitialState(), true)
  useDossierStore.setState(useDossierStore.getInitialState(), true)
  useContactStore.setState(useContactStore.getInitialState(), true)
  useTemplateStore.setState({ templates: [createTemplate()] })
  useDossierStore.setState({ dossiers: [createDossier()] })
  delete (globalThis as MutableGlobal).ordicabAPI
})

function createApi(overrides: Partial<OrdicabAPI['generate']> = {}): OrdicabAPI {
  return {
    dossier: {
      list: vi.fn(async () => ({ success: true as const, data: [createDossier()] })),
      get: vi.fn(async () => ({
        success: true as const,
        data: {
          ...createDossier(),
          registeredAt: '2026-03-15T12:00:00.000Z',
          uuid: 'dossier-uuid-1',
          feeAgreements: [],
          billingItems: [],
          keyDates: [],
          keyReferences: [],
          documents: []
        }
      }))
    },
    contact: {
      list: vi.fn(async () => ({ success: true as const, data: [] })),
      upsert: vi.fn(async () => ({ success: true as const, data: undefined })),
      delete: vi.fn(async () => ({ success: true as const, data: undefined }))
    },
    template: {
      list: vi.fn(async () => ({
        success: true as const,
        data: useTemplateStore.getState().templates
      })),
      getContent: vi.fn(async () => ({ success: true as const, data: '' })),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      pickDocxFile: vi.fn(),
      importDocx: vi.fn(),
      openDocx: vi.fn(),
      removeDocx: vi.fn(),
      applyCabinetDefaultDocx: vi.fn(),
      onDocxSynced: vi.fn(() => () => undefined)
    },
    generate: {
      document: vi.fn(async () => ({
        success: true as const,
        data: {
          outputPath: '/tmp/Client Alpha/Convocation-2026-03-15.txt'
        }
      })),
      preview: vi.fn(async () => ({
        success: true as const,
        data: {
          draftHtml: '<p>Draft body</p>',
          suggestedFilename: 'Convocation-2026-03-15',
          unresolvedTags: ['entity.firmName'],
          resolvedTags: { 'dossier.name': 'Client Alpha' }
        }
      })),
      save: vi.fn(async () => ({
        success: true as const,
        data: {
          outputPath: '/tmp/Client Alpha/Convocation-2026-03-15.docx'
        }
      })),
      previewDocx: vi.fn(async () => ({
        success: true as const,
        data: {
          tagPaths: ['dossier.name'],
          resolvedTags: { 'dossier.name': 'Client Alpha' },
          suggestedFilename: 'Audience note-2026-03-15',
          htmlPreview: ''
        }
      })),
      selectOutputPath: vi.fn(async () => ({
        success: true as const,
        data: null
      })),
      ...overrides
    }
  } as unknown as OrdicabAPI
}

describe('GenerateDocumentPanel', () => {
  it('requires template selection before building the draft', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = createApi()

    await renderPanel()

    const button = screen.getByRole('button', { name: 'Continue' })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Convocation/ }))

    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('builds a preview draft for a text template', async () => {
    const preview = vi.fn(async () => ({
      success: true as const,
      data: {
        draftHtml: '<p>Draft body</p>',
        suggestedFilename: 'Convocation-2026-03-15',
        unresolvedTags: ['entity.firmName'],
        resolvedTags: {}
      }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = createApi({
      preview
    })

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /Convocation/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          'Review and adjust the tag values extracted from the template, then build the draft.'
        )
      ).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(preview).toHaveBeenLastCalledWith({
        dossierId: 'dos-1',
        templateUuid: 'tpl-1',
        tagOverrides: { 'entity.firmName': '' },
        primaryContactUuid: undefined,
        contactRoleOverrides: undefined
      })
      expect(screen.getByText('Unresolved fields')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Save Document' })).toBeTruthy()
      expect(screen.getByLabelText('Filename')).toBeTruthy()
    })
  })

  it('shows the layout-preserved hint for docx-sourced templates', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = createApi()
    useTemplateStore.setState({
      templates: [createTemplate({ hasDocxSource: true })]
    })

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /Convocation/ }))

    expect(screen.getByText('DOCX')).toBeTruthy()
  })

  it('generates docx-sourced template through tags reconciliation then save step', async () => {
    const document = vi.fn(async () => ({
      success: true as const,
      data: { outputPath: '/tmp/Client Alpha/Audience note-2026-03-15.docx' }
    }))
    const previewDocx = vi.fn(async () => ({
      success: true as const,
      data: {
        tagPaths: ['dossier.name'],
        resolvedTags: { 'dossier.name': 'Client Alpha' },
        suggestedFilename: 'Audience note-2026-03-15',
        htmlPreview: ''
      }
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = createApi({ document, previewDocx })
    useTemplateStore.setState({
      templates: [createTemplate({ hasDocxSource: true, name: 'Audience note' })]
    })

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /Audience note/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Should call previewDocx (not preview) and navigate to tags step
    await waitFor(() => {
      expect(previewDocx).toHaveBeenCalledWith({ dossierId: 'dos-1', templateUuid: 'tpl-1' })
      expect(
        screen.getByText(
          'Review and adjust the tag values extracted from the template, then build the draft.'
        )
      ).toBeTruthy()
    })

    // Proceed through tags step to docx-save step
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Filename')).toBeTruthy()
    })

    // Save the document
    fireEvent.click(screen.getByRole('button', { name: 'Save Document' }))

    await waitFor(() => {
      expect(document).toHaveBeenCalled()
      expect(screen.getByRole('status').textContent).toContain('Audience note-2026-03-15.docx')
    })
  })

  it('shows no DOCX badge for text-only templates and enables Next on template selection', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = createApi()

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /Convocation/ }))

    expect(screen.queryByText('DOCX')).toBeNull()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })

  it('waits for dossier detail to load before opening the tags step', async () => {
    const preview = vi.fn(async () => ({
      success: true as const,
      data: {
        draftHtml: '<p>Draft body</p>',
        suggestedFilename: 'Convocation-2026-03-15',
        unresolvedTags: ['dossier.keyDate.hearing'],
        resolvedTags: {}
      }
    }))

    useDossierStore.setState({
      activeDossier: {
        ...createDossier({ slug: 'other-dossier', name: 'Stale dossier' }),
        registeredAt: '2026-03-15T12:00:00.000Z',
        uuid: 'stale-dossier-uuid',
        feeAgreements: [],
        billingItems: [],
        keyDates: [
          { uuid: 'kd-stale', dossierId: 'other-dossier', label: 'Old hearing', date: '2026-02-01' }
        ],
        keyReferences: [],
        notes: []
      }
    })

    const api = createApi({
      preview
    })
    ;(globalThis as MutableGlobal).ordicabAPI = api

    let resolveDossierGet!: (value: IpcResult<DossierDetail>) => void
    const dossierGetPromise = new Promise<IpcResult<DossierDetail>>((resolve) => {
      resolveDossierGet = resolve
    })

    api.dossier.get = async () => dossierGetPromise

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /Convocation/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Generating...' }) as HTMLButtonElement
      ).toHaveProperty('disabled', true)
    })

    expect(preview).not.toHaveBeenCalled()
    expect(
      screen.queryByText(
        'Review and adjust the tag values extracted from the template, then build the draft.'
      )
    ).toBeNull()

    resolveDossierGet({
      success: true as const,
      data: {
        ...createDossier(),
        registeredAt: '2026-03-15T12:00:00.000Z',
        uuid: 'dossier-uuid-1',
        feeAgreements: [],
        billingItems: [],
        keyDates: [
          { uuid: 'kd-1', dossierId: 'dos-1', label: 'Fresh hearing', date: '2026-04-01' }
        ],
        keyReferences: [],
        notes: []
      }
    })

    await waitFor(() => {
      expect(preview).toHaveBeenCalledWith({
        dossierId: 'dos-1',
        templateUuid: 'tpl-1'
      })
      expect(
        screen.getByText(
          'Review and adjust the tag values extracted from the template, then build the draft.'
        )
      ).toBeTruthy()
    })
  })

  it('hydrates role-based contact tag values from the auto-selected dossier contact', async () => {
    const preview = vi.fn(async () => ({
      success: true as const,
      data: {
        draftHtml: '<p>Draft body</p>',
        suggestedFilename: 'Convocation-2026-03-15',
        unresolvedTags: ['contact.juridiction.institution', 'contact.juridiction.phone'],
        resolvedTags: {}
      }
    }))

    const api = createApi({ preview })
    api.contact.list = vi.fn(async () => ({
      success: true as const,
      data: [createContact()]
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = api

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /Convocation/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          'Review and adjust the tag values extracted from the template, then build the draft.'
        )
      ).toBeTruthy()
      expect(screen.getByDisplayValue('Tribunal judiciaire de Paris')).toBeTruthy()
    })
  })

  it('shows the missing docx source error returned by the previewDocx flow', async () => {
    const previewDocx = vi.fn(async () => ({
      success: false as const,
      error: 'Word source file not found. Re-import the .docx source in the template editor.',
      code: IpcErrorCode.NOT_FOUND
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = createApi({ previewDocx })
    useTemplateStore.setState({
      templates: [createTemplate({ hasDocxSource: true })]
    })

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /Convocation/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          'Word source file not found. Re-import the .docx source in the template editor.'
        )
      ).toBeTruthy()
    })
  })
})
