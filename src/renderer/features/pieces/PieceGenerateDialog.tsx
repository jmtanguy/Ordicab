import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PieceGeneratedFileKind } from '@shared/types'
import { addDays, startOfWeek, toIsoDay } from '@shared/domain/calendarDates'

import { Button, DialogShell, Field, Input } from '@renderer/components/ui'
import { useDocumentStore } from '@renderer/stores/documentStore'
import { usePieceStore } from '@renderer/stores/pieceStore'

/** Dimanche (fin de semaine) de la semaine en cours, en ISO YYYY-MM-DD. */
function endOfCurrentWeekIso(): string {
  return toIsoDay(addDays(startOfWeek(new Date()), 6))
}

interface PieceGenerateDialogProps {
  dossierId: string
  defaultJuridiction: string
  onClose: () => void
}

const PHASE_KEYS: Record<string, { key: string; defaultValue: string }> = {
  converting: { key: 'pieces.phase_converting', defaultValue: 'Conversion des pièces…' },
  stamping: { key: 'pieces.phase_stamping', defaultValue: 'Apposition du tampon…' },
  index: { key: 'pieces.phase_index', defaultValue: 'Génération du bordereau…' },
  merging: { key: 'pieces.phase_merging', defaultValue: 'Fusion du dossier de pièces…' },
  writing: { key: 'pieces.phase_writing', defaultValue: 'Écriture des fichiers…' }
}

const FILE_KIND_LABELS: Record<PieceGeneratedFileKind, { key: string; defaultValue: string }> = {
  bordereau: { key: 'pieces.file_kind_bordereau', defaultValue: 'Bordereau' },
  bundle: { key: 'pieces.file_kind_bundle', defaultValue: 'Dossier de pièces relié' },
  piece: { key: 'pieces.file_kind_piece', defaultValue: 'Pièce' }
}

