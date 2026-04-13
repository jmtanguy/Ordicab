import { useEffect, useMemo, useRef } from 'react'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui'
import { ensureTemplateHtml, extractTagPath, getTemplateEditorHtml } from '@shared/templateContent'
import { buildTagPathLocalizer, templateRoutineCatalog } from '@shared/templateRoutines'

import { FontSizeExtension } from './FontSizeExtension'
import { SmartTagExtension } from './SmartTagExtension'

interface RichTextEditorProps {
  ariaLabel: string
  value: string
  onChange: (value: string) => void
  /** When provided, the editor populates this ref with its tag-insert function so a parent can call it. */
  tagInsertRef?: React.MutableRefObject<((tagPath: string) => void) | null>
  /** When provided, the editor populates this ref with a plain-text insert function. */
  textInsertRef?: React.MutableRefObject<((text: string) => void) | null>
  /** When true, renders a read-only preview without the toolbar. */
  readOnly?: boolean
  /**
   * When true (implies readOnly), renders as a clean white document preview —
   * full brightness, no dimming, no border. Suitable for the save/review step.
   */
  documentPreview?: boolean
}

const FONT_FAMILY_OPTIONS = [
  { label: 'Avenir Next', value: '"Avenir Next", "Segoe UI", sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", monospace' }
]

const FONT_SIZE_OPTIONS = ['12px', '14px', '16px', '18px', '24px', '32px']

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function IconBold(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 4h8a4 4 0 0 1 0 8H6zm0 8h9a4 4 0 0 1 0 8H6z" />
    </svg>
  )
}

function IconItalic(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11 4h2l-4 16H7zm2 0h4v2h-4zm-8 14h4v2H5z" />
    </svg>
  )
}

function IconUnderline(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 3v7a6 6 0 0 0 12 0V3h-2v7a4 4 0 0 1-8 0V3H6zm-2 17h16v2H4z" />
    </svg>
  )
}

function IconBulletList(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="4" cy="7" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="4" cy="17" r="2" />
      <rect x="8" y="6" width="13" height="2" rx="1" />
      <rect x="8" y="11" width="13" height="2" rx="1" />
      <rect x="8" y="16" width="13" height="2" rx="1" />
    </svg>
  )
}

function IconOrderedList(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 6h1v2H4V6zm0 4h2v1H4v1h2v1H3v-1H4v-1H3v-1h1zm0 5h1.5c.8 0 1.5.6 1.5 1.4 0 .4-.2.8-.5 1 .4.2.5.6.5 1 0 .8-.7 1.4-1.5 1.4H4v-1h1.5c.3 0 .5-.2.5-.4 0-.3-.2-.4-.5-.4H4V16h1.5c.3 0 .5-.2.5-.4 0-.3-.2-.4-.5-.4H4v-1z" />
      <rect x="8" y="6" width="13" height="2" rx="1" />
      <rect x="8" y="11" width="13" height="2" rx="1" />
      <rect x="8" y="16" width="13" height="2" rx="1" />
    </svg>
  )
}

function IconAlignLeft(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="5" width="18" height="2" rx="1" />
      <rect x="3" y="9" width="12" height="2" rx="1" />
      <rect x="3" y="13" width="16" height="2" rx="1" />
      <rect x="3" y="17" width="10" height="2" rx="1" />
    </svg>
  )
}

function IconAlignCenter(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="5" width="18" height="2" rx="1" />
      <rect x="6" y="9" width="12" height="2" rx="1" />
      <rect x="4" y="13" width="16" height="2" rx="1" />
      <rect x="7" y="17" width="10" height="2" rx="1" />
    </svg>
  )
}

function IconAlignRight(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="5" width="18" height="2" rx="1" />
      <rect x="9" y="9" width="12" height="2" rx="1" />
      <rect x="5" y="13" width="16" height="2" rx="1" />
      <rect x="11" y="17" width="10" height="2" rx="1" />
    </svg>
  )
}

function IconAlignJustify(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="5" width="18" height="2" rx="1" />
      <rect x="3" y="9" width="18" height="2" rx="1" />
      <rect x="3" y="13" width="18" height="2" rx="1" />
      <rect x="3" y="17" width="12" height="2" rx="1" />
    </svg>
  )
}

function IconUndo(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  )
}

function IconRedo(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 14 20 9 15 4" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  )
}

// ── ToolbarButton ─────────────────────────────────────────────────────────────

