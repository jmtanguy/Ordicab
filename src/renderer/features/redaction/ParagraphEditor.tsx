/**
 * Inline paragraph editor of the drafting workspace — rich text (TipTap) so
 * the paragraph's character formatting (bold, italic, underline) survives the
 * edit; paragraph-level formatting (alignment, spacing, style) is preserved
 * by the engine itself. Editing produces a tracked replace revision authored
 * by the lawyer (never a silent rewrite).
 */

import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent, useEditor } from '@tiptap/react'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'

interface ParagraphEditorProps {
  paragraphIndex: number
  /** Minimal HTML (strong/em/u) of the paragraph. */
  initialHtml: string
  initialText: string
  /** Document paragraph alignment, mirrored in the editor display. */
  alignment?: 'left' | 'center' | 'right' | 'justify'
  busy?: boolean
  onSave(text: string, html: string): void
  onDelete(): void
  onCancel(): void
}

/** Strip the <p> wrappers TipTap adds — the engine edits ONE paragraph. */
function editorHtmlToInline(html: string): string {
  return html
    .replace(/<\/p>\s*<p[^>]*>/g, ' ')
    .replace(/<\/?p[^>]*>/g, '')
    .trim()
}

function MarkButton({
  active,
  label,
  title,
  onClick,
  children
}: {
  active: boolean
  label: string
  title: string
  onClick(): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onMouseDown={(event) => {
        // Keep the editor selection while clicking the toolbar
        event.preventDefault()
        onClick()
      }}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border text-sm transition-colors ${
        active
          ? 'border-aurora bg-aurora/10 text-aurora'
          : 'border-hairline text-ink-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

export function ParagraphEditor({
  paragraphIndex,
  initialHtml,
  initialText,
  alignment,
  busy,
  onSave,
  onDelete,
  onCancel
}: ParagraphEditorProps): React.JSX.Element {
  const { t } = useTranslation()

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        underline: false
      }),
      Underline
    ],
    content: `<p>${initialHtml || ''}</p>`,
    editorProps: {
      attributes: {
        class:
          'min-h-64 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-sm leading-relaxed text-ink focus:outline-none focus:border-aurora focus:ring-2 focus:ring-aurora/35'
      },
      // One OOXML paragraph per editor: Enter creates no extra paragraph;
      // Shift+Enter is preserved below as a Word line break.
      handleKeyDown: (_view, event) => event.key === 'Enter' && !event.shiftKey
    }
  })

  useEffect(() => {
    editor?.commands.focus('end')
  }, [editor])

  const currentHtml = editorHtmlToInline(editor?.getHTML() ?? '')
  const currentText = editor?.getText() ?? ''
  const unchanged = currentHtml === initialHtml.trim() || (!currentText.trim() && !initialText)

  return (
    <div className="border-t border-hairline bg-parchment-bright p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {t('redaction.paragraph_editor_title', {
              defaultValue: 'Modifier le paragraphe {{index}}',
              index: paragraphIndex
            })}
          </span>
          <MarkButton
            active={editor?.isActive('bold') ?? false}
            label="Gras"
            title={t('redaction.editor_bold', { defaultValue: 'Gras' })}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <strong>{t('redaction.editor_bold_letter', { defaultValue: 'G' })}</strong>
          </MarkButton>
          <MarkButton
            active={editor?.isActive('italic') ?? false}
            label="Italique"
            title={t('redaction.editor_italic', { defaultValue: 'Italique' })}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <em>{t('redaction.editor_italic_letter', { defaultValue: 'I' })}</em>
          </MarkButton>
          <MarkButton
            active={editor?.isActive('underline') ?? false}
            label="Souligné"
            title={t('redaction.editor_underline', { defaultValue: 'Souligné' })}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            <u>{t('redaction.editor_underline_letter', { defaultValue: 'S' })}</u>
          </MarkButton>
        </div>
        <span className="text-xs text-ink-subtle">
          {t('redaction.paragraph_editor_hint', {
            defaultValue: 'La modification sera suivie comme une révision.'
          })}
        </span>
      </div>

      <div
        className="max-h-120 overflow-y-auto"
        style={alignment ? { textAlign: alignment } : undefined}
      >
        <EditorContent editor={editor} />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || unchanged || !currentText.trim()}
          onClick={() => onSave(currentText, currentHtml)}
          className="rounded-full bg-aurora px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-aurora/90 disabled:opacity-50"
        >
          {t('redaction.paragraph_editor_save', { defaultValue: 'Appliquer la révision' })}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-full border border-hairline px-4 py-1.5 text-sm text-ink-muted transition-colors hover:bg-parchment-dim"
        >
          {t('common.cancel', { defaultValue: 'Annuler' })}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="rounded-full border border-destructive-border px-4 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive-tint"
        >
          {t('redaction.paragraph_editor_delete', { defaultValue: 'Supprimer le paragraphe' })}
        </button>
      </div>
    </div>
  )
}
