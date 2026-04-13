import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import pdfWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

import type { DocumentPreview, DocumentRecord } from '@shared/types'

import { Button } from '@renderer/components/ui'
import type { DocumentContentState, DocumentPreviewState } from '@renderer/stores'

type ImageDocumentPreview = Extract<DocumentPreview, { kind: 'image' }>
type TiffImagePreview = ImageDocumentPreview & { sourceType: 'tif' | 'tiff' }

function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function resolveDocxPreviewErrorMessage(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : ''
  const normalizedMessage = message.toLowerCase()

  if (
    normalizedMessage.includes('corrupted zip') ||
    normalizedMessage.includes('end of data reached') ||
    normalizedMessage.includes('data length = 0')
  ) {
    return t('documents.preview_docx_invalid')
  }

  return t('documents.preview_error_body')
}

function formatExtractedTextForPreview(text: string | null | undefined): string {
  return text?.replace(/<NL>/g, '\n') ?? ''
}

function ImagePreview({ preview }: { preview: ImageDocumentPreview }): React.JSX.Element | null {
  const { t } = useTranslation()
  const isTiff = preview.sourceType === 'tif' || preview.sourceType === 'tiff'

  const [renderError, setRenderError] = useState(false)
  const imageUrl = useMemo(() => {
    if (typeof window === 'undefined' || !preview.mimeType) {
      return null
    }

    return `data:${preview.mimeType};base64,${arrayBufferToBase64(preview.data)}`
  }, [preview.data, preview.mimeType])

  if (isTiff) {
    return <TiffPreview preview={preview as TiffImagePreview} />
  }

  if (!imageUrl || renderError) {
    return <p className="text-sm text-rose-100">{t('documents.preview_error_body')}</p>
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/45 p-2">
      <img
        alt={preview.filename}
        className="max-h-[480px] w-full rounded-xl object-contain"
        src={imageUrl}
        onError={() => setRenderError(true)}
      />
    </div>
  )
}

function TiffPreview({ preview }: { preview: TiffImagePreview }): React.JSX.Element {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !canvasRef.current) {
      return
    }

    let cancelled = false
    setRenderError(null)

    void import('utif')
      .then((UTIF) => {
        const buffer = cloneArrayBuffer(preview.data)
        const ifds = UTIF.decode(buffer)
        const firstImage = ifds[0]

        if (!firstImage) {
          throw new Error(t('documents.preview_error_body'))
        }

        UTIF.decodeImage(buffer, firstImage)

        if (!firstImage.width || !firstImage.height) {
          throw new Error(t('documents.preview_error_body'))
        }

        const rgba = UTIF.toRGBA8(firstImage)
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')

        if (!canvas || !context) {
          throw new Error(t('documents.preview_error_body'))
        }

        canvas.width = firstImage.width
        canvas.height = firstImage.height

        if (!cancelled) {
          context.putImageData(
            new ImageData(new Uint8ClampedArray(rgba), firstImage.width, firstImage.height),
            0,
            0
          )
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRenderError(error instanceof Error ? error.message : t('documents.preview_error_body'))
        }
      })

    return () => {
      cancelled = true
    }
  }, [preview.data, t])

  if (renderError) {
    return <p className="text-sm text-rose-100">{renderError}</p>
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/45 p-2">
      <canvas ref={canvasRef} className="max-h-[480px] w-full rounded-xl bg-white object-contain" />
    </div>
  )
}

