// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { createRendererI18n } from '@renderer/i18n'
import { ToastProvider } from '@renderer/contexts/ToastContext'

import { DossierDetail } from '../DossierDetail'

describe('DossierDetail', () => {
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
              feeAgreements: [],
              billingItems: [],
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
            activeSection="contacts"
            onChangeSection={() => undefined}
            onUpsertContact={async () => true}
            onDeleteContact={onDeleteContact}
            onUpsertKeyDate={async () => true}
            onDeleteKeyDate={async () => true}
            onUpsertFeeAgreement={async () => true}
            onDeleteFeeAgreement={async () => true}
            onArchiveFeeAgreement={async () => true}
            onSetActiveFeeAgreement={async () => true}
            onUpsertBillingItem={async () => true}
            onDeleteBillingItem={async () => true}
            onUpsertKeyReference={async () => true}
            onDeleteKeyReference={async () => true}
            onSaveDocumentMetadata={async () => true}
            onOpenDocumentPreview={async () => undefined}
            onOpenDocumentFile={async () => undefined}
            onExtractDocumentContent={async () => true}
          />
        </ToastProvider>
      </I18nextProvider>
    )

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
