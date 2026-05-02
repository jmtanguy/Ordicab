import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import type { DocumentPreview, DocumentRecord } from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'

import { DocumentList } from '../DocumentList'

function createDocument(index: number, overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: `folder/file-${index}.pdf`,
    dossierId: 'dos-1',
    filename: `file-${index}.pdf`,
    byteLength: 1024 + index,
    relativePath: `folder/file-${index}.pdf`,
    modifiedAt: `2026-03-14T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
    description: index % 2 === 0 ? `Summary for file ${index}` : undefined,
    tags: index % 3 === 0 ? ['urgent'] : [],
    textExtraction: { state: 'extractable', isExtractable: true },
    ...overrides
  }
}

describe('DocumentList', () => {
  it('renders preview actions and the unsupported preview state without leaving the dossier surface', async () => {
    const i18n = await createRendererI18n('en')
    const unsupportedPreview: DocumentPreview = {
      kind: 'unsupported',
      sourceType: 'doc',
      documentId: 'legacy.doc',
      filename: 'legacy.doc',
      mimeType: 'application/msword',
      byteLength: 42,
      reason: 'unsupported-type',
      message: 'Legacy Word previews are unavailable right now.'
    }

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <DocumentList
          dossierId="dos-1"
          documents={[
            createDocument(0, {
              id: 'legacy.doc',
              filename: 'legacy.doc',
              relativePath: 'legacy.doc'
            })
          ]}
          isLoading={false}
          isSavingMetadata={false}
          onSaveMetadata={vi.fn(async () => true)}
          watchStatus={null}
          activePreviewDocumentId="legacy.doc"
          previewState={{
            status: 'ready',
            preview: unsupportedPreview,
            error: null
          }}
          contentState={{ status: 'idle', content: null, error: null, progress: null }}
          onOpenPreview={vi.fn(async () => undefined)}
          onOpenFile={vi.fn()}
          onExtractContent={vi.fn(async () => true)}
        />
      </I18nextProvider>
    )

    expect(markup).toContain('Preview')
    expect(markup).toContain('Preview panel')
    expect(markup).toContain('Legacy Word previews are unavailable right now.')
  })

  it('renders email previews inside the dossier surface', async () => {
    const i18n = await createRendererI18n('en')
    const emailPreview: DocumentPreview = {
      kind: 'email',
      sourceType: 'eml',
      documentId: 'message.eml',
      filename: 'message.eml',
      mimeType: 'message/rfc822',
      byteLength: 42,
      subject: 'Client follow-up',
      from: 'sender@example.com',
      to: 'receiver@example.com',
      cc: null,
      date: '2026-03-14T12:00:00.000Z',
      attachments: ['brief.pdf'],
      text: 'Email body'
    }

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <DocumentList
          dossierId="dos-1"
          documents={[
            createDocument(0, {
              id: 'message.eml',
              filename: 'message.eml',
              relativePath: 'message.eml'
            })
          ]}
          isLoading={false}
          isSavingMetadata={false}
          onSaveMetadata={vi.fn(async () => true)}
          watchStatus={null}
          activePreviewDocumentId="message.eml"
          previewState={{
            status: 'ready',
            preview: emailPreview,
            error: null
          }}
          contentState={{ status: 'idle', content: null, error: null, progress: null }}
          onOpenPreview={vi.fn(async () => undefined)}
          onOpenFile={vi.fn()}
          onExtractContent={vi.fn(async () => true)}
        />
      </I18nextProvider>
    )

    expect(markup).toContain('Client follow-up')
    expect(markup).toContain('sender@example.com')
    expect(markup).toContain('brief.pdf')
    expect(markup).toContain('Email body')
  })

  it('renders document tags as manual metadata', async () => {
    const i18n = await createRendererI18n('en')
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <DocumentList
          dossierId="dos-1"
          documents={[
            createDocument(0, {
              id: 'autotagged.pdf',
              filename: 'autotagged.pdf',
              relativePath: 'autotagged.pdf',
              tags: ['urgent', 'contrat']
            })
          ]}
          isLoading={false}
          isSavingMetadata={false}
          onSaveMetadata={vi.fn(async () => true)}
          watchStatus={null}
          activePreviewDocumentId={null}
          previewState={{ status: 'idle', preview: null, error: null }}
          contentState={{ status: 'idle', content: null, error: null, progress: null }}
          onOpenPreview={vi.fn(async () => undefined)}
          onOpenFile={vi.fn()}
          onExtractContent={vi.fn(async () => true)}
        />
      </I18nextProvider>
    )

    expect(markup).toContain('>urgent<')
    expect(markup).toContain('>contrat<')
    expect(markup).toContain('border-aurora/25')
  })
})
