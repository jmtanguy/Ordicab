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
    id: 'tpl-1',
    name: 'Convocation',
    macros: [],
    hasDocxSource: false,
    updatedAt: '2026-03-15T12:00:00.000Z',
    ...overrides
  }
}

function createDossier(overrides: Partial<DossierSummary> = {}): DossierSummary {
  return {
    id: 'dos-1',
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

async function renderPanel(): Promise<void> {
  const i18n = await createRendererI18n('en')

  render(
    <I18nextProvider i18n={i18n}>
      <GenerateDocumentPanel />
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
  it('requires dossier and template selection before building the draft', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = createApi()

    await renderPanel()

    const button = screen.getByRole('button', { name: 'Next' })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Convocation' }))
    fireEvent.click(screen.getByRole('button', { name: /Client Alpha/ }))

    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('builds a preview draft and saves the adjusted document', async () => {
    const preview = vi.fn(async () => ({
      success: true as const,
      data: {
        draftHtml: '<p>Draft body</p>',
        suggestedFilename: 'Convocation-2026-03-15',
        unresolvedTags: ['entity.firmName'],
        resolvedTags: {}
      }
    }))
    const save = vi.fn(async () => ({
      success: true as const,
      data: {
        outputPath: '/tmp/Client Alpha/Convocation-2026-03-15.docx'
      }
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = createApi({
      preview,
      save
    })

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Convocation' }))
    fireEvent.click(screen.getByRole('button', { name: /Client Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Build Draft' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Build Draft' }))

    await waitFor(() => {
      expect(preview).toHaveBeenCalledWith({
        dossierId: 'dos-1',
        templateId: 'tpl-1',
        contactRoleOverrides: undefined
      })
      expect(screen.getByText('Unresolved fields')).toBeTruthy()
      expect(screen.getByDisplayValue('Convocation-2026-03-15')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('Filename'), {
      target: { value: 'Convocation-final' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Document' }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        dossierId: 'dos-1',
        filename: 'Convocation-final',
        format: 'docx',
        html: expect.stringContaining('Draft body')
      })
      expect(screen.getByRole('status').textContent).toContain(
        'Document generated -> Convocation-2026-03-15.docx'
      )
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
    fireEvent.click(screen.getByRole('button', { name: /Client Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    // Should call previewDocx (not preview) and navigate to tags step
    await waitFor(() => {
      expect(previewDocx).toHaveBeenCalledWith({ dossierId: 'dos-1', templateId: 'tpl-1' })
      expect(
        screen.getByText(
          'Review and adjust the tag values extracted from the template, then build the draft.'
        )
      ).toBeTruthy()
    })

    // Proceed through tags step to docx-save step
    fireEvent.click(screen.getByRole('button', { name: 'Build Draft' }))

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

  it('shows the standard docx hint for text-only templates', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = createApi()

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Convocation' }))

    expect(screen.queryByText('DOCX')).toBeNull()
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
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
        ...createDossier({ id: 'other-dossier', name: 'Stale dossier' }),
        registeredAt: '2026-03-15T12:00:00.000Z',
        uuid: 'stale-dossier-uuid',
        keyDates: [
          { id: 'kd-stale', dossierId: 'other-dossier', label: 'Old hearing', date: '2026-02-01' }
        ],
        keyReferences: []
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

    fireEvent.click(screen.getByRole('button', { name: 'Convocation' }))
    fireEvent.click(screen.getByRole('button', { name: /Client Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Generating...' }) as HTMLButtonElement
      ).toHaveProperty('disabled', true)
    })

    expect(preview).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Build Draft' })).toBeNull()

    resolveDossierGet({
      success: true as const,
      data: {
        ...createDossier(),
        registeredAt: '2026-03-15T12:00:00.000Z',
        uuid: 'dossier-uuid-1',
        keyDates: [{ id: 'kd-1', dossierId: 'dos-1', label: 'Fresh hearing', date: '2026-04-01' }],
        keyReferences: []
      }
    })

    await waitFor(() => {
      expect(preview).toHaveBeenCalledWith({
        dossierId: 'dos-1',
        templateId: 'tpl-1'
      })
      expect(screen.getByRole('button', { name: 'Build Draft' })).toBeTruthy()
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

    fireEvent.click(screen.getByRole('button', { name: 'Convocation' }))
    fireEvent.click(screen.getByRole('button', { name: /Client Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Build Draft' })).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: /Client Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          'Word source file not found. Re-import the .docx source in the template editor.'
        )
      ).toBeTruthy()
    })
  })
})
