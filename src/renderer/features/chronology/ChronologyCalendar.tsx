import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  formatWeekdayShort,
  isToday,
  isoWeekNumber,
  minutesToTime,
  monthGrid,
  timeToMinutes,
  toIsoDay,
  weekDays,
  workingWeekDays
} from '@shared/types'

import type { CalendarCreateSlot, CalendarEvent, CalendarViewMode } from './calendarTypes'
import { eventColor } from './eventColor'

const PX_PER_HOUR = 64
const PX_PER_MINUTE = PX_PER_HOUR / 60
/** Hauteur de bloc d'un événement horodaté sans durée. */
const DEFAULT_SLOT_MINUTES = 30
const MIN_EVENT_HEIGHT = 22
/** Chips visibles par case en vue mois avant le repli « +N ». */
const MAX_MONTH_CHIPS = 3
/** Heures « ouvrées » : visibles au montage (scroll calé dessus) et non grisées. */
const VISIBLE_START_HOUR = 7
const VISIBLE_END_HOUR = 20
/** Pas d'accroche des gestes (création, déplacement, redimensionnement). */
const SNAP_MINUTES = 15
/** Durée par défaut d'un événement créé au double-clic. */
const DBLCLICK_DURATION_MINUTES = 60
/** Largeur de la gouttière des heures (3rem). */
const GUTTER_PX = 48

interface ChronologyCalendarProps {
  events: CalendarEvent[]
  viewMode: CalendarViewMode
  referenceDate: Date
  locale: string
  onEventClick: (event: CalendarEvent) => void
  /** Clic sur le « +N » d'une case mois ou le n° de semaine — la surface bascule en vue semaine. */
  onOverflowClick?: (day: Date) => void
  /** Création depuis le calendrier (glissé, double-clic, en-tête, rangée journée, case mois). */
  onCreateSlot?: (slot: CalendarCreateSlot) => void
  /** Déplacement d'un événement éditable (glisser-déposer). */
  onEventMove?: (event: CalendarEvent, next: { date: string; time: string }) => void
  /** Redimensionnement d'un événement éditable (poignée basse). */
  onEventResize?: (event: CalendarEvent, durationMinutes: number) => void
  dayStartHour?: number
  dayEndHour?: number
}

