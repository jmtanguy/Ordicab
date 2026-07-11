/**
 * Right pane of the drafting workspace: Aperçu (faithful docx render with
 * paragraph selection + inline editor) | Diff (redline vs the base document).
 */

import React from 'react'
import { useTranslation } from 'react-i18next'

import { SegmentedControl } from '../dossiers/sectionLayout'
import { DiffView } from '../compare/DiffView'
import { useRedactionStore } from '../../stores/redactionStore'
import { DocxPreviewSurface } from './DocxPreviewSurface'
import { ParagraphEditor } from './ParagraphEditor'

export function RedactionPreviewPane({
  scrollToParagraph
}: {
  scrollToParagraph: number | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const snapshot = useRedactionStore((state) => state.snapshot)
  const viewMode = useRedactionStore((state) => state.viewMode)
  const setViewMode = useRedactionStore((state) => state.setViewMode)
  const selectedParagraphIndex = useRedactionStore((state) => state.selectedParagraphIndex)
  const selectParagraph = useRedactionStore((state) => state.selectParagraph)
  const editingParagraphIndex = useRedactionStore((state) => state.editingParagraphIndex)
  const setEditingParagraph = useRedactionStore((state) => state.setEditingParagraph)
  const manualEditParagraph = useRedactionStore((state) => state.manualEditParagraph)
  const deleteParagraph = useRedactionStore((state) => state.deleteParagraph)
  const loading = useRedactionStore((state) => state.loading)
  const chatBusy = useRedactionStore((state) => state.chatBusy)

  if (!snapshot) return <></>

  const editingParagraph =
    editingParagraphIndex !== null
      ? snapshot.paragraphs.find((p) => p.index === editingParagraphIndex)
      : undefined

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
        <SegmentedControl
          value={viewMode}
          onChange={setViewMode}
          options={[
            {
              value: 'preview' as const,
              label: t('redaction.view_preview', { defaultValue: 'Aperçu' })
            },
            { value: 'diff' as const, label: t('redaction.view_diff', { defaultValue: 'Diff' }) }
          ]}
        />
        <span className="text-xs text-ink-subtle">
          {t('redaction.preview_stats', {
            defaultValue: '{{paragraphs}} paragraphes · {{pending}} révision(s) en attente',
            paragraphs: snapshot.paragraphs.length,
            pending: snapshot.pendingOps.filter((op) => op.decision === 'keep_tracked').length
          })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        {viewMode === 'preview' ? (
          // No wrapper card: the Word document carries its own page margins,
          // any extra padding here is wasted space.
          <DocxPreviewSurface
            dataUrl={snapshot.previewDataUrl}
            selectedParagraphIndex={selectedParagraphIndex}
            onSelectParagraph={selectParagraph}
            onEditParagraph={(index) => {
              selectParagraph(index)
              setEditingParagraph(index)
            }}
            scrollToParagraph={scrollToParagraph}
          />
        ) : (
          <div className="p-4">
            <DiffView blocks={snapshot.diffBlocks} />
          </div>
        )}
      </div>

      {editingParagraph && (
        <ParagraphEditor
          key={`${editingParagraph.index}-${snapshot.session.cursor}`}
          paragraphIndex={editingParagraph.index}
          initialText={editingParagraph.text}
          initialHtml={editingParagraph.html}
          alignment={editingParagraph.alignment}
          busy={loading || chatBusy}
          onSave={(text, html) => void manualEditParagraph(editingParagraph.index, text, html)}
          onDelete={() => void deleteParagraph(editingParagraph.index)}
          onCancel={() => setEditingParagraph(null)}
        />
      )}
    </section>
  )
}
