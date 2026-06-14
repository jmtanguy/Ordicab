import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import pdfWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

import type { DocumentPreview, DocumentRecord } from '@shared/types'

import { Button } from '@renderer/components/ui'
import { useToast } from '@renderer/contexts/ToastContext'
import { useDocumentStore } from '@renderer/stores'
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
    return <p className="text-sm text-destructive">{t('documents.preview_error_body')}</p>
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-white p-2">
      <img
        alt={preview.filename}
        className="max-h-[min(75vh,720px)] w-full rounded-xl object-contain"
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
    return <p className="text-sm text-destructive">{renderError}</p>
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-white p-2">
      <canvas
        ref={canvasRef}
        className="max-h-[min(75vh,720px)] w-full rounded-xl bg-white object-contain"
      />
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
    return <p className="text-sm text-destructive">{renderError}</p>
  }

  return (
    <div className="min-h-72">
      <div ref={styleHostRef} />
      <div ref={bodyHostRef} className="ord-docx-preview-host min-h-64" />
    </div>
  )
}

interface PdfViewportLike {
  width: number
  height: number
}

interface PdfPageLike {
  getViewport(options: { scale: number }): PdfViewportLike
  render(options: {
    canvas: HTMLCanvasElement
    canvasContext: CanvasRenderingContext2D
    viewport: PdfViewportLike
  }): { cancel: () => void; promise: Promise<unknown> }
}

interface PdfDocumentLike {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageLike>
  destroy(): Promise<void>
}

const PDF_DEFAULT_ASPECT_RATIO = 0.707 // A4 portrait, width / height
const PDF_PAGE_GAP_PX = 12
const PDF_MIN_SCALE = 0.5
const PDF_MAX_SCALE = 3

function PdfPageCanvas({
  pdf,
  pageNumber,
  cssWidth,
  onAspectRatio
}: {
  pdf: PdfDocumentLike
  pageNumber: number
  cssWidth: number
  onAspectRatio: (pageIndex: number, ratio: number) => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null

    const render = async (): Promise<void> => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) {
        return
      }
      const baseViewport = page.getViewport({ scale: 1 })
      onAspectRatio(pageNumber - 1, baseViewport.width / baseViewport.height)

      const pixelRatio = window.devicePixelRatio || 1
      const renderScale = (cssWidth / baseViewport.width) * pixelRatio
      const viewport = page.getViewport({ scale: renderScale })
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context || cancelled) {
        return
      }

      canvas.width = viewport.width
      canvas.height = viewport.height
      renderTask = page.render({ canvas, canvasContext: context, viewport })
      await renderTask.promise.catch(() => undefined)
    }

    void render().catch(() => undefined)

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdf, pageNumber, cssWidth, onAspectRatio])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: cssWidth }}
      className="rounded-xl bg-white shadow-[0_8px_24px_rgba(0,0,0,0.10)]"
    />
  )
}

function parsePdfPageRanges(value: string): Array<{ from: number; to: number }> | null {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (parts.length === 0) {
    return null
  }
  const ranges: Array<{ from: number; to: number }> = []
  for (const part of parts) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part)
    if (!match) {
      return null
    }
    const from = Number.parseInt(match[1]!, 10)
    const to = match[2] ? Number.parseInt(match[2], 10) : from
    if (from < 1 || to < from) {
      return null
    }
    ranges.push({ from, to })
  }
  return ranges
}