function DocxPreview({
  preview
}: {
  preview: Extract<DocumentPreview, { kind: 'docx' }>
}): React.JSX.Element {
  const { t } = useTranslation()
  const styleHostRef = useRef<HTMLDivElement | null>(null)
  const bodyHostRef = useRef<HTMLDivElement | null>(null)
  const renderRequestIdRef = useRef(0)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !styleHostRef.current || !bodyHostRef.current) {
      return
    }

    let isDisposed = false
    const requestId = renderRequestIdRef.current + 1
    renderRequestIdRef.current = requestId
    const styleHost = styleHostRef.current
    const bodyHost = bodyHostRef.current
    styleHost.innerHTML = ''
    bodyHost.innerHTML = ''
    setRenderError(null)

    void import('docx-preview')
      .then(async ({ renderAsync }) => {
        await renderAsync(
          new Blob([cloneArrayBuffer(preview.data)], { type: preview.mimeType }),
          bodyHost,
          styleHost,
          {
            className: 'ord-docx-preview',
            inWrapper: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            ignoreWidth: false,
            ignoreHeight: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true
          }
        )

        if (isDisposed || renderRequestIdRef.current !== requestId) {
          return
        }

        // Cap paragraph margins so right/center aligned paragraphs don't collapse into a narrow column
        const containerWidth = bodyHost.clientWidth
        const maxMargin = containerWidth * 0.3
        for (const el of bodyHost.querySelectorAll<HTMLElement>('p')) {
          const computed = getComputedStyle(el)
          const ml = parseFloat(computed.marginLeft)
          const mr = parseFloat(computed.marginRight)
          if (!isNaN(ml) && ml > maxMargin) el.style.marginLeft = `${maxMargin}px`
          if (!isNaN(mr) && mr > maxMargin) el.style.marginRight = `${maxMargin}px`
        }
      })
      .catch((error) => {
        if (!isDisposed && renderRequestIdRef.current === requestId) {
          setRenderError(resolveDocxPreviewErrorMessage(error, t))
        }
      })

    return () => {
      isDisposed = true
    }
  }, [preview.data, preview.mimeType, t])

  if (renderError) {
    return <p className="text-sm text-rose-100">{renderError}</p>
  }

  return (
    <div className="min-h-72">
      <div ref={styleHostRef} />
      <div ref={bodyHostRef} className="ord-docx-preview-host min-h-64" />
    </div>
  )
}

function PdfPreview({
  preview,
  onPageCountChange
}: {
  preview: Extract<DocumentPreview, { kind: 'pdf' }>
  onPageCountChange: (pageCount: number | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) {
      return
    }

    let cancelled = false
    let activeRenderTask: { cancel: () => void } | null = null
    const container = containerRef.current
    container.innerHTML = ''
    onPageCountChange(null)
    setRenderError(null)

    const renderPdf = async (): Promise<void> => {
      const pdfJsModule = await import('pdfjs-dist/legacy/build/pdf.mjs')
      pdfJsModule.GlobalWorkerOptions.workerSrc = pdfWorkerSrc
      const loadingTask = pdfJsModule.getDocument({
        data: new Uint8Array(cloneArrayBuffer(preview.data))
      })
      const pdf = await loadingTask.promise

      if (cancelled) {
        await pdf.destroy()
        return
      }

      onPageCountChange(pdf.numPages)

      try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) {
            break
          }

          const page = await pdf.getPage(pageNumber)
          const viewport = page.getViewport({ scale: 1.15 })
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')

          if (!context) {
            throw new Error(t('documents.preview_pdf_error'))
          }

          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = 'w-full rounded-xl bg-white shadow-[0_18px_45px_rgba(15,23,42,0.28)]'

          const renderTask = page.render({ canvas, canvasContext: context, viewport })
          activeRenderTask = renderTask

          try {
            await renderTask.promise
          } catch (error) {
            if (cancelled) return
            throw error
          }

          activeRenderTask = null

          if (cancelled) {
            break
          }

          const pageContainer = document.createElement('div')
          pageContainer.className =
            'overflow-hidden rounded-2xl border border-white/10 bg-slate-900/55 p-2'
          pageContainer.appendChild(canvas)
          container.appendChild(pageContainer)
        }
      } finally {
        await pdf.destroy()
      }
    }

    void renderPdf().catch((error) => {
      if (!cancelled) {
        setRenderError(error instanceof Error ? error.message : t('documents.preview_pdf_error'))
      }
    })

    return () => {
      cancelled = true
      activeRenderTask?.cancel()
      container.innerHTML = ''
      onPageCountChange(null)
    }
  }, [onPageCountChange, preview.data, t])

  if (renderError) {
    return <p className="text-sm text-rose-100">{renderError}</p>
  }

  return <div ref={containerRef} className="space-y-3" />
}