export function PieceGenerateDialog({
  dossierId,
  defaultJuridiction,
  onClose
}: PieceGenerateDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const generate = usePieceStore((state) => state.generate)
  const generateState = usePieceStore((state) => state.generateState)
  const resetGenerateState = usePieceStore((state) => state.resetGenerateState)
  const openFile = useDocumentStore((state) => state.openFile)

  const [bundle, setBundle] = useState(true)
  const [bordereau, setBordereau] = useState(true)
  const [individual, setIndividual] = useState(true)
  const [juridiction, setJuridiction] = useState(defaultJuridiction)
  const [rg, setRg] = useState('')
  const [parties, setParties] = useState('')
  const [place, setPlace] = useState('')
  // Date portée sur le bordereau : préremplie à la fin de semaine (dimanche).
  const [bordereauDate, setBordereauDate] = useState(endOfCurrentWeekIso)

  const isRunning = generateState.status === 'running'
  const result = generateState.result

  const handleClose = (): void => {
    if (isRunning) return
    resetGenerateState()
    onClose()
  }

  const handleGenerate = async (): Promise<void> => {
    await generate({
      dossierId,
      outputs: { bundle, bordereau, individual },
      header: {
        juridiction: juridiction.trim() || undefined,
        rg: rg.trim() || undefined,
        parties: parties.trim() || undefined,
        place: place.trim() || undefined
      },
      bordereauDate: bordereauDate || undefined
    })
  }

  const outputOptions: Array<{
    checked: boolean
    onChange: (value: boolean) => void
    label: string
    description: string
  }> = [
    {
      checked: bordereau,
      onChange: setBordereau,
      label: t('pieces.output_bordereau', { defaultValue: 'Bordereau de pièces (PDF seul)' }),
      description: t('pieces.output_bordereau_hint', {
        defaultValue: 'À annexer aux conclusions — transmis par RPVA.'
      })
    },
    {
      checked: bundle,
      onChange: setBundle,
      label: t('pieces.output_bundle', {
        defaultValue: 'Dossier de pièces relié (index + pièces tamponnées)'
      }),
      description: t('pieces.output_bundle_hint', {
        defaultValue:
          'Un seul PDF pour le dossier de plaidoirie ou la communication entre confrères.'
      })
    },
    {
      checked: individual,
      onChange: setIndividual,
      label: t('pieces.output_individual', { defaultValue: 'Un PDF par pièce' }),
      description: t('pieces.output_individual_hint', {
        defaultValue: '« Pièce n°X - intitulé.pdf » — adapté au dépôt RPVA (limites de taille).'
      })
    }
  ]

  return (
    <DialogShell
      size="lg"
      panelClassName="flex max-h-[88vh] flex-col"
      onDismiss={handleClose}
      aria-label={t('pieces.generate_dialog_title', { defaultValue: 'Générer les pièces' })}
    >
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">
          {t('pieces.generate_dialog_title', { defaultValue: 'Générer les pièces' })}
        </h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label={t('common.close', { defaultValue: 'Fermer' })}
          className="rounded-lg p-1.5 text-ink-muted transition hover:bg-aurora/10 hover:text-aurora"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        {result === null ? (
          <>
            <section className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
                {t('pieces.generate_outputs_label', { defaultValue: 'Documents à produire' })}
              </p>
              {outputOptions.map((option) => (
                <label
                  key={option.label}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-white/70 px-3 py-2.5"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-aurora"
                    checked={option.checked}
                    onChange={(event) => option.onChange(event.target.checked)}
                    disabled={isRunning}
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">{option.label}</span>
                    <span className="block text-xs text-ink-muted">{option.description}</span>
                  </span>
                </label>
              ))}
            </section>

            <section className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
                {t('pieces.generate_header_label', {
                  defaultValue: 'En-tête du bordereau (optionnel)'
                })}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  density="compact"
                  label={t('pieces.header_juridiction', { defaultValue: 'Juridiction' })}
                >
                  <Input
                    density="compact"
                    value={juridiction}
                    onChange={(event) => setJuridiction(event.target.value)}
                    disabled={isRunning}
                  />
                </Field>
                <Field density="compact" label={t('pieces.header_rg', { defaultValue: 'N° RG' })}>
                  <Input
                    density="compact"
                    value={rg}
                    onChange={(event) => setRg(event.target.value)}
                    disabled={isRunning}
                  />
                </Field>
              </div>
              <Field
                density="compact"
                label={t('pieces.header_parties', {
                  defaultValue: 'Parties (ex. « Pour : … / Contre : … »)'
                })}
              >
                <Input
                  density="compact"
                  value={parties}
                  onChange={(event) => setParties(event.target.value)}
                  disabled={isRunning}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  density="compact"
                  label={t('pieces.header_place', { defaultValue: 'Fait à' })}
                >
                  <Input
                    density="compact"
                    value={place}
                    onChange={(event) => setPlace(event.target.value)}
                    disabled={isRunning}
                  />
                </Field>
                <Field
                  density="compact"
                  label={t('pieces.bordereau_date_label', {
                    defaultValue: 'Le (date du bordereau)'
                  })}
                >
                  <Input
                    density="compact"
                    type="date"
                    value={bordereauDate}
                    onChange={(event) => setBordereauDate(event.target.value)}
                    disabled={isRunning}
                  />
                </Field>
              </div>
              <p className="text-xs text-ink-subtle">
                {t('pieces.bordereau_date_hint', {
                  defaultValue:
                    'Préremplie à la fin de la semaine en cours (dimanche). Date portée sur le bordereau et le dossier de sortie.'
                })}
              </p>
            </section>

            {isRunning ? (
              <div className="rounded-xl border border-aurora/30 bg-aurora/5 px-4 py-3">
                <p className="text-sm font-medium text-aurora">
                  {generateState.progress
                    ? t(PHASE_KEYS[generateState.progress.phase]?.key ?? '', {
                        defaultValue: PHASE_KEYS[generateState.progress.phase]?.defaultValue ?? '…'
                      })
                    : t('pieces.generate_starting', { defaultValue: 'Préparation…' })}
                </p>
                {generateState.progress ? (
                  <>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {generateState.progress.label}
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-aurora/15">
                      <div
                        className="h-full rounded-full bg-aurora transition-all"
                        style={{
                          width: `${Math.round((generateState.progress.current / Math.max(generateState.progress.total, 1)) * 100)}%`
                        }}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {generateState.status === 'error' && generateState.error ? (
              <p className="rounded-xl bg-[#b23a3a]/10 px-4 py-3 text-sm text-[#b23a3a]">
                {generateState.error}
              </p>
            ) : null}
          </>
        ) : (
          <section className="space-y-3">
            <p className="text-sm font-medium text-success">
              {t('pieces.generate_done', {
                defaultValue:
                  '{{count}} fichier(s) généré(s) dans « {{folder}} » (visible dans Documents).',
                count: result.files.length,
                folder: result.outputFolderRelativePath
              })}
            </p>
            <ul className="space-y-1.5">
              {result.files.map((file) => (
                <li
                  key={file.relativePath}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-white/70 px-3 py-2"
                >
                  <span className="inline-flex shrink-0 items-center rounded-full bg-aurora/10 px-2 py-0.5 text-[11px] font-medium text-aurora">
                    {t(FILE_KIND_LABELS[file.kind].key, {
                      defaultValue: FILE_KIND_LABELS[file.kind].defaultValue
                    })}
                    {file.pieceNumber ? ` n°${file.pieceNumber}` : ''}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {file.relativePath.split('/').pop()}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void openFile({ dossierId, documentPath: file.relativePath })}
                  >
                    {t('common.open', { defaultValue: 'Ouvrir' })}
                  </Button>
                </li>
              ))}
            </ul>
            {result.failed.length > 0 ? (
              <div className="rounded-xl bg-[#b23a3a]/10 px-4 py-3">
                <p className="text-sm font-medium text-[#b23a3a]">
                  {t('pieces.generate_failed_title', {
                    defaultValue: '{{count}} pièce(s) en échec :',
                    count: result.failed.length
                  })}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-[#b23a3a]">
                  {result.failed.map((failure) => (
                    <li key={failure.pieceNumber}>
                      {t('pieces.generate_failed_entry', {
                        defaultValue: 'Pièce n°{{number}} — {{title}} : {{error}}',
                        number: failure.pieceNumber,
                        title: failure.title,
                        error: failure.error
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}
      </div>

      <footer className="mt-4 flex justify-end gap-2 border-t border-hairline pt-3">
        {result === null ? (
          <>
            <Button type="button" variant="ghost" onClick={handleClose} disabled={isRunning}>
              {t('common.cancel', { defaultValue: 'Annuler' })}
            </Button>
            <Button
              type="button"
              disabled={isRunning || (!bundle && !bordereau && !individual)}
              onClick={() => void handleGenerate()}
            >
              {isRunning
                ? t('pieces.generate_running', { defaultValue: 'Génération…' })
                : t('pieces.generate_confirm', { defaultValue: 'Générer' })}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={handleClose}>
            {t('common.close', { defaultValue: 'Fermer' })}
          </Button>
        )}
      </footer>
    </DialogShell>
  )
}
