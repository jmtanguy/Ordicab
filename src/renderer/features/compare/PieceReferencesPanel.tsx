import { useTranslation } from 'react-i18next'

import type { DetectedPieceReference } from '@shared/types'

import { scrollToBlock } from './diffNavigation'

export function PieceReferencesPanel({
  pieceReferences
}: {
  pieceReferences: DetectedPieceReference[]
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <section className="rounded-2xl border border-hairline bg-white/80 p-4">
      <h3 className="text-sm font-semibold text-ink">
        {t('compare.pieces_title', { defaultValue: 'Pièces nouvellement citées' })}
      </h3>
      <div className="mt-2">
        {pieceReferences.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {t('compare.no_pieces_detected', {
              defaultValue: 'Aucune nouvelle pièce citée dans le texte ajouté.'
            })}
          </p>
        ) : (
          <ul className="space-y-2">
            {pieceReferences.map((reference, index) => (
              <li key={index} className="rounded-lg border border-hairline bg-white p-3">
                <p className="text-sm font-semibold text-ink">
                  {t('compare.piece_numbers', {
                    defaultValue: 'Pièce(s) n° {{numbers}}',
                    numbers: reference.numbers.join(', ')
                  })}
                </p>
                <p className="mt-1 text-xs italic text-ink-muted">« {reference.excerpt} »</p>
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-aurora hover:underline"
                  onClick={() => scrollToBlock(reference.blockIndex)}
                >
                  {t('compare.scroll_to_block', { defaultValue: 'Voir le passage' })}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