function formatPreviewDate(value: string | null, locale: string): string | null {
  if (!value) {
    return null
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function EmailPreview({
  preview,
  locale
}: {
  preview: Extract<DocumentPreview, { kind: 'email' }>
  locale: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const previewFields = [
    { label: t('documents.preview_email_subject'), value: preview.subject },
    { label: t('documents.preview_email_from'), value: preview.from },
    { label: t('documents.preview_email_to'), value: preview.to },
    { label: t('documents.preview_email_cc'), value: preview.cc },
    {
      label: t('documents.preview_email_date'),
      value: formatPreviewDate(preview.date, locale)
    }
  ].filter((field) => field.value)

  return (
    <div className="space-y-4">
      {previewFields.length > 0 ? (
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
          {previewFields.map((field) => (
            <div key={field.label} className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                {field.label}
              </p>
              <p className="text-sm text-slate-100">{field.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {preview.attachments.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
            {t('documents.preview_email_attachments')}
          </p>
          <div className="flex flex-wrap gap-2">
            {preview.attachments.map((attachment) => (
              <span
                key={attachment}
                className="rounded-full border border-white/10 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-200"
              >
                {attachment}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-slate-200">
          {preview.text || t('documents.preview_email_empty')}
        </pre>
      </div>
    </div>
  )
}

function PreviewBody({
  activeDocument,
  previewState,
  contentState,
  shouldShowExtractedText,
  setPdfPageCount,
  locale
}: {
  activeDocument: DocumentRecord | null
  previewState: DocumentPreviewState
  contentState: DocumentContentState
  shouldShowExtractedText: boolean
  setPdfPageCount: (count: number | null) => void
  locale: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const preview = previewState.preview

  if (!activeDocument) {
    return (
      <div className="space-y-2 text-sm text-slate-300">
        <p className="font-medium text-slate-100">{t('documents.preview_empty_title')}</p>
        <p>{t('documents.preview_empty_body')}</p>
      </div>
    )
  }

  if (previewState.status === 'loading') {
    return (
      <div className="space-y-2 text-sm text-slate-300">
        <p className="font-medium text-slate-100">{t('documents.preview_loading_title')}</p>
        <p>{t('documents.preview_loading_body', { name: activeDocument.filename })}</p>
      </div>
    )
  }

  if (previewState.status === 'error') {
    return (
      <div className="space-y-2 text-sm text-rose-100">
        <p className="font-medium">{t('documents.preview_error_title')}</p>
        <p>{previewState.error ?? t('documents.preview_error_body')}</p>
      </div>
    )
  }

  if (shouldShowExtractedText) {
    if (contentState.status === 'loading') {
      return (
        <div className="flex min-h-full flex-col items-center justify-center gap-4 text-center text-sm text-slate-300">
          <div className="relative h-12 w-12">
            <div className="absolute inset-0 rounded-full border-2 border-slate-700/70" />
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-sky-300 border-r-sky-400" />
          </div>
          <div className="space-y-2">
            <p className="font-medium text-slate-100">{t('documents.extraction_loading_title')}</p>
            <p>{t('documents.extraction_loading_body', { name: activeDocument.filename })}</p>
          </div>
        </div>
      )
    }

    if (contentState.status === 'error') {
      return (
        <div className="space-y-2 text-sm text-rose-100">
          <p className="font-medium">{t('documents.extraction_error_title')}</p>
          <p>{contentState.error ?? t('documents.extraction_error_body')}</p>
        </div>
      )
    }

    if (contentState.status === 'ready') {
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.14em] text-slate-400">
            <span>
              {t('documents.extraction_method_label', {
                method: contentState.content?.method ?? 'unknown'
              })}
            </span>
            <span>
              {t('documents.extraction_chars_label', {
                count: contentState.content?.textLength ?? 0
              })}
            </span>
          </div>
          <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-slate-200">
            {formatExtractedTextForPreview(contentState.content?.text) ||
              t('documents.preview_text_empty')}
          </pre>
        </div>
      )
    }
  }

  if (previewState.status === 'ready' && preview) {
    if (preview.kind === 'unsupported') {
      return (
        <div className="space-y-3 text-sm text-slate-300">
          <p className="font-medium text-slate-100">{t('documents.preview_unsupported_title')}</p>
          <p>{preview.message}</p>
        </div>
      )
    }
    if (preview.kind === 'text') {
      return (
        <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-slate-200">
          {preview.text || t('documents.preview_text_empty')}
        </pre>
      )
    }
    if (preview.kind === 'email') return <EmailPreview preview={preview} locale={locale} />
    if (preview.kind === 'docx') return <DocxPreview preview={preview} />
    if (preview.kind === 'image') {
      return (
        <ImagePreview
          key={`${preview.filename}-${preview.sourceType}-${preview.data.byteLength}`}
          preview={preview}
        />
      )
    }
    if (preview.kind === 'pdf') {
      return <PdfPreview preview={preview} onPageCountChange={setPdfPageCount} />
    }
  }

  return <></>
}

export function DocumentPreviewPanel({
  activeDocument,
  previewState,
  contentState,
  onOpen,
  onExtractContent
}: {
  activeDocument: DocumentRecord | null
  previewState: DocumentPreviewState
  contentState: DocumentContentState
  onOpen: () => void
  onExtractContent?: (forceRefresh: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const preview = previewState.preview
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null)
  const [extractedTextDocumentId, setExtractedTextDocumentId] = useState<string | null>(null)
  const locale = i18n.resolvedLanguage ?? 'en'
  const activeDocumentId = activeDocument?.id ?? null
  const isExtractable = activeDocument?.textExtraction.isExtractable ?? false
  const hasLoadedExtractedText = contentState.status === 'ready'
  const showExtractedText =
    activeDocumentId !== null && extractedTextDocumentId === activeDocumentId
  const shouldShowExtractedText =
    showExtractedText &&
    (contentState.status === 'loading' ||
      contentState.status === 'ready' ||
      contentState.status === 'error')
  const extractionBadgeLabel = activeDocument
    ? activeDocument.textExtraction.state === 'extracted'
      ? t('documents.extraction_badge_extracted')
      : activeDocument.textExtraction.state === 'extractable'
        ? t('documents.extraction_badge_extractable')
        : t('documents.extraction_badge_unavailable')
    : null
  const previewMetaLabel =
    activeDocument && previewState.status === 'ready' && preview?.kind === 'pdf'
      ? pdfPageCount === null
        ? t('documents.preview_rendering')
        : t('documents.preview_pdf_pages', { count: pdfPageCount })
      : null

  return (
    <aside
      aria-label={t('documents.preview_panel_title')}
      className="flex min-h-72 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/30 p-4 xl:h-full xl:min-h-0"
    >
      <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-3">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate text-sm font-medium text-slate-100">
            {activeDocument?.filename ?? t('documents.preview_empty_title')}
          </p>
          {activeDocument ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-300">
              {extractionBadgeLabel ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  {extractionBadgeLabel}
                </span>
              ) : null}
              {previewMetaLabel ? (
                <span className="rounded-full border border-white/10 bg-slate-900/70 px-2.5 py-1 text-slate-400">
                  {previewMetaLabel}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-slate-400">{t('documents.preview_empty_body')}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {activeDocument &&
          isExtractable &&
          activeDocument.textExtraction.state !== 'extracted' &&
          !hasLoadedExtractedText ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={contentState.status === 'loading' || !onExtractContent}
              onClick={() => {
                if (!onExtractContent) {
                  return
                }

                setExtractedTextDocumentId(activeDocumentId)
                onExtractContent?.(false)
              }}
            >
              {t('documents.extraction_run_action')}
            </Button>
          ) : null}
          {activeDocument &&
          isExtractable &&
          activeDocument.textExtraction.state === 'extracted' &&
          !hasLoadedExtractedText ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={contentState.status === 'loading' || !onExtractContent}
              onClick={() => {
                if (!onExtractContent) {
                  return
                }

                setExtractedTextDocumentId(activeDocumentId)
                onExtractContent?.(false)
              }}
            >
              {t('documents.extraction_show_text_action')}
            </Button>
          ) : null}
          {activeDocument && isExtractable && showExtractedText ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={contentState.status === 'loading' || !onExtractContent}
              onClick={() => {
                if (!onExtractContent) {
                  return
                }

                setExtractedTextDocumentId(activeDocumentId)
                onExtractContent?.(true)
              }}
            >
              {t('documents.extraction_view_action')}
            </Button>
          ) : null}
          {activeDocument && hasLoadedExtractedText ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setExtractedTextDocumentId((current) =>
                  current === activeDocumentId ? null : activeDocumentId
                )
              }
            >
              {showExtractedText
                ? t('documents.extraction_show_preview_action')
                : t('documents.extraction_show_text_action')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!activeDocument}
            onClick={onOpen}
          >
            {t('documents.preview_open_action')}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex-1 overflow-auto rounded-2xl border border-white/8 bg-slate-950/35 p-4">
        <PreviewBody
          activeDocument={activeDocument}
          previewState={previewState}
          contentState={contentState}
          shouldShowExtractedText={shouldShowExtractedText}
          setPdfPageCount={setPdfPageCount}
          locale={locale}
        />
      </div>
    </aside>
  )
}
