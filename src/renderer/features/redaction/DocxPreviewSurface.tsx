/**
 * Faithful docx rendering for the drafting workspace, based on the reference
 * renderer of DocumentPreviewPanel (docx-preview, breakPages, margin fix),
 * plus a best-effort ordinal mapping between rendered <p> elements and the
 * session's paragraph indices (top-level body paragraphs, tables excluded):
 * click selects a paragraph, double-click opens the inline editor, and the
 * outline/revisions panels can scroll a paragraph into view.
 */

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface DocxPreviewSurfaceProps {
  /** data-URL (base64) of the .docx to render. */
  dataUrl: string
  selectedParagraphIndex: number | null
  onSelectParagraph(index: number | null): void
  onEditParagraph(index: number): void
  /** Paragraph index to scroll into view (changes trigger the scroll). */
  scrollToParagraph?: number | null
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * Rendered <p> elements matching the session's paragraph indexing: direct
 * body paragraphs only — not table cells, headers, footers or footnotes.
 */
function collectBodyParagraphs(bodyHost: HTMLElement): HTMLElement[] {
  return [...bodyHost.querySelectorAll<HTMLElement>('p')].filter(
    (el) => !el.closest('table') && !el.closest('header') && !el.closest('footer')
  )
}

const SELECTED_CLASSES = ['outline', 'outline-2', 'outline-aurora/60', 'outline-offset-2']

export function DocxPreviewSurface({
  dataUrl,
  selectedParagraphIndex,
  onSelectParagraph,
  onEditParagraph,
  scrollToParagraph
}: DocxPreviewSurfaceProps): React.JSX.Element {
  const { t } = useTranslation()
  const styleHostRef = useRef<HTMLDivElement | null>(null)
  const bodyHostRef = useRef<HTMLDivElement | null>(null)
  const renderRequestIdRef = useRef(0)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [rendered, setRendered] = useState(0)

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
          new Blob([dataUrlToArrayBuffer(dataUrl)], { type: DOCX_MIME }),
          bodyHost,
          styleHost,
          {
            className: 'ord-docx-preview',
            inWrapper: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true
          }
        )

        if (isDisposed || renderRequestIdRef.current !== requestId) return

        // Cap paragraph margins so aligned paragraphs don't collapse into a narrow column
        const containerWidth = bodyHost.clientWidth
        const maxMargin = containerWidth * 0.3
        for (const el of bodyHost.querySelectorAll<HTMLElement>('p')) {
          const computed = getComputedStyle(el)
          const ml = parseFloat(computed.marginLeft)
          const mr = parseFloat(computed.marginRight)
          if (!isNaN(ml) && ml > maxMargin) el.style.marginLeft = `${maxMargin}px`
          if (!isNaN(mr) && mr > maxMargin) el.style.marginRight = `${maxMargin}px`
        }

        // Ordinal paragraph mapping for selection / inline editing
        const paragraphs = collectBodyParagraphs(bodyHost)
        paragraphs.forEach((el, index) => {
          el.dataset.redactionIndex = String(index)
          el.classList.add('cursor-pointer', 'transition-colors', 'hover:bg-aurora-soft/40')
        })

        setRendered((value) => value + 1)
      })
      .catch((error) => {
        if (!isDisposed && renderRequestIdRef.current === requestId) {
          setRenderError(
            error instanceof Error
              ? error.message
              : t('redaction.preview_error', { defaultValue: 'Impossible d’afficher l’aperçu.' })
          )
        }
      })

    return () => {
      isDisposed = true
    }
  }, [dataUrl, t])

  // Selection highlight
  useEffect(() => {
    const bodyHost = bodyHostRef.current
    if (!bodyHost) return
    for (const el of bodyHost.querySelectorAll<HTMLElement>('p[data-redaction-index]')) {
      el.classList.remove(...SELECTED_CLASSES)
      if (
        selectedParagraphIndex !== null &&
        el.dataset.redactionIndex === String(selectedParagraphIndex)
      ) {
        el.classList.add(...SELECTED_CLASSES)
      }
    }
  }, [selectedParagraphIndex, rendered])

  // Scroll a paragraph into view when requested
  useEffect(() => {
    if (scrollToParagraph === null || scrollToParagraph === undefined) return
    const bodyHost = bodyHostRef.current
    if (!bodyHost) return
    const target = bodyHost.querySelector<HTMLElement>(
      `p[data-redaction-index="${scrollToParagraph}"]`
    )
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [scrollToParagraph, rendered])

  const resolveParagraphIndex = (eventTarget: EventTarget | null): number | null => {
    if (!(eventTarget instanceof HTMLElement)) return null
    const paragraph = eventTarget.closest<HTMLElement>('p[data-redaction-index]')
    if (!paragraph) return null
    const parsed = Number.parseInt(paragraph.dataset.redactionIndex ?? '', 10)
    return Number.isNaN(parsed) ? null : parsed
  }

  if (renderError) {
    return <p className="p-4 text-sm text-destructive">{renderError}</p>
  }

  return (
    <div
      className="min-h-72"
      onClick={(event) => onSelectParagraph(resolveParagraphIndex(event.target))}
      onDoubleClick={(event) => {
        const index = resolveParagraphIndex(event.target)
        if (index !== null) onEditParagraph(index)
      }}
    >
      <div ref={styleHostRef} />
      <div ref={bodyHostRef} className="ord-docx-preview-host min-h-64" />
    </div>
  )
}
