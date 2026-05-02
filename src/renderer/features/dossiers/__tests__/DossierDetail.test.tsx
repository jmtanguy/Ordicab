// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { createRendererI18n } from '@renderer/i18n'
import { ToastProvider } from '@renderer/contexts/ToastContext'

import { DossierDetail } from '../DossierDetail'

describe('DossierDetail', () => {
  it('shows dossier information in the information section and submits long-form edits', async () => {
    const i18n = await createRendererI18n('en')
    const onSave = vi.fn(async () => true)

    render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <DossierDetail
            dossier={{
              id: 'dos-1',
              name: 'Client Alpha',
              registeredAt: '2026-03-13T08:30:00.000Z',
              status: 'active',
              type: 'Civil litigation',
              information: 'Existing running summary',
              updatedAt: '2026-03-13T09:00:00.000Z',
              lastOpenedAt: null,
              nextUpcomingKeyDate: null,
              nextUpcomingKeyDateLabel: null,
              keyDates: [],
              keyReferences: []
            }}
            isLoading={false}
            isSaving={false}
            error={null}
            notice={null}
            contacts={[]}
            contactsIsLoading={false}
            contactsError={null}
            documents={[]}
            documentIsLoading={false}
            documentIsSaving={false}
            documentError={null}
            documentWatchStatus={null}
            activePreviewDocumentId={null}
            documentPreviewState={{ status: 'idle', preview: null, error: null }}
            documentContentState={{ status: 'idle', content: null, error: null, progress: null }}
            onClose={() => undefined}
            onUnregister={async () => true}
            onSave={onSave}
            onUpsertContact={async () => true}
            onDeleteContact={async () => true}
            onUpsertKeyDate={async () => true}
            onDeleteKeyDate={async () => true}
            onUpsertKeyReference={async () => true}
            onDeleteKeyReference={async () => true}
            onSaveDocumentMetadata={async () => true}
            onOpenDocumentPreview={async () => undefined}
            onOpenDocumentFile={async () => undefined}
            onExtractDocumentContent={async () => true}
            onExtractPendingDocumentContent={async () => ({
              attempted: 0,
              succeeded: 0,
              failed: 0
            })}
          />
        </ToastProvider>
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dossier detail' }))

    expect(screen.getByText('Existing running summary')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    fireEvent.change(screen.getByLabelText('Information'), {
      target: { value: 'Updated summary and current status' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save dossier details' }))

    expect(onSave).toHaveBeenCalledWith({
      id: 'dos-1',
      status: 'active',
      type: 'Civil litigation',
      information: 'Updated summary and current status'
    })
  })

  it('renders the dossier setup DelegatedPrompt on the informations section', async () => {
    const i18n = await createRendererI18n('en')

    const dossier = {
      id: 'dos-1',
      name: 'Client Alpha',
      registeredAt: '2026-03-13T08:30:00.000Z',
      status: 'active' as const,
      type: '',
      updatedAt: '2026-03-13T09:00:00.000Z',
      lastOpenedAt: null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null,
      keyDates: [],
      keyReferences: []
    }

    const sharedProps = {
      dossier,
      isLoading: false,
      isSaving: false,
      error: null,
      notice: null,
      contacts: [],
      contactsIsLoading: false,
      contactsError: null,
      documents: [],
      documentIsLoading: false,
      documentIsSaving: false,
      documentError: null,
      documentWatchStatus: null,
      activePreviewDocumentId: null,
      documentPreviewState: { status: 'idle' as const, preview: null, error: null },
      documentContentState: {
        status: 'idle' as const,
        content: null,
        error: null,
        progress: null
      },
      onClose: () => undefined,
      onUnregister: async () => true,
      onSave: async () => true,
      onUpsertContact: async () => true,
      onDeleteContact: async () => true,
      onUpsertKeyDate: async () => true,
      onDeleteKeyDate: async () => true,
      onUpsertKeyReference: async () => true,
      onDeleteKeyReference: async () => true,
      onSaveDocumentMetadata: async () => true,
      onOpenDocumentPreview: async () => undefined,
      onOpenDocumentFile: async () => undefined,
      onExtractDocumentContent: async () => true,
      onExtractPendingDocumentContent: async () => ({
        attempted: 0,
        succeeded: 0,
        failed: 0
      })
    }

    render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <DossierDetail {...sharedProps} />
        </ToastProvider>
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dossier detail' }))

    expect(screen.getByRole('button', { name: 'Toggle Add via AI section' })).toBeTruthy()
  })

  it('shows the deleted contact name in the confirmation toast', async () => {
    const i18n = await createRendererI18n('en')
    const onDeleteContact = vi.fn(async () => true)

    render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <DossierDetail
            dossier={{
              id: 'dos-1',
              name: 'Client Alpha',
              registeredAt: '2026-03-13T08:30:00.000Z',
              status: 'active',
              type: '',
              updatedAt: '2026-03-13T09:00:00.000Z',
              lastOpenedAt: null,
              nextUpcomingKeyDate: null,
              nextUpcomingKeyDateLabel: null,
              keyDates: [],
              keyReferences: []
            }}
            isLoading={false}
            isSaving={false}
            error={null}
            notice={null}
            contacts={[
              {
                uuid: 'contact-1',
                dossierId: 'dos-1',
                firstName: 'Camille',
                lastName: 'Martin',
                role: 'Client'
              }
            ]}
            contactsIsLoading={false}
            contactsError={null}
            documents={[]}
            documentIsLoading={false}
            documentIsSaving={false}
            documentError={null}
            documentWatchStatus={null}
            activePreviewDocumentId={null}
            documentPreviewState={{ status: 'idle', preview: null, error: null }}
            documentContentState={{ status: 'idle', content: null, error: null, progress: null }}
            onClose={() => undefined}
            onUnregister={async () => true}
            onSave={async () => true}
            onUpsertContact={async () => true}
            onDeleteContact={onDeleteContact}
            onUpsertKeyDate={async () => true}
            onDeleteKeyDate={async () => true}
            onUpsertKeyReference={async () => true}
            onDeleteKeyReference={async () => true}
            onSaveDocumentMetadata={async () => true}
            onOpenDocumentPreview={async () => undefined}
            onOpenDocumentFile={async () => undefined}
            onExtractDocumentContent={async () => true}
            onExtractPendingDocumentContent={async () => ({
              attempted: 0,
              succeeded: 0,
              failed: 0
            })}
          />
        </ToastProvider>
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(onDeleteContact).toHaveBeenCalledWith({ dossierId: 'dos-1', contactUuid: 'contact-1' })
    })

    expect(await screen.findByText('Contact removed: Camille Martin.')).toBeTruthy()
  })
})

afterEach(() => {
  cleanup()
})
