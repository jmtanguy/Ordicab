// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TemplateDraft, TemplateRecord } from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'

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

import { TemplateEditor } from '../TemplateEditor'

afterEach(() => {
  cleanup()
})

function TemplateEditorHarness({
  initialDraft,
  template,
  mode = 'edit',
  preferredSourceType = 'text',
  onRemoveDocx
}: {
  initialDraft?: TemplateDraft
  template?: TemplateRecord | null
  mode?: 'create' | 'edit'
  preferredSourceType?: 'text' | 'docx'
  onRemoveDocx?: () => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState<TemplateDraft>(
    initialDraft ?? {
      name: 'Template',
      content: 'Hello world'
    }
  )

  return (
    <>
      <TemplateEditor
        isSaving={false}
        mode={mode}
        value={draft}
        template={template}
        preferredSourceType={preferredSourceType}
        errors={{}}
        onCancel={() => undefined}
        onChange={(field, value) => {
          setDraft((current) => ({
            ...current,
            [field]: value
          }))
        }}
        onSubmit={async () => undefined}
        onRemoveDocx={onRemoveDocx}
      />
      <output data-testid="template-html">{draft.content}</output>
    </>
  )
}

async function renderEditor(options?: {
  initialDraft?: TemplateDraft
  template?: TemplateRecord | null
  mode?: 'create' | 'edit'
  preferredSourceType?: 'text' | 'docx'
  onRemoveDocx?: () => Promise<void>
}): Promise<void> {
  const i18n = await createRendererI18n('en')

  render(
    <I18nextProvider i18n={i18n}>
      <TemplateEditorHarness
        initialDraft={options?.initialDraft}
        template={options?.template}
        mode={options?.mode}
        preferredSourceType={options?.preferredSourceType}
        onRemoveDocx={options?.onRemoveDocx}
      />
    </I18nextProvider>
  )
}

describe('TemplateEditor', () => {
  it('forwards content changes from the rich text editor back into the template draft', async () => {
    await renderEditor({
      initialDraft: {
        name: 'Legacy template',
        content: 'Hello world'
      },
      template: {
        id: 'tpl-1',
        name: 'Legacy template',
        updatedAt: '2026-03-15T12:00:00.000Z',
        macros: [],
        hasDocxSource: false
      }
    })

    fireEvent.change(screen.getByLabelText('Content'), {
      target: { value: '<p>Hello world</p>' }
    })

    expect(screen.getByTestId('template-html').textContent).toBe('<p>Hello world</p>')
  })

  it('inserts smart tags as atomic chips in the stored html', async () => {
    await renderEditor({
      template: {
        id: 'tpl-1',
        name: 'Template',
        updatedAt: '2026-03-15T12:00:00.000Z',
        macros: [],
        hasDocxSource: false
      }
    })

    fireEvent.click(screen.getByTestId('mock-insert-tag'))

    expect(screen.getByTestId('template-html').textContent).toContain(
      'data-template-tag-path="dossier.name"'
    )
  })

  it('shows DOCX actions and relabels content when the template has a DOCX source', async () => {
    await renderEditor({
      template: {
        id: 'tpl-1',
        name: 'Word template',
        updatedAt: '2026-03-15T12:00:00.000Z',
        macros: [],
        hasDocxSource: true
      }
    })

    expect(screen.getByText('Word document attached')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Open in Word' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Remove .docx source' })).toBeTruthy()
    expect(screen.getByLabelText('Content (from Word source)')).toBeTruthy()
  })

  it('calls onRemoveDocx when the user confirms the removal dialog', async () => {
    const onRemoveDocx = vi.fn(async () => undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await renderEditor({
      template: {
        id: 'tpl-1',
        name: 'Word template',
        updatedAt: '2026-03-15T12:00:00.000Z',
        macros: [],
        hasDocxSource: true
      },
      onRemoveDocx
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove .docx source' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(onRemoveDocx).toHaveBeenCalledTimes(1)
  })

  it('does not call onRemoveDocx when the user cancels the removal dialog', async () => {
    const onRemoveDocx = vi.fn(async () => undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    await renderEditor({
      template: {
        id: 'tpl-1',
        name: 'Word template',
        updatedAt: '2026-03-15T12:00:00.000Z',
        macros: [],
        hasDocxSource: true
      },
      onRemoveDocx
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove .docx source' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(onRemoveDocx).not.toHaveBeenCalled()
  })

  it('shows the import action for edit mode and dedicated docx creation mode', async () => {
    await renderEditor({
      template: {
        id: 'tpl-1',
        name: 'Text template',
        updatedAt: '2026-03-15T12:00:00.000Z',
        macros: [],
        hasDocxSource: false
      }
    })

    expect(screen.getByRole('button', { name: 'Import .docx source' })).toBeTruthy()

    cleanup()

    const i18n = await createRendererI18n('en')
    render(
      <I18nextProvider i18n={i18n}>
        <TemplateEditorHarness mode="create" template={null} preferredSourceType="docx" />
      </I18nextProvider>
    )

    expect(screen.getAllByRole('button', { name: 'Import .docx source' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Open in Word' })).toBeNull()
  })
})