function ToolbarButton({
  isActive,
  label,
  icon,
  onClick
}: {
  isActive?: boolean
  label: string
  icon: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={label}
      aria-label={label}
      className={cn(
        'h-8 w-8 p-0 border border-white/10 bg-slate-900/70 text-slate-300 hover:bg-slate-800 hover:text-slate-100',
        isActive && 'border-aurora/45 bg-aurora/10 text-aurora-soft'
      )}
      onClick={onClick}
    >
      {icon}
    </Button>
  )
}

function ToolbarTextButton({
  isActive,
  label,
  text,
  onClick
}: {
  isActive?: boolean
  label: string
  text: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={label}
      aria-label={label}
      className={cn(
        'h-8 px-2 border border-white/10 bg-slate-900/70 text-slate-300 hover:bg-slate-800 hover:text-slate-100 font-bold text-xs',
        isActive && 'border-aurora/45 bg-aurora/10 text-aurora-soft'
      )}
      onClick={onClick}
    >
      {text}
    </Button>
  )
}

// ── Toolbar separator ──────────────────────────────────────────────────────────

function ToolbarSep(): React.JSX.Element {
  return <span className="h-5 w-px bg-white/10" aria-hidden="true" />
}

// ── RichTextEditor ────────────────────────────────────────────────────────────

