import type { KeyDateTag } from '@shared/types'
import { computeAutoState } from '@shared/types'

import type { CalendarEvent } from './calendarTypes'

export interface EventColor {
  /** Barre latérale pleine (blocs horaires). */
  bar: string
  /** Chip pastel bordé (vue mois, rangée toute-la-journée). */
  chip: string
}

/** Couleurs alignées sur TAG_STYLES des listes existantes. */
const TAG_COLOR: Record<KeyDateTag, EventColor> = {
  cancelled: { bar: 'bg-red-500', chip: 'bg-red-50 text-red-700 border-red-200' },
  postponed: { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  urgent: { bar: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 border-orange-200' },
  imperative: { bar: 'bg-rose-500', chip: 'bg-rose-100 text-rose-800 border-rose-300' },
  important: { bar: 'bg-yellow-500', chip: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  to_confirm: { bar: 'bg-slate-400', chip: 'bg-slate-50 text-slate-700 border-slate-200' },
  confidential: { bar: 'bg-purple-500', chip: 'bg-purple-50 text-purple-700 border-purple-200' },
  to_do: { bar: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-200' }
}

/** Le tag le plus « alarmant » détermine la couleur quand il y en a plusieurs. */
const TAG_PRIORITY: KeyDateTag[] = [
  'cancelled',
  'postponed',
  'urgent',
  'imperative',
  'important',
  'to_confirm',
  'confidential',
  'to_do'
]

const UPCOMING_COLOR: EventColor = {
  bar: 'bg-aurora',
  chip: 'bg-aurora/10 text-aurora border-aurora/20'
}

const DONE_COLOR: EventColor = {
  bar: 'bg-slate-400',
  chip: 'bg-slate-100 text-slate-600 border-slate-200'
}

export function eventColor(event: CalendarEvent): EventColor {
  const tags = event.tags ?? []
  const winner = TAG_PRIORITY.find((tag) => tags.includes(tag))
  if (winner) return TAG_COLOR[winner]
  return computeAutoState(event.date) === 'upcoming' ? UPCOMING_COLOR : DONE_COLOR
}