function PdfPreview({
  preview,
  dossierId,
  scrollElementRef,
  onPageCountChange
}: {
  preview: Extract<DocumentPreview, { kind: 'pdf' }>
  dossierId: string | null
  scrollElementRef: React.RefObject<HTMLDivElement | null>
  onPageCountChange: (pageCount: number | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const extractPdfPages = useDocumentStore((state) => state.extractPdfPages)
  const [isExtractOpen, setIsExtractOpen] = useState(false)
  const [extractInput, setExtractInput] = useState('')
  const contentRef = useRef<HTMLDivElement | null>(null)
  const pdfRef = useRef<PdfDocumentLike | null>(null)
  const aspectRatiosRef = useRef<Map<number, number>>(new Map())
  const [isReady, setIsReady] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [baseWidth, setBaseWidth] = useState<number | null>(null)
  const [zoomMode, setZoomMode] = useState<'fit-width' | 'custom'>('fit-width')
  const [customScale, setCustomScale] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')

  useEffect(() => {
    let cancelled = false
    setIsReady(false)
    setRenderError(null)
    setPageCount(0)
    setCurrentPage(1)
    setZoomMode('fit-width')
    aspectRatiosRef.current = new Map()
    onPageCountChange(null)

    const load = async (): Promise<void> => {
      const pdfJsModule = await import('pdfjs-dist/legacy/build/pdf.mjs')
      pdfJsModule.GlobalWorkerOptions.workerSrc = pdfWorkerSrc
      const loadingTask = pdfJsModule.getDocument({
        data: new Uint8Array(cloneArrayBuffer(preview.data))
      })
      const pdf = (await loadingTask.promise) as unknown as PdfDocumentLike

      if (cancelled) {
        await pdf.destroy()
        return
      }

      pdfRef.current = pdf
      const firstPage = await pdf.getPage(1)
      const viewport = firstPage.getViewport({ scale: 1 })
      if (cancelled) {
        return
      }

      aspectRatiosRef.current.set(0, viewport.width / viewport.height)
      setBaseWidth(viewport.width)
      setPageCount(pdf.numPages)
      onPageCountChange(pdf.numPages)
      setIsReady(true)
    }

    void load().catch((error) => {
      if (!cancelled) {
        setRenderError(error instanceof Error ? error.message : t('documents.preview_pdf_error'))
      }
    })

    return () => {
      cancelled = true
      const pdf = pdfRef.current
      pdfRef.current = null
      if (pdf) {
        void pdf.destroy().catch(() => undefined)
      }
      onPageCountChange(null)
    }
  }, [onPageCountChange, preview.data, t])

  useEffect(() => {
    const element = contentRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }
    const update = (): void => setContainerWidth(element.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitWidthScale = baseWidth && containerWidth > 0 ? containerWidth / baseWidth : 1
  const effectiveScale = zoomMode === 'fit-width' ? fitWidthScale : customScale
  const cssPageWidth = Math.max(baseWidth ? baseWidth * effectiveScale : containerWidth, 100)

  // Pages render lazily through the same virtualization machinery as the
  // document tree — only visible canvases live in the DOM.

  const pageVirtualizer = useVirtualizer({
    count: isReady ? pageCount : 0,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: (index) => {
      const aspect =
        aspectRatiosRef.current.get(index) ??
        aspectRatiosRef.current.get(0) ??
        PDF_DEFAULT_ASPECT_RATIO
      return cssPageWidth / aspect + PDF_PAGE_GAP_PX
    },
    overscan: 2
  })

  useEffect(() => {
    pageVirtualizer.measure()
  }, [cssPageWidth, pageVirtualizer])

  useEffect(() => {
    const element = scrollElementRef.current
    if (!element || !isReady) {
      return
    }
    const onScroll = (): void => {
      const middle = element.scrollTop + element.clientHeight / 2
      const items = pageVirtualizer.getVirtualItems()
      const current = items.find((item) => middle >= item.start && middle < item.end) ?? items[0]
      if (current) {
        setCurrentPage(current.index + 1)
      }
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [isReady, pageVirtualizer, scrollElementRef])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  const applyZoomStep = (delta: number): void => {
    const next = Math.min(
      PDF_MAX_SCALE,
      Math.max(PDF_MIN_SCALE, Math.round((effectiveScale + delta) * 10) / 10)
    )
    setCustomScale(next)
    setZoomMode('custom')
  }

  const jumpToPage = (value: string): void => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPage))
      return
    }
    const target = Math.min(Math.max(parsed, 1), pageCount)
    pageVirtualizer.scrollToIndex(target - 1, { align: 'start' })
    setCurrentPage(target)
  }

  const handleAspectRatio = (pageIndex: number, ratio: number): void => {
    aspectRatiosRef.current.set(pageIndex, ratio)
  }

  const handleExtractPages = async (): Promise<void> => {
    if (!dossierId) {
      return
    }
    const ranges = parsePdfPageRanges(extractInput)
    if (!ranges) {
      showToast(
        t('documents.pdf_extract_invalid', {
          defaultValue: 'Plage de pages invalide (ex. : 1-3, 7)'
        }),
        'warning'
      )
      return
    }
    const result = await extractPdfPages({
      dossierId,
      documentPath: preview.documentPath,
      ranges
    })
    if (result) {
      setIsExtractOpen(false)
      showToast(
        t('documents.pdf_extract_success', {
          name: result.relativePaths[0] ?? '',
          defaultValue: 'Pages extraites : {{name}}'
        })
      )
    }
  }

  if (renderError) {
    return <p className="text-sm text-destructive">{renderError}</p>
  }

  if (!isReady) {
    return <p className="text-sm text-ink-muted">{t('documents.preview_rendering')}</p>
  }

  return (
    <div ref={contentRef} className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-white/95 px-3 py-1.5 shadow-sm backdrop-blur">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('documents.pdf_zoom_out', { defaultValue: 'Zoom arrière' })}
            title={t('documents.pdf_zoom_out', { defaultValue: 'Zoom arrière' })}
            disabled={effectiveScale <= PDF_MIN_SCALE}
            onClick={() => applyZoomStep(-0.1)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition hover:bg-aurora/10 hover:text-aurora disabled:cursor-not-allowed disabled:opacity-30"
          >
            −
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-ink-muted">
            {Math.round(effectiveScale * 100)}%
          </span>
          <button
            type="button"
            aria-label={t('documents.pdf_zoom_in', { defaultValue: 'Zoom avant' })}
            title={t('documents.pdf_zoom_in', { defaultValue: 'Zoom avant' })}
            disabled={effectiveScale >= PDF_MAX_SCALE}
            onClick={() => applyZoomStep(0.1)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition hover:bg-aurora/10 hover:text-aurora disabled:cursor-not-allowed disabled:opacity-30"
          >
            +
          </button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={zoomMode === 'fit-width'}
            onClick={() => setZoomMode('fit-width')}
          >
            {t('documents.pdf_fit_width', { defaultValue: 'Largeur' })}
          </Button>
          {dossierId ? (
            isExtractOpen ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleExtractPages()
                }}
                className="flex items-center gap-1"
              >
                <input
                  type="text"
                  value={extractInput}
                  onChange={(event) => setExtractInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setIsExtractOpen(false)
                    }
                  }}
                  placeholder={t('documents.pdf_extract_placeholder', {
                    defaultValue: 'ex. : 1-3, 7'
                  })}
                  aria-label={t('documents.pdf_extract_action', {
                    defaultValue: 'Extraire des pages'
                  })}
                  className="h-7 w-24 rounded-md border border-hairline bg-white px-2 text-xs text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/30"
                />
                <Button type="submit" variant="ghost" size="sm">
                  {t('documents.pdf_extract_confirm', { defaultValue: 'Extraire' })}
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setExtractInput(String(currentPage))
                  setIsExtractOpen(true)
                }}
              >
                {t('documents.pdf_extract_action', { defaultValue: 'Extraire des pages' })}
              </Button>
            )
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input
            type="text"
            inputMode="numeric"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                jumpToPage(pageInput)
              }
            }}
            onBlur={() => setPageInput(String(currentPage))}
            aria-label={t('documents.pdf_go_to_page', { defaultValue: 'Aller à la page' })}
            className="h-7 w-10 rounded-md border border-hairline bg-white text-center text-xs text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/30"
          />
          <span className="tabular-nums">/ {pageCount}</span>
        </div>
      </div>

      <div style={{ height: pageVirtualizer.getTotalSize(), position: 'relative' }}>
        {pageVirtualizer.getVirtualItems().map((item) => (
          <div
            key={item.index}
            ref={(element) => pageVirtualizer.measureElement(element)}
            data-index={item.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${item.start}px)`,
              paddingBottom: PDF_PAGE_GAP_PX
            }}
            className="flex justify-center"
          >
            {pdfRef.current ? (
              <PdfPageCanvas
                pdf={pdfRef.current}
                pageNumber={item.index + 1}
                cssWidth={cssPageWidth}
                onAspectRatio={handleAspectRatio}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
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

function formatAttachmentSize(byteLength: number | null, locale: string): string | null {
  if (byteLength === null || byteLength <= 0) {
    return null
  }
  const units = ['o', 'Ko', 'Mo', 'Go']
  let value = byteLength
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`
}

function EmailPreview({
  preview,
  dossierId,
  locale
}: {
  preview: Extract<DocumentPreview, { kind: 'email' }>
  dossierId: string | null
  locale: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const saveEmailAttachments = useDocumentStore((state) => state.saveEmailAttachments)
  const [savingIndexes, setSavingIndexes] = useState<Set<number>>(() => new Set())

  const handleSaveAttachments = async (attachmentIndexes?: number[]): Promise<void> => {
    if (!dossierId) {
      return
    }
    const targetIndexes = attachmentIndexes ?? preview.attachments.map((item) => item.index)
    setSavingIndexes((previous) => new Set([...previous, ...targetIndexes]))
    try {
      const result = await saveEmailAttachments({
        dossierId,
        documentPath: preview.documentPath,
        attachmentIndexes
      })
      if (!result) {
        return
      }
      if (result.failed.length === 0) {
        showToast(
          t('documents.attachment_saved', {
            count: result.saved.length,
            defaultValue: '{{count}} pièce(s) jointe(s) enregistrée(s)'
          })
        )
      } else {
        showToast(
          t('documents.attachment_save_error', {
            error: result.failed[0]?.error ?? '',
            defaultValue: "Impossible d'enregistrer la pièce jointe : {{error}}"
          }),
          result.saved.length > 0 ? 'warning' : 'error'
        )
      }
    } finally {
      setSavingIndexes((previous) => {
        const next = new Set(previous)
        for (const index of targetIndexes) {
          next.delete(index)
        }
        return next
      })
    }
  }

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
        <div className="grid gap-3 rounded-2xl border border-hairline bg-white p-4">
          {previewFields.map((field) => (
            <div key={field.label} className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {field.label}
              </p>
              <p className="text-sm text-ink">{field.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {preview.attachments.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {t('documents.preview_email_attachments')}
            </p>
            {preview.attachments.length > 1 && dossierId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={savingIndexes.size > 0}
                onClick={() => void handleSaveAttachments()}
              >
                {t('documents.attachment_save_all', { defaultValue: 'Tout enregistrer' })}
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {preview.attachments.map((attachment) => {
              const sizeLabel = formatAttachmentSize(attachment.byteLength, locale)
              const isSaving = savingIndexes.has(attachment.index)
              return (
                <span
                  key={attachment.index}
                  className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-parchment px-2.5 py-1 text-xs text-ink"
                >
                  <span className="max-w-56 truncate">{attachment.filename}</span>
                  {sizeLabel ? <span className="shrink-0 text-ink-subtle">{sizeLabel}</span> : null}
                  {dossierId ? (
                    <button
                      type="button"
                      disabled={isSaving}
                      aria-label={t('documents.attachment_save', {
                        name: attachment.filename,
                        defaultValue: 'Enregistrer dans le dossier'
                      })}
                      title={t('documents.attachment_save', {
                        name: attachment.filename,
                        defaultValue: 'Enregistrer dans le dossier'
                      })}
                      onClick={() => void handleSaveAttachments([attachment.index])}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-aurora transition hover:bg-aurora/10 disabled:cursor-wait disabled:opacity-50"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M8 2v8m0 0 3-3m-3 3L5 7" />
                        <path d="M3 12.5h10" />
                      </svg>
                    </button>
                  ) : null}
                </span>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-hairline bg-white p-4">
        <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-ink">
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
  scrollElementRef,
  locale
}: {
  activeDocument: DocumentRecord | null
  previewState: DocumentPreviewState
  contentState: DocumentContentState
  shouldShowExtractedText: boolean
  setPdfPageCount: (count: number | null) => void
  scrollElementRef: React.RefObject<HTMLDivElement | null>
  locale: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const preview = previewState.preview

  if (!activeDocument) {
    return (
      <div className="space-y-2 text-sm text-ink">
        <p className="font-medium text-ink">{t('documents.preview_empty_title')}</p>
        <p>{t('documents.preview_empty_body')}</p>
      </div>
    )
  }

  if (previewState.status === 'loading') {
    return (
      <div className="space-y-2 text-sm text-ink">
        <p className="font-medium text-ink">{t('documents.preview_loading_title')}</p>
        <p>{t('documents.preview_loading_body', { name: activeDocument.filename })}</p>
      </div>
    )
  }

  if (previewState.status === 'error') {
    return (
      <div className="space-y-2 text-sm text-destructive">
        <p className="font-medium">{t('documents.preview_error_title')}</p>
        <p>{previewState.error ?? t('documents.preview_error_body')}</p>
      </div>
    )
  }

  if (shouldShowExtractedText) {
    if (contentState.status === 'loading') {
      const progress = contentState.progress
      return (
        <div className="flex min-h-full flex-col items-center justify-center gap-4 text-center text-sm text-ink">
          <div className="relative h-12 w-12">
            <div className="absolute inset-0 rounded-full border-2 border-hairline-strong" />
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-sky-300 border-r-sky-400" />
          </div>
          <div className="space-y-2">
            <p className="font-medium text-ink">{t('documents.extraction_loading_title')}</p>
            <p>{t('documents.extraction_loading_body', { name: activeDocument.filename })}</p>
            {progress && progress.totalPages > 0 ? (
              <p className="text-xs text-ink-muted">
                {t(
                  progress.phase === 'ocr'
                    ? 'documents.extraction_progress_ocr'
                    : 'documents.extraction_progress_embedded',
                  { page: progress.page, total: progress.totalPages }
                )}
              </p>
            ) : null}
          </div>
        </div>
      )
    }

    if (contentState.status === 'error') {
      return (
        <div className="space-y-2 text-sm text-destructive">
          <p className="font-medium">{t('documents.extraction_error_title')}</p>
          <p>{contentState.error ?? t('documents.extraction_error_body')}</p>
        </div>
      )
    }

    if (contentState.status === 'ready') {
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.14em] text-ink-muted">
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
          <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-ink">
            {contentState.content?.text || t('documents.preview_text_empty')}
          </pre>
        </div>
      )
    }
  }

  if (previewState.status === 'ready' && preview) {
    if (preview.kind === 'unsupported') {
      return (
        <div className="space-y-3 text-sm text-ink">
          <p className="font-medium text-ink">{t('documents.preview_unsupported_title')}</p>
          <p>{preview.message}</p>
        </div>
      )
    }
    if (preview.kind === 'text') {
      return (
        <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-ink">
          {preview.text || t('documents.preview_text_empty')}
        </pre>
      )
    }
    if (preview.kind === 'email')
      return (
        <EmailPreview
          preview={preview}
          dossierId={activeDocument?.dossierId ?? null}
          locale={locale}
        />
      )
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
      return (
        <PdfPreview
          preview={preview}
          dossierId={activeDocument?.dossierId ?? null}
          scrollElementRef={scrollElementRef}
          onPageCountChange={setPdfPageCount}
        />
      )
    }
  }

  return <></>
}

export function DocumentPreviewPanel({
  activeDocument,
  previewState,
  contentState,
  onOpen,
  onClose,
  onExtractContent
}: {
  activeDocument: DocumentRecord | null
  previewState: DocumentPreviewState
  contentState: DocumentContentState
  onOpen: () => void
  onClose?: () => void
  onExtractContent?: (forceRefresh: boolean, readCacheOnly?: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const preview = previewState.preview
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null)
  const [extractedTextDocumentId, setExtractedTextDocumentId] = useState<string | null>(null)
  const locale = i18n.resolvedLanguage ?? 'en'
  const activeDocumentId = activeDocument?.path ?? null
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
      className="flex min-h-0 w-full flex-col overflow-hidden bg-[#fbfaf6]"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-deep-space px-5 py-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-aurora-soft">
              {t('documents.preview_panel_badge')}
            </p>
          </div>
          <p className="truncate text-base font-semibold text-ink">
            {activeDocument?.filename ?? t('documents.preview_empty_title')}
          </p>
          {activeDocument ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-ink-muted">
              {extractionBadgeLabel ? (
                <span className="rounded-full border border-hairline bg-white px-2 py-0.5">
                  {extractionBadgeLabel}
                </span>
              ) : null}
              {previewMetaLabel ? (
                <span className="rounded-full border border-hairline bg-white px-2 py-0.5">
                  {previewMetaLabel}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs normal-case tracking-normal text-ink-muted">
              {t('documents.preview_empty_body')}
            </p>
          )}
        </div>
        {onClose ? (
          <button
            type="button"
            aria-label={t('documents.preview_close_action')}
            title={t('documents.preview_close_action')}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-aurora/10 hover:text-aurora focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/40"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-b border-deep-space bg-white/40 px-5 py-2">
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
              onExtractContent?.(false, true)
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
        <Button type="button" size="sm" variant="ghost" disabled={!activeDocument} onClick={onOpen}>
          {t('documents.preview_open_action')}
        </Button>
      </div>

      <div ref={previewScrollRef} className="flex-1 overflow-auto bg-white px-5 py-4">
        <PreviewBody
          activeDocument={activeDocument}
          previewState={previewState}
          contentState={contentState}
          shouldShowExtractedText={shouldShowExtractedText}
          setPdfPageCount={setPdfPageCount}
          scrollElementRef={previewScrollRef}
          locale={locale}
        />
      </div>
    </aside>
  )
}