export function ChronologyCalendar({
  events,
  viewMode,
  referenceDate,
  locale,
  onEventClick,
  onOverflowClick,
  onCreateSlot,
  onEventMove,
  onEventResize,
  dayStartHour = 0,
  dayEndHour = 24
}: ChronologyCalendarProps): React.JSX.Element {
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const existing = map.get(event.date)
      if (existing) {
        existing.push(event)
      } else {
        map.set(event.date, [event])
      }
    }
    for (const dayEvents of map.values()) {
      dayEvents.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
    }
    return map
  }, [events])

  if (viewMode === 'month') {
    return (
      <MonthGrid
        eventsByDay={eventsByDay}
        referenceDate={referenceDate}
        locale={locale}
        onEventClick={onEventClick}
        onOverflowClick={onOverflowClick}
        onCreateSlot={onCreateSlot}
      />
    )
  }

  return (
    <TimeGrid
      eventsByDay={eventsByDay}
      days={viewMode === 'week' ? weekDays(referenceDate) : workingWeekDays(referenceDate)}
      locale={locale}
      onEventClick={onEventClick}
      onCreateSlot={onCreateSlot}
      onEventMove={onEventMove}
      onEventResize={onEventResize}
      dayStartHour={dayStartHour}
      dayEndHour={dayEndHour}
    />
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function snapMinutes(minutes: number): number {
  return clamp(Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES, 0, 1440)
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button') !== null
}

/** Atténuation combinée : événement clos et/ou hors du dossier courant. */
function eventOpacityClass(event: CalendarEvent): string {
  if (event.dimmed && event.isClosed) return 'opacity-25 saturate-50'
  if (event.dimmed) return 'opacity-40 saturate-50'
  if (event.isClosed) return 'opacity-50'
  return ''
}

/* ------------------------------------------------------------------ */
/* Vue mois                                                            */
/* ------------------------------------------------------------------ */

interface MonthGridProps {
  eventsByDay: Map<string, CalendarEvent[]>
  referenceDate: Date
  locale: string
  onEventClick: (event: CalendarEvent) => void
  onOverflowClick?: (day: Date) => void
  onCreateSlot?: (slot: CalendarCreateSlot) => void
}

function MonthGrid({
  eventsByDay,
  referenceDate,
  locale,
  onEventClick,
  onOverflowClick,
  onCreateSlot
}: MonthGridProps): React.JSX.Element {
  const { t } = useTranslation()
  const cells = useMemo(() => monthGrid(referenceDate), [referenceDate])
  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, i) => cells.slice(i * 7, i * 7 + 7)),
    [cells]
  )
  const currentMonth = referenceDate.getMonth()

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-white shadow-[0_1px_2px_rgba(15,122,138,0.04)]">
      {/* En-tête des jours, gouttière n° de semaine à gauche. */}
      <div className="grid shrink-0 grid-cols-[2.5rem_repeat(7,1fr)] border-b border-deep-space bg-parchment-bright">
        <div aria-hidden="true" />
        {weeks[0]!.map((day) => (
          <div
            key={day.getDay()}
            className="px-2 py-1.5 text-center text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle"
          >
            {formatWeekdayShort(day, locale)}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-fr overflow-y-auto">
        {weeks.map((week) => (
          <div
            key={toIsoDay(week[0]!)}
            className="grid min-h-24 grid-cols-[2.5rem_repeat(7,1fr)] border-b border-[#f0ede3] last:border-b-0"
          >
            <div className="flex items-start justify-center pt-1.5">
              {onOverflowClick ? (
                <button
                  type="button"
                  onClick={() => onOverflowClick(week[0]!)}
                  title={t('dossiers.calendar_week_open_hint', {
                    defaultValue: 'Afficher cette semaine'
                  })}
                  className="rounded-full bg-parchment px-1.5 py-0.5 text-[10px] tabular-nums text-ink-subtle transition hover:bg-aurora/10 hover:text-aurora"
                >
                  {t('dossiers.calendar_week_number', {
                    n: isoWeekNumber(week[0]!),
                    defaultValue: 'S{{n}}'
                  })}
                </button>
              ) : (
                <span className="rounded-full bg-parchment px-1.5 py-0.5 text-[10px] tabular-nums text-ink-subtle">
                  {t('dossiers.calendar_week_number', {
                    n: isoWeekNumber(week[0]!),
                    defaultValue: 'S{{n}}'
                  })}
                </span>
              )}
            </div>
            {week.map((day) => {
              const iso = toIsoDay(day)
              const dayEvents = eventsByDay.get(iso) ?? []
              const outsideMonth = day.getMonth() !== currentMonth
              const today = isToday(day)
              const overflow = dayEvents.length - MAX_MONTH_CHIPS
              const visibleEvents =
                overflow > 0 ? dayEvents.slice(0, MAX_MONTH_CHIPS - 1) : dayEvents

              return (
                <div
                  key={iso}
                  onDoubleClick={
                    onCreateSlot
                      ? (event) => {
                          if (isInteractiveTarget(event.target)) return
                          onCreateSlot({ date: iso })
                        }
                      : undefined
                  }
                  title={
                    onCreateSlot
                      ? t('dossiers.calendar_create_day_dblclick_hint', {
                          defaultValue: 'Double-clic : créer un événement ce jour'
                        })
                      : undefined
                  }
                  className={`flex min-w-0 flex-col gap-0.5 border-l border-[#f0ede3] px-1 py-1 ${
                    outsideMonth ? 'bg-parchment-bright' : ''
                  } ${today ? 'bg-aurora/5' : ''}`}
                >
                  <span
                    className={`self-end text-xs tabular-nums ${
                      today
                        ? 'flex h-5 w-5 items-center justify-center rounded-full bg-aurora font-medium text-white'
                        : outsideMonth
                          ? 'px-1 text-[#b8b6ac]'
                          : 'px-1 text-ink-muted'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {visibleEvents.map((event) => (
                    <MonthEventChip key={event.id} event={event} onClick={onEventClick} />
                  ))}
                  {overflow > 0 ? (
                    <button
                      type="button"
                      onClick={() => onOverflowClick?.(day)}
                      className="rounded-md px-1.5 py-0.5 text-left text-xs text-aurora transition hover:bg-aurora/10"
                    >
                      {t('dossiers.calendar_more', {
                        count: overflow + 1,
                        defaultValue: '+{{count}}'
                      })}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

interface MonthEventChipProps {
  event: CalendarEvent
  onClick: (event: CalendarEvent) => void
}

function MonthEventChip({ event, onClick }: MonthEventChipProps): React.JSX.Element {
  const color = eventColor(event)
  const title = [event.time, event.label, event.subtitle].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={() => onClick(event)}
      title={title}
      className={`flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-xs transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/40 ${color.chip} ${eventOpacityClass(event)}`}
    >
      {event.time ? <span className="shrink-0 tabular-nums">{event.time}</span> : null}
      <span className={`truncate ${event.isClosed ? 'line-through' : ''}`}>{event.label}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Vue semaine / semaine ouvrée (grille horaire)                       */
/* ------------------------------------------------------------------ */

/** Soleil : marqueur de la rangée « toute la journée ». */
function AllDayIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
    </svg>
  )
}

interface TimeGridProps {
  eventsByDay: Map<string, CalendarEvent[]>
  days: Date[]
  locale: string
  onEventClick: (event: CalendarEvent) => void
  onCreateSlot?: (slot: CalendarCreateSlot) => void
  onEventMove?: (event: CalendarEvent, next: { date: string; time: string }) => void
  onEventResize?: (event: CalendarEvent, durationMinutes: number) => void
  dayStartHour: number
  dayEndHour: number
}

interface PositionedEvent {
  event: CalendarEvent
  top: number
  height: number
  /** Colonne (0-based) et nombre de colonnes du cluster de chevauchement. */
  column: number
  columnCount: number
}

/** Geste en cours sur la grille horaire. */
type TimeGridGesture =
  | { kind: 'create'; dayIndex: number; anchorMin: number; currentMin: number }
  | {
      kind: 'move'
      event: CalendarEvent
      durationMin: number
      grabOffsetMin: number
      dayIndex: number
      startMin: number
      originDayIndex: number
      originStartMin: number
      moved: boolean
    }
  | {
      kind: 'resize'
      event: CalendarEvent
      dayIndex: number
      startMin: number
      endMin: number
      moved: boolean
    }

/**
 * Positionne les événements horodatés d'une journée : assignation gloutonne
 * en colonnes au sein de chaque groupe d'événements qui se chevauchent.
 */
function layoutDayEvents(
  dayEvents: CalendarEvent[],
  dayStartHour: number,
  gridHeight: number
): PositionedEvent[] {
  const timed = dayEvents
    .map((event) => {
      const startMin = timeToMinutes(event.time)
      if (startMin === null) return null
      const endMin = startMin + (event.duration ?? DEFAULT_SLOT_MINUTES)
      return { event, startMin, endMin }
    })
    .filter((item): item is { event: CalendarEvent; startMin: number; endMin: number } =>
      Boolean(item)
    )
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  const positioned: PositionedEvent[] = []
  let clusterStart = 0
  let clusterEnd = -Infinity
  let columnEnds: number[] = []

  const flushCluster = (endIndex: number): void => {
    for (let i = clusterStart; i < endIndex; i++) {
      positioned[i]!.columnCount = columnEnds.length
    }
  }

  timed.forEach((item, index) => {
    if (item.startMin >= clusterEnd) {
      flushCluster(index)
      clusterStart = index
      columnEnds = []
      clusterEnd = -Infinity
    }
    let column = columnEnds.findIndex((end) => end <= item.startMin)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(item.endMin)
    } else {
      columnEnds[column] = item.endMin
    }
    clusterEnd = Math.max(clusterEnd, item.endMin)

    const top = Math.max(0, (item.startMin - dayStartHour * 60) * PX_PER_MINUTE)
    const rawHeight = (item.endMin - item.startMin) * PX_PER_MINUTE
    const height = Math.min(Math.max(MIN_EVENT_HEIGHT, rawHeight), Math.max(0, gridHeight - top))
    positioned.push({ event: item.event, top, height, column, columnCount: 1 })
  })
  flushCluster(timed.length)

  return positioned
}

function TimeGrid({
  eventsByDay,
  days,
  locale,
  onEventClick,
  onCreateSlot,
  onEventMove,
  onEventResize,
  dayStartHour,
  dayEndHour
}: TimeGridProps): React.JSX.Element {
  const { t } = useTranslation()
  const hourCount = dayEndHour - dayStartHour
  const gridHeight = hourCount * PX_PER_HOUR
  const hours = Array.from({ length: hourCount }, (_, i) => dayStartHour + i)
  const gridTemplate = `3rem repeat(${days.length}, minmax(0, 1fr))`

  // Les 24h sont accessibles au défilement ; au montage on cale 7h en haut.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = (VISIBLE_START_HOUR - dayStartHour) * PX_PER_HOUR
    }
  }, [dayStartHour])

  const bodyRef = useRef<HTMLDivElement>(null)
  const [gesture, setGesture] = useState<TimeGridGesture | null>(null)
  // Vrai juste après un déplacement/redimensionnement : avale le clic qui suit
  // pour ne pas ouvrir l'éditeur en relâchant le glissé.
  const suppressClickRef = useRef(false)

  /** Position du pointeur → { jour, minutes brutes depuis minuit }. */
  const pointToSlot = (clientX: number, clientY: number): { dayIndex: number; minutes: number } => {
    const rect = bodyRef.current!.getBoundingClientRect()
    const colWidth = (rect.width - GUTTER_PX) / days.length
    const dayIndex = clamp(
      Math.floor((clientX - rect.left - GUTTER_PX) / colWidth),
      0,
      days.length - 1
    )
    const minutes = (clientY - rect.top) / PX_PER_MINUTE + dayStartHour * 60
    return { dayIndex, minutes }
  }

  // Suivi global du geste : le pointeur peut sortir de la colonne d'origine.
  useEffect(() => {
    if (!gesture) return

    const handleMove = (event: PointerEvent): void => {
      const { dayIndex, minutes } = pointToSlot(event.clientX, event.clientY)
      setGesture((current) => {
        if (!current) return current
        if (current.kind === 'create') {
          return { ...current, currentMin: snapMinutes(minutes) }
        }
        if (current.kind === 'move') {
          const startMin = clamp(
            snapMinutes(minutes - current.grabOffsetMin),
            0,
            1440 - current.durationMin
          )
          const moved =
            current.moved ||
            startMin !== current.originStartMin ||
            dayIndex !== current.originDayIndex
          return { ...current, dayIndex, startMin, moved }
        }
        const endMin = clamp(snapMinutes(minutes), current.startMin + SNAP_MINUTES, 1440)
        return { ...current, endMin, moved: current.moved || endMin !== current.endMin }
      })
    }

    const handleUp = (): void => {
      if (gesture.kind === 'create') {
        const start = Math.min(gesture.anchorMin, gesture.currentMin)
        const extent = Math.abs(gesture.currentMin - gesture.anchorMin)
        if (extent >= SNAP_MINUTES && onCreateSlot) {
          onCreateSlot({
            date: toIsoDay(days[gesture.dayIndex]!),
            time: minutesToTime(start),
            duration: extent
          })
        }
      } else if (gesture.kind === 'move') {
        if (gesture.moved && onEventMove) {
          suppressClickRef.current = true
          setTimeout(() => {
            suppressClickRef.current = false
          }, 0)
          onEventMove(gesture.event, {
            date: toIsoDay(days[gesture.dayIndex]!),
            time: minutesToTime(gesture.startMin)
          })
        }
      } else if (gesture.moved && onEventResize) {
        suppressClickRef.current = true
        setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
        onEventResize(gesture.event, gesture.endMin - gesture.startMin)
      }
      setGesture(null)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesture, days, onCreateSlot, onEventMove, onEventResize])

  const startCreateGesture = (event: React.PointerEvent, dayIndex: number): void => {
    if (!onCreateSlot || event.button !== 0 || isInteractiveTarget(event.target)) return
    const { minutes } = pointToSlot(event.clientX, event.clientY)
    const anchor = snapMinutes(minutes)
    setGesture({ kind: 'create', dayIndex, anchorMin: anchor, currentMin: anchor })
  }

  const handleColumnDoubleClick = (event: React.MouseEvent, dayIndex: number): void => {
    if (!onCreateSlot || isInteractiveTarget(event.target)) return
    const { minutes } = pointToSlot(event.clientX, event.clientY)
    const start = clamp(Math.floor(minutes / 30) * 30, 0, 1440 - DBLCLICK_DURATION_MINUTES)
    onCreateSlot({
      date: toIsoDay(days[dayIndex]!),
      time: minutesToTime(start),
      duration: DBLCLICK_DURATION_MINUTES
    })
  }

  const startMoveGesture = (event: React.PointerEvent, calEvent: CalendarEvent): void => {
    if (!onEventMove || !calEvent.canEdit || event.button !== 0) return
    const startMin = timeToMinutes(calEvent.time)
    if (startMin === null) return
    event.stopPropagation()
    const { dayIndex, minutes } = pointToSlot(event.clientX, event.clientY)
    setGesture({
      kind: 'move',
      event: calEvent,
      durationMin: calEvent.duration ?? DEFAULT_SLOT_MINUTES,
      grabOffsetMin: minutes - startMin,
      dayIndex,
      startMin,
      originDayIndex: dayIndex,
      originStartMin: startMin,
      moved: false
    })
  }

  const startResizeGesture = (event: React.PointerEvent, calEvent: CalendarEvent): void => {
    if (!onEventResize || !calEvent.canEdit || event.button !== 0) return
    const startMin = timeToMinutes(calEvent.time)
    if (startMin === null) return
    event.stopPropagation()
    event.preventDefault()
    const { dayIndex } = pointToSlot(event.clientX, event.clientY)
    setGesture({
      kind: 'resize',
      event: calEvent,
      dayIndex,
      startMin,
      endMin: startMin + (calEvent.duration ?? DEFAULT_SLOT_MINUTES),
      moved: false
    })
  }

  const handleEventClick = (calEvent: CalendarEvent): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    onEventClick(calEvent)
  }

  const allDayByDay = useMemo(
    () => days.map((day) => (eventsByDay.get(toIsoDay(day)) ?? []).filter((event) => !event.time)),
    [days, eventsByDay]
  )

  const positionedByDay = useMemo(
    () =>
      days.map((day) =>
        layoutDayEvents(eventsByDay.get(toIsoDay(day)) ?? [], dayStartHour, gridHeight)
      ),
    [days, eventsByDay, dayStartHour, gridHeight]
  )

  const createDayHint = onCreateSlot
    ? t('dossiers.calendar_create_day_hint', {
        defaultValue: 'Créer un événement ce jour'
      })
    : undefined
  const offHoursTopPx = Math.max(0, (VISIBLE_START_HOUR - dayStartHour) * PX_PER_HOUR)
  const offHoursBottomPx = Math.max(0, (dayEndHour - VISIBLE_END_HOUR) * PX_PER_HOUR)
  const gestureCursor =
    gesture?.kind === 'move'
      ? 'cursor-grabbing'
      : gesture?.kind === 'resize'
        ? 'cursor-ns-resize'
        : gesture?.kind === 'create'
          ? 'cursor-crosshair'
          : ''

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-white shadow-[0_1px_2px_rgba(15,122,138,0.04)]">
      {/* En-tête des jours. */}
      <div
        className="grid shrink-0 overflow-y-auto border-b border-deep-space bg-parchment-bright"
        style={{ gridTemplateColumns: gridTemplate, scrollbarGutter: 'stable' }}
      >
        <div className="flex items-end justify-center pb-1">
          <span className="rounded-full bg-parchment px-1.5 py-0.5 text-[10px] tabular-nums text-ink-subtle">
            {t('dossiers.calendar_week_number', {
              n: isoWeekNumber(days[0]!),
              defaultValue: 'S{{n}}'
            })}
          </span>
        </div>
        {days.map((day) => {
          const today = isToday(day)
          const weekend = day.getDay() === 0 || day.getDay() === 6
          return (
            <div
              key={toIsoDay(day)}
              onClick={onCreateSlot ? () => onCreateSlot({ date: toIsoDay(day) }) : undefined}
              title={createDayHint}
              className={`flex flex-col items-center gap-0.5 border-l border-[#f0ede3] px-2 py-1.5 ${
                weekend ? 'bg-parchment' : ''
              } ${onCreateSlot ? 'cursor-pointer transition-colors hover:bg-aurora/5' : ''}`}
            >
              <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
                {formatWeekdayShort(day, locale)}
              </span>
              <span
                className={`text-sm tabular-nums ${
                  today
                    ? 'flex h-6 w-6 items-center justify-center rounded-full bg-aurora font-medium text-white'
                    : 'text-ink'
                }`}
              >
                {day.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      {/* Rangée « toute la journée » — toujours visible, hors défilement. */}
      <div
        className="grid shrink-0 overflow-y-auto border-b border-deep-space"
        style={{ gridTemplateColumns: gridTemplate, scrollbarGutter: 'stable' }}
      >
        <div
          className="flex items-center justify-end pr-1.5 text-ink-subtle"
          title={t('dossiers.calendar_all_day', { defaultValue: 'Toute la journée' })}
          aria-label={t('dossiers.calendar_all_day', { defaultValue: 'Toute la journée' })}
        >
          <AllDayIcon />
        </div>
        {days.map((day, dayIndex) => (
          <div
            key={toIsoDay(day)}
            onClick={
              onCreateSlot
                ? (event) => {
                    if (isInteractiveTarget(event.target)) return
                    onCreateSlot({ date: toIsoDay(day) })
                  }
                : undefined
            }
            title={createDayHint}
            className={`flex min-h-7 min-w-0 flex-col gap-0.5 border-l border-[#f0ede3] px-1 py-1 ${
              onCreateSlot ? 'cursor-pointer transition-colors hover:bg-aurora/5' : ''
            }`}
          >
            {allDayByDay[dayIndex]!.map((event) => (
              <MonthEventChip key={event.id} event={event} onClick={handleEventClick} />
            ))}
          </div>
        ))}
      </div>

      {/* Corps horaire scrollable. */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ scrollbarGutter: 'stable' }}
      >
        <div
          ref={bodyRef}
          className={`relative grid select-none ${gestureCursor}`}
          style={{ gridTemplateColumns: gridTemplate, height: gridHeight }}
        >
          {/* Gouttière des heures. */}
          <div className="relative">
            {hours.map((hour) => (
              <span
                key={hour}
                className={`absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums ${
                  hour < VISIBLE_START_HOUR || hour >= VISIBLE_END_HOUR
                    ? 'text-[#b8b6ac]'
                    : 'text-ink-subtle'
                }`}
                style={{ top: Math.max(8, (hour - dayStartHour) * PX_PER_HOUR) }}
              >
                {`${String(hour).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const today = isToday(day)
            const weekend = day.getDay() === 0 || day.getDay() === 6
            return (
              <div
                key={toIsoDay(day)}
                onPointerDown={(event) => startCreateGesture(event, dayIndex)}
                onDoubleClick={(event) => handleColumnDoubleClick(event, dayIndex)}
                className={`relative border-l border-[#f0ede3] ${
                  weekend ? 'bg-parchment-bright' : ''
                } ${today ? 'bg-aurora/5' : ''}`}
                style={{ touchAction: 'none' }}
              >
                {/* Heures hors plage ouvrée légèrement grisées. */}
                {offHoursTopPx > 0 ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 bg-deep-space/45"
                    style={{ height: offHoursTopPx }}
                  />
                ) : null}
                {offHoursBottomPx > 0 ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 bg-deep-space/45"
                    style={{ height: offHoursBottomPx }}
                  />
                ) : null}
                {hours.slice(1).map((hour) => (
                  <div
                    key={hour}
                    aria-hidden="true"
                    className="absolute inset-x-0 border-t border-[#f0ede3]"
                    style={{ top: (hour - dayStartHour) * PX_PER_HOUR }}
                  />
                ))}
                {positionedByDay[dayIndex]!.map((item) => (
                  <TimedEventBlock
                    key={item.event.id}
                    item={item}
                    dimmed={
                      (gesture?.kind === 'move' || gesture?.kind === 'resize') &&
                      gesture.event.id === item.event.id
                    }
                    onClick={handleEventClick}
                    onMoveStart={startMoveGesture}
                    onResizeStart={startResizeGesture}
                  />
                ))}
                <GestureOverlay gesture={gesture} dayIndex={dayIndex} dayStartHour={dayStartHour} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface GestureOverlayProps {
  gesture: TimeGridGesture | null
  dayIndex: number
  dayStartHour: number
}

/** Aperçu visuel du geste en cours (sélection, fantôme de déplacement, redimensionnement). */
function GestureOverlay({
  gesture,
  dayIndex,
  dayStartHour
}: GestureOverlayProps): React.JSX.Element | null {
  if (!gesture || gesture.dayIndex !== dayIndex) return null

  let startMin: number
  let endMin: number
  let label: string
  if (gesture.kind === 'create') {
    startMin = Math.min(gesture.anchorMin, gesture.currentMin)
    endMin = Math.max(gesture.anchorMin, gesture.currentMin)
    if (endMin - startMin < SNAP_MINUTES) return null
    label = `${minutesToTime(startMin)} – ${minutesToTime(endMin)}`
  } else if (gesture.kind === 'move') {
    if (!gesture.moved) return null
    startMin = gesture.startMin
    endMin = gesture.startMin + gesture.durationMin
    label = `${minutesToTime(startMin)} · ${gesture.event.label}`
  } else {
    if (!gesture.moved) return null
    startMin = gesture.startMin
    endMin = gesture.endMin
    label = `${minutesToTime(startMin)} – ${minutesToTime(endMin)}`
  }

  const top = (startMin - dayStartHour * 60) * PX_PER_MINUTE
  const height = Math.max(8, (endMin - startMin) * PX_PER_MINUTE)
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded-md border-2 border-aurora/60 bg-aurora/15 px-1.5 py-0.5"
      style={{ top, height }}
    >
      <span className="block truncate text-xs font-medium tabular-nums text-aurora">{label}</span>
    </div>
  )
}

interface TimedEventBlockProps {
  item: PositionedEvent
  dimmed?: boolean
  onClick: (event: CalendarEvent) => void
  onMoveStart: (pointerEvent: React.PointerEvent, event: CalendarEvent) => void
  onResizeStart: (pointerEvent: React.PointerEvent, event: CalendarEvent) => void
}

function TimedEventBlock({
  item,
  dimmed,
  onClick,
  onMoveStart,
  onResizeStart
}: TimedEventBlockProps): React.JSX.Element {
  const { event, top, height, column, columnCount } = item
  const color = eventColor(event)
  const width = 100 / columnCount
  const title = [event.time, event.label, event.subtitle].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={() => onClick(event)}
      onPointerDown={(pointerEvent) => onMoveStart(pointerEvent, event)}
      title={title}
      className={`absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-xs transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/40 ${color.chip} ${
        dimmed ? 'opacity-30' : eventOpacityClass(event)
      } ${event.canEdit ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{
        top,
        height,
        left: `calc(${column * width}% + 2px)`,
        width: `calc(${width}% - 4px)`
      }}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${color.bar}`} />
      <span className="block truncate pl-1">
        {event.time ? <span className="tabular-nums">{event.time}</span> : null}
        {event.time ? ' ' : ''}
        <span className={`font-medium ${event.isClosed ? 'line-through' : ''}`}>{event.label}</span>
      </span>
      {event.subtitle && height >= 38 ? (
        <span className="block truncate pl-1 text-[10px] opacity-75">{event.subtitle}</span>
      ) : null}
      {event.canEdit ? (
        <span
          aria-hidden="true"
          onPointerDown={(pointerEvent) => onResizeStart(pointerEvent, event)}
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
        />
      ) : null}
    </button>
  )
}
