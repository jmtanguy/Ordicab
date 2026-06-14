import { useTranslation } from 'react-i18next'

import type { DiffBlock, DiffSegment } from '@shared/types'

import { blockElementId } from './diffNavigation'

const SEGMENT_STYLES: Record<DiffSegment['kind'], string> = {
  same: '',
  added: 'rounded-sm bg-emerald-100 text-emerald-900',
  removed: 'rounded-sm bg-red-100 text-red-800 line-through'
}

const BLOCK_STYLES: Record<DiffBlock['type'], string> = {
  unchanged: 'text-ink-muted',
  added: 'border-l-2 border-emerald-400 bg-emerald-50/60 pl-3 text-ink',
  removed: 'border-l-2 border-red-300 bg-red-50/60 pl-3 text-ink',
  modified: 'border-l-2 border-amber-300 bg-amber-50/40 pl-3 text-ink'
}

export function DiffView({ blocks }: { blocks: DiffBlock[] }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.type === 'unchanged' && block.collapsedCount !== undefined) {
          return (
            <p
              key={index}
              id={blockElementId(index)}
              className="py-1 text-center text-xs text-ink-subtle"
            >
              {t('compare.collapsed_paragraphs', {
                defaultValue: '… {{count}} paragraphes inchangés …',
                count: block.collapsedCount
              })}
            </p>
          )
        }
        return (
          <p
            key={index}
            id={blockElementId(index)}
            className={`whitespace-pre-wrap py-0.5 text-sm leading-relaxed ${BLOCK_STYLES[block.type]}`}
          >
            {block.segments.map((segment, segmentIndex) => (
              <span key={segmentIndex} className={SEGMENT_STYLES[segment.kind]}>
                {segment.text}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
