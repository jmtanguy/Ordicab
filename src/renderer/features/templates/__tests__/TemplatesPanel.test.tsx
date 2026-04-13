// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DossierSummary, OrdicabAPI, TemplateRecord } from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'
import { ToastProvider } from '@renderer/contexts/ToastContext'
import { useDossierStore, useTemplateStore } from '@renderer/stores'

vi.mock('../RichTextEditor', () => ({
  RichTextEditor: ({
    ariaLabel,
    value,
    onChange,
    tagInsertRef
  }: {
    ariaLabel: string
    value: string
    onChange: (value: string) => void
    tagInsertRef?: React.MutableRefObject<((tagPath: string) => void) | null>
  }) => {
    if (tagInsertRef) {
      tagInsertRef.current = (tagPath: string) =>
        onChange(`${value}<span data-template-tag-path="${tagPath}">{{${tagPath}}}</span>`)
    }
    return (
      <div>
        <textarea
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {tagInsertRef ? (
          <button
            type="button"
            data-testid="mock-insert-tag"
            onClick={() => tagInsertRef.current?.('dossier.name')}
          />
        ) : null}
      </div>
    )
  }
}))

import { TemplatesPanel } from '../TemplatesPanel'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

function createTemplate(overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    id: 'tpl-1',
    name: 'Courrier client',
    macros: ['dossier.name'],
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

async function renderPanel(): Promise<void> {
  const i18n = await createRendererI18n('en')

  render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <TemplatesPanel domainPath="/tmp/domain" />
      </ToastProvider>
    </I18nextProvider>
  )
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useTemplateStore.setState(useTemplateStore.getInitialState(), true)
  useDossierStore.setState(useDossierStore.getInitialState(), true)
  delete (globalThis as MutableGlobal).ordicabAPI
})

function createApi(overrides: Partial<OrdicabAPI> = {}): OrdicabAPI {
  return {
    template: {
      list: vi.fn(async () => ({ success: true as const, data: [createTemplate()] })),
      getContent: vi.fn(async () => ({ success: true as const, data: '<p>Stored content</p>' })),
      create: vi.fn(async () => ({
        success: true as const,
        data: createTemplate({
          id: 'tpl-2',
          name: 'New template'
        })
      })),
      update: vi.fn(async (input) => ({
        success: true as const,
        data: {
          ...createTemplate(),
          ...input,
          updatedAt: '2026-03-16T09:00:00.000Z'
        }
      })),
      delete: vi.fn(async () => ({ success: true as const, data: null })),
      importDocx: vi.fn(async () => ({
        success: true as const,
        data: createTemplate({ hasDocxSource: true })
      })),
      openDocx: vi.fn(async () => ({ success: true as const, data: null })),
      removeDocx: vi.fn(async () => ({
        success: true as const,
        data: createTemplate({ hasDocxSource: false })
      })),
      onDocxSynced: vi.fn(() => () => undefined)
    },
    dossier: {
      list: vi.fn(async () => ({ success: true as const, data: [createDossier()] }))
    },
    entity: {
      get: vi.fn(async () => ({ success: true as const, data: null })),
      save: vi.fn(async () => ({ success: true as const, data: null }))
    },
    contact: {
      list: vi.fn(async () => ({ success: true as const, data: [] })),
      upsert: vi.fn(async () => ({ success: true as const, data: null })),
      delete: vi.fn(async () => ({ success: true as const, data: null }))
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
          unresolvedTags: []
        }
      })),
      save: vi.fn(async () => ({
        success: true as const,
        data: {
          outputPath: '/tmp/Client Alpha/Convocation-2026-03-15.txt'
        }
      }))
    },
    ...overrides
  } as unknown as OrdicabAPI
}

describe('TemplatesPanel', () => {
  it('renders the library and navigates into create, edit, and generate subscreens', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = createApi()

    await renderPanel()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Generate a document from template Courrier client' })
      ).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'New Template' }))
    await waitFor(() => {
      expect(screen.getByText('Choose template type')).toBeTruthy()
      expect(screen.getByText('Rich text template')).toBeTruthy()
      expect(screen.getByText('Word (.docx) template')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /Rich text template/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save Template' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Back to library' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Back to library' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit template Courrier client' }))
    await waitFor(() => {
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Courrier client')
      expect((screen.getByLabelText('Content') as HTMLTextAreaElement).value).toBe(
        '<p>Stored content</p>'
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate a document from template Courrier client' })
    )
    await waitFor(() => {
      expect(
        screen.getByText(
          'Choose a dossier, pick a template, then either generate immediately or review the draft before saving.'
        )
      ).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Courrier client' })).toBeTruthy()
    })
  })

  it('creates a template, returns to the library, and shows a success notice', async () => {
    const create = vi.fn(async () => ({
      success: true as const,
      data: createTemplate({
        id: 'tpl-2',
        name: 'New template'
      })
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = createApi({
      template: {
        ...createApi().template,
        create
      } as OrdicabAPI['template']
    })

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'New Template' }))
    fireEvent.click(screen.getByRole('button', { name: /Rich text template/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New template' } })
    fireEvent.click(screen.getByTestId('mock-insert-tag'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }))

    await waitFor(() => {
      expect(create).toHaveBeenCalled()
      expect(screen.getByRole('region').textContent).toContain('Template created.')
    })
  })

  it('opens the dedicated Word-template creation flow before import', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = createApi()

    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'New Template' }))
    fireEvent.click(screen.getByRole('button', { name: /Word \(\.docx\) template/ }))

    await waitFor(() => {
      expect(screen.getByText('Create Word template')).toBeTruthy()
      expect(screen.getAllByRole('button', { name: 'Import .docx source' })).toHaveLength(2)
      expect(screen.queryByLabelText('Content')).toBeNull()
    })
  })

  it('waits for template html before mounting the edit form', async () => {
    let resolveGetContent!: (value: { success: true; data: string }) => void
    const getContent = vi.fn(
      () =>
        new Promise<{ success: true; data: string }>((resolve) => {
          resolveGetContent = resolve
        })
    )

    ;(globalThis as MutableGlobal).ordicabAPI = createApi({
      template: {
        ...createApi().template,
        getContent
      } as OrdicabAPI['template']
    })

    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit template Courrier client' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit template Courrier client' }))

    expect(screen.getByText('Loading templates...')).toBeTruthy()
    expect(screen.queryByLabelText('Content')).toBeNull()

    resolveGetContent({ success: true, data: '<p>Loaded later</p>' })

    await waitFor(() => {
      expect((screen.getByLabelText('Content') as HTMLTextAreaElement).value).toBe(
        '<p>Loaded later</p>'
      )
    })
  })
})
