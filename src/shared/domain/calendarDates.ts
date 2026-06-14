/**
 * Utilitaires de dates natifs (sans librairie) pour les vues calendrier.
 *
 * Convention fuseau : toute journée ISO (YYYY-MM-DD) est ancrée à midi local
 * (`T12:00:00`) pour éviter les décalages de jour autour des changements
 * d'heure — même convention que le reste de l'application.
 */

/** Parse une journée ISO YYYY-MM-DD ancrée à midi local. */
export function parseIsoDay(iso: string): Date {
  return new Date(iso + 'T12:00:00')
}

/** Journée ISO YYYY-MM-DD locale d'une Date (sans passage par UTC). */
export function toIsoDay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Index du jour dans la semaine française : lundi=0 … dimanche=6. */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

/** Lundi (à midi) de la semaine contenant `date`. */
export function startOfWeek(date: Date): Date {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
  base.setDate(base.getDate() - mondayIndex(base))
  return base
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
  next.setDate(next.getDate() + days)
  return next
}

export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7)
}

export function addMonths(date: Date, months: number): Date {
  // Ancré au 1er du mois pour éviter le débordement (31 jan + 1 mois → 3 mars).
  return new Date(date.getFullYear(), date.getMonth() + months, 1, 12)
}

/** Les 7 jours (lun → dim) de la semaine contenant `date`. */
export function weekDays(date: Date): Date[] {
  const monday = startOfWeek(date)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** Les 5 jours ouvrés (lun → ven) de la semaine contenant `date`. */
export function workingWeekDays(date: Date): Date[] {
  return weekDays(date).slice(0, 5)
}

/**
 * Grille mensuelle de 6 semaines (42 jours), commençant le lundi de la
 * semaine du 1er du mois — jours débordants des mois voisins inclus.
 */
export function monthGrid(date: Date): Date[] {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1, 12)
  const gridStart = startOfWeek(firstOfMonth)
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}

/** Numéro de semaine ISO 8601 (lundi premier jour, semaine du 4 janvier = S1). */
export function isoWeekNumber(date: Date): number {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
  d.setDate(d.getDate() - mondayIndex(d) + 3) // jeudi de la semaine courante
  const firstThursday = new Date(d.getFullYear(), 0, 4, 12)
  firstThursday.setDate(firstThursday.getDate() - mondayIndex(firstThursday) + 3)
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000))
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

/** 'HH:MM' → minutes depuis minuit ; null si absent ou malformé. */
export function timeToMinutes(time: string | undefined): number | null {
  if (!time) return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Minutes depuis minuit → 'HH:MM' (clampé sur [0, 23:59]). */
export function minutesToTime(minutes: number): string {
  const clamped = Math.min(Math.max(0, Math.round(minutes)), 23 * 60 + 59)
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** État automatique d'une échéance : à venir (aujourd'hui inclus) ou passée. */
export function computeAutoState(
  isoDate: string,
  referenceDate: Date = new Date()
): 'upcoming' | 'done' {
  const today = new Date(referenceDate)
  today.setHours(0, 0, 0, 0)
  const eventDay = new Date(isoDate + 'T00:00:00')
  return eventDay >= today ? 'upcoming' : 'done'
}

export function formatWeekdayShort(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
  } catch {
    return toIsoDay(date)
  }
}

export function formatMonthYear(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date)
  } catch {
    return toIsoDay(date)
  }
}

export function formatDayMonth(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date)
  } catch {
    return toIsoDay(date)
  }
}
