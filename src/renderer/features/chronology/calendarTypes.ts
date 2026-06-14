import type { KeyDateTag } from '@shared/types'

export type CalendarViewMode = 'month' | 'week' | 'working-week'
export type SurfaceView = 'list' | 'calendar'

export const CALENDAR_VIEW_MODES: CalendarViewMode[] = ['working-week', 'week', 'month']
export const SURFACE_VIEWS: SurfaceView[] = ['list', 'calendar']

/** Événement normalisé, indépendant de la source (ChronologyEntry ou KeyDate). */
export interface CalendarEvent {
  /** Clé React stable (ex. `${dossierId}-${keyDate.id}` côté accueil). */
  id: string
  /** Journée ISO YYYY-MM-DD. */
  date: string
  /** Heure HH:MM — absent : rangée « toute la journée ». */
  time?: string
  /** Durée en minutes. */
  duration?: number
  label: string
  tags?: KeyDateTag[]
  isClosed?: boolean
  /** Nom du dossier côté accueil ; absent en section dossier. */
  subtitle?: string
  /** Autorise les gestes déplacer/redimensionner sur cet événement. */
  canEdit?: boolean
  /** Atténué : événement hors du dossier courant (contexte dossier). */
  dimmed?: boolean
  /** Donnée source restituée telle quelle à `onEventClick`. */
  payload: unknown
}

/** Créneau pré-rempli lors d'une création depuis le calendrier. */
export interface CalendarCreateSlot {
  date: string
  /** Absent pour une création « journée » (en-tête, rangée toute-la-journée, vue mois). */
  time?: string
  duration?: number
}
