import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { CompareProgressEvent, ComparisonResult, DocumentRecord } from '@shared/types'

import { AlertBanner, Button, Field, Select } from '@renderer/components/ui'
import { SectionHeader } from '@renderer/features/dossiers/sectionLayout'
import { useCompareStore } from '@renderer/stores/compareStore'
import { useDocumentStore } from '@renderer/stores/documentStore'

import { CitationsPanel } from './CitationsPanel'
import { DiffView } from './DiffView'
import { PieceReferencesPanel } from './PieceReferencesPanel'

interface CompareSectionProps {
  dossier: { slug: string; name: string }
}

const EMPTY_DOCUMENTS: DocumentRecord[] = []

function progressLabel(
  progress: CompareProgressEvent | null,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!progress) return t('compare.stage_starting', { defaultValue: 'Préparation…' })
  const stageLabels: Record<CompareProgressEvent['stage'], string> = {
    'extract-old': t('compare.stage_extract_old', {
      defaultValue: 'Lecture de la version antérieure…'
    }),
    'extract-new': t('compare.stage_extract_new', {
      defaultValue: 'Lecture de la nouvelle version…'
    }),
    diff: t('compare.stage_diff', { defaultValue: 'Comparaison des textes…' }),
    citations: t('compare.stage_citations', {
      defaultValue: 'Vérification des citations ({{chunk}}/{{totalChunks}})…',
      chunk: progress.chunk ?? 1,
      totalChunks: progress.totalChunks ?? 1
    })
  }
  const base = stageLabels[progress.stage]
  if (progress.phase === 'ocr' && progress.totalPages) {
    return `${base} ${t('compare.ocr_progress', {
      defaultValue: 'OCR page {{page}}/{{totalPages}}',
      page: progress.page,
      totalPages: progress.totalPages
    })}`
  }
  return base
}

function usedOcr(result: ComparisonResult): boolean {
  return result.oldDocument.method === 'tesseract' || result.newDocument.method === 'tesseract'
}

export function CompareSection({ dossier }: CompareSectionProps): React.JSX.Element {
  const { t } = useTranslation()

  const documents =
    useDocumentStore((state) => state.documentsByDossierId[dossier.slug]) ?? EMPTY_DOCUMENTS
  const loadDocuments = useDocumentStore((state) => state.load)

  const setDossier = useCompareStore((state) => state.setDossier)
  const oldDocumentPath = useCompareStore((state) => state.oldDocumentPath)
  const newDocumentPath = useCompareStore((state) => state.newDocumentPath)
  const verifyCitations = useCompareStore((state) => state.verifyCitations)
  const status = useCompareStore((state) => state.status)
  const progress = useCompareStore((state) => state.progress)
  const result = useCompareStore((state) => state.result)
  const error = useCompareStore((state) => state.error)
  const setOldDocumentPath = useCompareStore((state) => state.setOldDocumentPath)
  const setNewDocumentPath = useCompareStore((state) => state.setNewDocumentPath)
  const swapSelection = useCompareStore((state) => state.swapSelection)
  const setVerifyCitations = useCompareStore((state) => state.setVerifyCitations)
  const run = useCompareStore((state) => state.run)

  useEffect(() => {
    setDossier(dossier.slug)
    void loadDocuments({ dossierId: dossier.slug })
  }, [dossier.slug, setDossier, loadDocuments])

  const extractableDocuments = useMemo(
    () =>
      [...documents]
        .filter((record) => record.textExtraction.isExtractable)
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'fr')),
    [documents]
  )

  const isRunning = status === 'running'
  const canRun =
    !isRunning && !!oldDocumentPath && !!newDocumentPath && oldDocumentPath !== newDocumentPath

  const renderPicker = (
    label: string,
    value: string | null,
    onChange: (path: string | null) => void
  ): React.JSX.Element => (
    <Field density="compact" className="min-w-0 flex-1" label={label}>
      <Select
        density="compact"
        value={value ?? ''}
        disabled={isRunning}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">
          {t('compare.pick_placeholder', { defaultValue: 'Choisir un document…' })}
        </option>
        {extractableDocuments.map((record) => (
          <option key={record.relativePath} value={record.relativePath}>
            {record.relativePath}
          </option>
        ))}
      </Select>
    </Field>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <SectionHeader
        badge={t('compare.section_title', { defaultValue: 'Comparaison de conclusions' })}
        badgeTitle={t('compare.section_subtitle', {
          defaultValue:
            'Comparez deux versions d’un document (Word ou PDF) : ajouts, suppressions, citations juridiques et pièces nouvellement invoquées.'
        })}
      />

      <div className="rounded-2xl border border-hairline bg-white/80 p-4">
        <div className="flex flex-wrap items-end gap-3">
          {renderPicker(
            t('compare.pick_old', { defaultValue: 'Version antérieure' }),
            oldDocumentPath,
            setOldDocumentPath
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={isRunning || (!oldDocumentPath && !newDocumentPath)}
            onClick={swapSelection}
            aria-label={t('compare.swap', { defaultValue: 'Inverser les versions' })}
            title={t('compare.swap', { defaultValue: 'Inverser les versions' })}
          >
            ⇄
          </Button>
          {renderPicker(
            t('compare.pick_new', { defaultValue: 'Nouvelle version' }),
            newDocumentPath,
            setNewDocumentPath
          )}
          <Button type="button" disabled={!canRun} onClick={() => void run()}>
            {t('compare.run', { defaultValue: 'Comparer' })}
          </Button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 accent-aurora"
            checked={verifyCitations}
            disabled={isRunning}
            onChange={(event) => setVerifyCitations(event.target.checked)}
          />
          {t('compare.verify_citations', {
            defaultValue: 'Vérifier les citations juridiques du texte ajouté (Légifrance)'
          })}
        </label>
        {extractableDocuments.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            {t('compare.no_extractable_documents', {
              defaultValue: 'Aucun document texte exploitable dans ce dossier.'
            })}
          </p>
        ) : null}
      </div>

      {isRunning ? (
        <AlertBanner tone="neutral" role="status">
          {progressLabel(progress, t)}
        </AlertBanner>
      ) : null}

      {status === 'error' && error ? <AlertBanner tone="error">{error}</AlertBanner> : null}

      {status === 'done' && result ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">
              {t('compare.stats_added', {
                defaultValue: '+{{count}} mots',
                count: result.stats.addedWords
              })}
            </span>
            <span className="rounded-full bg-red-50 px-3 py-1 font-semibold text-red-600">
              {t('compare.stats_removed', {
                defaultValue: '−{{count}} mots',
                count: result.stats.removedWords
              })}
            </span>
            <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700">
              {t('compare.stats_modified', {
                defaultValue: '{{count}} passages modifiés',
                count: result.stats.modifiedBlocks
              })}
            </span>
          </div>

          {usedOcr(result) ? (
            <AlertBanner tone="warning">
              {t('compare.ocr_warning', {
                defaultValue:
                  'Au moins un des deux documents provient d’une numérisation (OCR) — le comparatif peut contenir du bruit.'
              })}
            </AlertBanner>
          ) : null}

          <div className="grid min-h-0 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-hairline bg-white/80 p-4 lg:col-span-2">
              <DiffView blocks={result.blocks} />
            </div>
            <div className="space-y-4">
              <CitationsPanel citations={result.citations} />
              <PieceReferencesPanel pieceReferences={result.pieceReferences} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