export function RichTextEditor({
  ariaLabel,
  value,
  onChange,
  tagInsertRef,
  textInsertRef,
  readOnly = false,
  documentPreview = false
}: RichTextEditorProps): React.JSX.Element {
  const isReadOnly = readOnly || documentPreview
  const { t, i18n } = useTranslation()
  const isInternalUpdate = useRef(false)
  const normalizedContent = tagInsertRef ? getTemplateEditorHtml(value) : ensureTemplateHtml(value)

  const localizeTagPath = useMemo(
    () => buildTagPathLocalizer(templateRoutineCatalog, i18n.language),
    [i18n.language]
  )

  const editor = useEditor({
    immediatelyRender: false,
    editable: !isReadOnly,
    extensions: [
      StarterKit.configure({
        underline: false
      }),
      TextStyle,
      Color,
      FontFamily,
      FontSizeExtension,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph']
      }),
      SmartTagExtension.configure({ localizeTagPath })
    ],
    content: normalizedContent,
    editorProps: {
      attributes: {
        class: 'ord-rich-editor min-h-full px-6 py-5 text-sm leading-7 focus:outline-none',
        role: 'textbox',
        'aria-label': ariaLabel
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      isInternalUpdate.current = true
      onChange(currentEditor.getHTML())
    }
  })

  useEffect(() => {
    if (!editor) {
      return
    }

    if (isInternalUpdate.current) {
      isInternalUpdate.current = false
      return
    }

    if (editor.getHTML() === normalizedContent) {
      return
    }

    editor.commands.setContent(normalizedContent, {
      emitUpdate: false
    })
  }, [editor, normalizedContent])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!isReadOnly)
  }, [editor, isReadOnly])

  // Re-render SmartTag chips when locale changes
  useEffect(() => {
    if (!editor) return
    editor.extensionManager.extensions.forEach((ext) => {
      if (ext.name === 'smartTag') {
        ext.options.localizeTagPath = localizeTagPath
      }
    })
    const html = editor.getHTML()
    editor.commands.setContent(html, { emitUpdate: false })
  }, [editor, localizeTagPath])

  useEffect(() => {
    return () => {
      editor?.destroy()
    }
  }, [editor])

  function handleInsertTag(tagPath: string): void {
    editor?.chain().focus().insertSmartTag(extractTagPath(tagPath)).run()
  }

  useEffect(() => {
    if (tagInsertRef) {
      tagInsertRef.current = handleInsertTag
    }
    return () => {
      if (tagInsertRef) {
        tagInsertRef.current = null
      }
    }
  })

  useEffect(() => {
    if (textInsertRef) {
      textInsertRef.current = (text: string) => {
        editor?.chain().focus().insertContent(text).run()
      }
    }
    return () => {
      if (textInsertRef) {
        textInsertRef.current = null
      }
    }
  })

  if (!editor) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300">
        {t('templates.loading')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl shadow-lg',
          documentPreview
            ? 'border-0 bg-white'
            : isReadOnly
              ? 'border border-white/8 bg-slate-950/30 opacity-80'
              : 'border border-white/15'
        )}
      >
        {/* Toolbar — dark */}
        <div
          className={cn(
            'flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/10 bg-slate-900 px-3 py-2',
            isReadOnly && 'hidden'
          )}
        >
          {/* Font family */}
          <select
            aria-label={t('templates.richText.fontFamily')}
            title={t('templates.richText.fontFamily')}
            className="h-8 rounded-lg border border-white/10 bg-slate-800 px-2 py-0 text-xs text-slate-200 focus:outline-none"
            value={editor.getAttributes('textStyle').fontFamily ?? ''}
            onChange={(event) => {
              const nextValue = event.target.value
              if (!nextValue) {
                editor.chain().focus().unsetFontFamily().run()
                return
              }
              editor.chain().focus().setFontFamily(nextValue).run()
            }}
          >
            <option value="">{t('templates.richText.defaultFont')}</option>
            {FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {/* Font size */}
          <select
            aria-label={t('templates.richText.fontSize')}
            title={t('templates.richText.fontSize')}
            className="h-8 w-20 rounded-lg border border-white/10 bg-slate-800 px-2 py-0 text-xs text-slate-200 focus:outline-none"
            value={editor.getAttributes('textStyle').fontSize ?? ''}
            onChange={(event) => {
              const nextValue = event.target.value
              if (!nextValue) {
                editor.chain().focus().unsetFontSize().run()
                return
              }
              editor.chain().focus().setFontSize(nextValue).run()
            }}
          >
            <option value="">{t('templates.richText.defaultSize')}</option>
            {FONT_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          {/* Color */}
          <label
            className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-2 text-xs text-slate-300 cursor-pointer"
            title={t('templates.richText.color')}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="shrink-0"
            >
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.2-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16c3.3 0 6-2.7 6-6 0-4.9-4.5-9-10-9zm-5.5 10c-.8 0-1.5-.7-1.5-1.5S5.7 9 6.5 9 8 9.7 8 10.5 7.3 12 6.5 12zm3-4C8.7 8 8 7.3 8 6.5S8.7 5 9.5 5s1.5.7 1.5 1.5S10.3 8 9.5 8zm5 0c-.8 0-1.5-.7-1.5-1.5S13.7 5 14.5 5s1.5.7 1.5 1.5S15.3 8 14.5 8zm3 4c-.8 0-1.5-.7-1.5-1.5S16.7 9 17.5 9s1.5.7 1.5 1.5-.7 1.5-1.5 1.5z" />
            </svg>
            <input
              aria-label={t('templates.richText.color')}
              type="color"
              value={editor.getAttributes('textStyle').color ?? '#1e293b'}
              onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
              className="h-5 w-6 border-0 bg-transparent p-0 cursor-pointer"
            />
          </label>

          <ToolbarSep />

          {/* Text formatting */}
          <ToolbarButton
            label={t('templates.richText.bold')}
            icon={<IconBold />}
            isActive={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            label={t('templates.richText.italic')}
            icon={<IconItalic />}
            isActive={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            label={t('templates.richText.underline')}
            icon={<IconUnderline />}
            isActive={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />

          <ToolbarSep />

          {/* Headings */}
          <ToolbarTextButton
            label="Heading 1"
            text="H1"
            isActive={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <ToolbarTextButton
            label="Heading 2"
            text="H2"
            isActive={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          />

          <ToolbarSep />

          {/* Lists */}
          <ToolbarButton
            label={t('templates.richText.bullets')}
            icon={<IconBulletList />}
            isActive={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            label={t('templates.richText.numbered')}
            icon={<IconOrderedList />}
            isActive={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />

          <ToolbarSep />

          {/* Alignment */}
          <ToolbarButton
            label={t('templates.richText.alignLeft')}
            icon={<IconAlignLeft />}
            isActive={editor.isActive({ textAlign: 'left' })}
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
          />
          <ToolbarButton
            label={t('templates.richText.alignCenter')}
            icon={<IconAlignCenter />}
            isActive={editor.isActive({ textAlign: 'center' })}
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
          />
          <ToolbarButton
            label={t('templates.richText.alignRight')}
            icon={<IconAlignRight />}
            isActive={editor.isActive({ textAlign: 'right' })}
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
          />
          <ToolbarButton
            label={t('templates.richText.alignJustify')}
            icon={<IconAlignJustify />}
            isActive={editor.isActive({ textAlign: 'justify' })}
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          />

          <ToolbarSep />

          {/* Undo / Redo */}
          <ToolbarButton
            label={t('templates.richText.undo')}
            icon={<IconUndo />}
            onClick={() => editor.chain().focus().undo().run()}
          />
          <ToolbarButton
            label={t('templates.richText.redo')}
            icon={<IconRedo />}
            onClick={() => editor.chain().focus().redo().run()}
          />
        </div>

        {/* Editor content — white background, scrollable */}
        <div className="flex min-h-0 flex-1 overflow-y-auto bg-white">
          <EditorContent className="min-h-full flex-1 bg-white" editor={editor} />
        </div>
      </div>
    </div>
  )
}
