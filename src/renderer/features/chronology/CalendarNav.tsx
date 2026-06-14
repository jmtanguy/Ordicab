import { useTranslation } from 'react-i18next'

import {
  addMonths,
  addWeeks,
  formatDayMonth,
  formatMonthYear,
  isoWeekNumber,
  startOfWeek,
  addDays
} from '@shared/types'

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  IconButton,
  SegmentedControl
} from '../dossiers/sectionLayout'
import type { CalendarViewMode } from './calendarTypes'

interface CalendarNavProps {
  viewMode: CalendarViewMode
  referenceDate: Date
  locale: string
  onChangeViewMode: (mode: CalendarViewMode) => void
  onChangeReferenceDate: (date: Date) => void
}

export function CalendarNav({
  viewMode,
  referenceDate,
  locale,
  onChangeViewMode,
  onChangeReferenceDate
}: CalendarNavProps): React.JSX.Element {
  const { t } = useTranslation()

  const step = (direction: 1 | -1): void => {
    onChangeReferenceDate(
      viewMode === 'month'
        ? addMonths(referenceDate, direction)
        : addWeeks(referenceDate, direction)
    )
  }

  let label: string
  if (viewMode === 'month') {
    label = formatMonthYear(referenceDate, locale)
  } else {
    const weekStart = startOfWeek(referenceDate)
    const weekEnd = addDays(weekStart, viewMode === 'working-week' ? 4 : 6)
    label = `${t('dossiers.calendar_week_number', {
      n: isoWeekNumber(referenceDate),
      defaultValue: 'S{{n}}'
    })} · ${formatDayMonth(weekStart, locale)} – ${formatDayMonth(weekEnd, locale)}`
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <IconButton
          label={t('dossiers.calendar_prev', { defaultValue: 'Précédent' })}
          alwaysVisible
          onClick={() => step(-1)}
        >
          <ChevronLeftIcon />
        </IconButton>
        <button
          type="button"
          onClick={() => onChangeReferenceDate(new Date())}
          className="rounded-full border border-hairline bg-white px-3 py-1 text-xs text-ink-muted transition hover:border-aurora/40 hover:text-aurora focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/40"
        >
          {t('dossiers.calendar_today', { defaultValue: "Aujourd'hui" })}
        </button>
        <IconButton
          label={t('dossiers.calendar_next', { defaultValue: 'Suivant' })}
          alwaysVisible
          onClick={() => step(1)}
        >
          <ChevronRightIcon />
        </IconButton>
      </div>
      <span className="text-sm font-medium capitalize text-ink">{label}</span>
      <div className="ml-auto">
        <SegmentedControl<CalendarViewMode>
          value={viewMode}
          onChange={onChangeViewMode}
          ariaLabel={t('dossiers.calendar_mode_label', { defaultValue: "Granularité d'affichage" })}
          options={[
            {
              value: 'working-week',
              label: t('dossiers.calendar_mode_working_week', { defaultValue: 'Semaine ouvrée' })
            },
            { value: 'week', label: t('dossiers.calendar_mode_week', { defaultValue: 'Semaine' }) },
            { value: 'month', label: t('dossiers.calendar_mode_month', { defaultValue: 'Mois' }) }
          ]}
        />
      </div>
    </div>
  )
}
