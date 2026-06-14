import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TemplateTagifyProposal } from '@shared/types'
import {
  buildKnownTagIndex,
  extractTagPath,
  isValidTagPath,
  normalizeTagPath
} from '@shared/templateContent'
import { buildTagPathLocalizer, templateRoutineCatalog } from '@shared/templateRoutines'
import { Button, DialogShell } from '@renderer/components/ui'
import { useTemplateStore } from '@renderer/stores'

interface TagifyReviewDialogProps {
  templateUuid: string
  templateName: string
  onClose: () => void
  /** Called after replacements were applied so the caller can refresh its views. */
  onApplied: () => void
}

interface ReviewItem extends TemplateTagifyProposal {
  accepted: boolean
  /** User-editable tag path (canonical form). */
  tagPath: string
}

type DialogPhase =
  | { step: 'intro' }
  | { step: 'loading' }
  | { step: 'review'; items: ReviewItem[] }
  | { step: 'applying'; items: ReviewItem[] }
  | { step: 'done'; applied: number; failed: number }
  | { step: 'error'; message: string }

const CONFIDENCE_STYLE: Record<TemplateTagifyProposal['confidence'], string> = {
  high: 'border-success-border bg-success-tint text-success-deep',
  medium: 'border-[#d8d3c4] bg-[#f4f1e8] text-[#6b5d3a]',
  low: 'border-warning-border bg-warning-tint text-warning-deep'
}

export function TagifyReviewDialog({
  templateUuid,
  templateName,
  onClose,
  onApplied
}: TagifyReviewDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const tagifyAnalyze = useTemplateStore((state) => state.tagifyAnalyze)
  const tagifyApply = useTemplateStore((state) => state.tagifyApply)
  const [phase, setPhase] = useState<DialogPhase>({ step: 'intro' })

  const localizeTagPath = useMemo(
    () => buildTagPathLocalizer(templateRoutineCatalog, i18n.language),
    [i18n.language]
  )
  const knownTagIndex = useMemo(() => buildKnownTagIndex(templateRoutineCatalog), [])
  const catalogPaths = useMemo(
    () => [
      ...new Set(
        templateRoutineCatalog
          .filter((entry) => entry.visibility !== 'hidden')
          .map((entry) => normalizeTagPath(extractTagPath(entry.tag)))
      )
    ],
    []
  )

  async function startAnalysis(): Promise<void> {
    setPhase({ step: 'loading' })
    const result = await tagifyAnalyze({ templateUuid })
    if (!result.success) {
      setPhase({ step: 'error', message: result.error })
      return
    }
    setPhase({
      step: 'review',
      items: result.data.proposals.map((proposal) => ({
        ...proposal,
        tagPath: proposal.suggestedTag,
        accepted: proposal.confidence !== 'low'
      }))
    })
  }

  async function applyAccepted(items: ReviewItem[]): Promise<void> {
    const accepted = items.filter(
      (item) => item.accepted && isValidTagPath(item.tagPath, knownTagIndex)
    )
    if (accepted.length === 0) {
      onClose()
      return
    }
    setPhase({ step: 'applying', items })
    const result = await tagifyApply({
      templateUuid,
      replacements: accepted.map((item) => ({
        originalText: item.originalText,
        tagPath: normalizeTagPath(extractTagPath(item.tagPath))
      }))
    })
    if (!result.success) {
      setPhase({ step: 'error', message: result.error })
      return
    }
    onApplied()
    setPhase({ step: 'done', applied: result.data.applied, failed: result.data.failed.length })
  }

  function updateItem(index: number, patch: Partial<ReviewItem>): void {
    setPhase((current) => {
      if (current.step !== 'review') return current
      const items = current.items.map((item, i) => (i === index ? { ...item, ...patch } : item))
      return { step: 'review', items }
    })
  }

  return (
    <DialogShell size="xl" aria-label={t('templates.tagify.title')} onDismiss={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-ink">{t('templates.tagify.title')}</h3>
          <p className="text-sm text-ink-muted">
            {t('templates.tagify.subtitle', { name: templateName })}
          </p>
        </div>

        {phase.step === 'intro' ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-hairline bg-white px-6 py-10 text-center">
            <p className="max-w-xl text-sm text-ink">{t('templates.tagify.introBody')}</p>
            <Button type="button" onClick={() => void startAnalysis()}>
              {t('templates.tagify.startButton')}
            </Button>
          </div>
        ) : null}

        {phase.step === 'loading' || phase.step === 'applying' ? (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-hairline bg-white px-6 py-10 text-sm text-ink-muted">
            {phase.step === 'loading'
              ? t('templates.tagify.analyzing')
              : t('templates.tagify.applying')}
          </div>
        ) : null}

        {phase.step === 'error' ? (
          <div className="rounded-2xl border border-destructive-border bg-destructive-tint px-4 py-3 text-sm text-destructive">
            {phase.message}
          </div>
        ) : null}

        {phase.step === 'done' ? (
          <div className="rounded-2xl border border-success-border bg-success-tint px-4 py-3 text-sm text-success-deep">
            {t('templates.tagify.doneSummary', { applied: phase.applied, failed: phase.failed })}
          </div>
        ) : null}

        {phase.step === 'review' ? (
          phase.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-hairline bg-white px-4 py-8 text-center text-sm text-ink-muted">
              {t('templates.tagify.noProposals')}
            </div>
          ) : (
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {phase.items.map((item, index) => (
                <li
                  key={`${item.originalText}-${item.suggestedTag}`}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-white px-4 py-3"
                >
                  <input
                    type="checkbox"
                    checked={item.accepted}
                    onChange={(event) => updateItem(index, { accepted: event.target.checked })}
                    className="accent-aurora"
                    aria-label={t('templates.tagify.acceptLabel')}
                  />
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CONFIDENCE_STYLE[item.confidence]}`}
                  >
                    {t(`templates.tagify.confidence.${item.confidence}`)}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-sm text-ink"
                    title={item.originalText}
                  >
                    {`«\u00a0${item.originalText}\u00a0»`}
                    {item.occurrences > 1 ? (
                      <span className="ml-1 text-xs text-ink-subtle">×{item.occurrences}</span>
                    ) : null}
                  </span>
                  <span className="text-ink-subtle">→</span>
                  <div className="flex min-w-0 flex-col">
                    <input
                      type="text"
                      list="tagify-tag-options"
                      value={item.tagPath}
                      onChange={(event) => updateItem(index, { tagPath: event.target.value })}
                      className={`w-64 rounded-xl border px-3 py-1.5 font-mono text-xs outline-none transition focus:ring-2 focus:ring-aurora/35 ${
                        isValidTagPath(item.tagPath, knownTagIndex)
                          ? 'border-hairline bg-white text-aurora'
                          : 'border-warning-border bg-warning-tint text-warning-deep'
                      }`}
                    />
                    <span className="mt-0.5 truncate text-[11px] text-ink-muted">
                      {localizeTagPath(normalizeTagPath(extractTagPath(item.tagPath)))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}

        <datalist id="tagify-tag-options">
          {catalogPaths.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>

        <div className="flex shrink-0 justify-end gap-2 border-t border-hairline pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {phase.step === 'done'
              ? t('templates.tagify.closeButton')
              : t('templates.editor.cancelButton')}
          </Button>
          {phase.step === 'review' && phase.items.length > 0 ? (
            <Button type="button" onClick={() => void applyAccepted(phase.items)}>
              {t('templates.tagify.applyButton', {
                count: phase.items.filter((item) => item.accepted).length
              })}
            </Button>
          ) : null}
        </div>
      </div>
    </DialogShell>
  )
}
