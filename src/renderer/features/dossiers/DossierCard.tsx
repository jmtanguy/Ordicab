import { useTranslation } from 'react-i18next'

import type { DossierStatus, DossierSummary } from '@shared/types'

import { Card } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'

const statusClasses: Record<DossierStatus, string> = {
  active: 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100',
  pending: 'border-amber-300/40 bg-amber-300/15 text-amber-100',
  completed: 'border-sky-300/40 bg-sky-300/15 text-sky-100',
  archived: 'border-slate-400/40 bg-slate-400/15 text-slate-100'
}

interface DossierCardProps {
  dossier: DossierSummary
  isActive: boolean
  onOpenDetail: (id: string) => void
}

function formatIsoDateForDisplay(isoDate: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      new Date(isoDate + 'T12:00:00')
    )
  } catch {
    return isoDate
  }
}

export function DossierCard({
  dossier,
  isActive,
  onOpenDetail
}: DossierCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'fr'

  const statusLabelMap: Record<DossierStatus, string> = {
    active: t('dossiers.status_active'),
    pending: t('dossiers.status_pending'),
    completed: t('dossiers.status_completed'),
    archived: t('dossiers.status_archived')
  }

  return (
    <Card
      className={cn(
        'flex cursor-pointer flex-col gap-3 transition-colors hover:border-white/20',
        isActive
          ? 'border-aurora/45 bg-[rgba(13,28,48,0.82)] shadow-[0_24px_64px_rgba(34,211,238,0.12)]'
          : ''
      )}
      onClick={() => onOpenDetail(dossier.id)}
    >
      <div className="space-y-1.5">
        <h3 className="truncate text-xl font-semibold text-slate-50" title={dossier.name}>
          {dossier.name}
        </h3>
        <span
          className={cn(
            'inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]',
            statusClasses[dossier.status]
          )}
        >
          {statusLabelMap[dossier.status]}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">{t('dossiers.card_type_label')}</span>
          <span
            className={cn('font-medium', dossier.type.trim() ? 'text-slate-200' : 'text-slate-500')}
          >
            {dossier.type.trim() || '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">{t('dossiers.card_next_date_label')}</span>
          <span
            className={cn(
              'font-medium',
              dossier.nextUpcomingKeyDate ? 'text-slate-200' : 'text-slate-500'
            )}
          >
            {dossier.nextUpcomingKeyDate ? (
              <>
                {formatIsoDateForDisplay(dossier.nextUpcomingKeyDate, locale)}
                {dossier.nextUpcomingKeyDateLabel ? (
                  <span className="ml-1.5 text-xs font-normal text-slate-400">
                    {dossier.nextUpcomingKeyDateLabel}
                  </span>
                ) : null}
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
      </div>
    </Card>
  )
}
