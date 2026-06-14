/**
 * Calcul des délais de procédure français (CPC, art. 640 à 642).
 *
 * - art. 640 : le délai court à compter de l'acte qui le fait courir ;
 * - art. 641 al. 1 : délai en jours — le jour de l'acte ne compte pas
 *   (dies a quo exclu), le délai expire le dernier jour à 24 h ;
 * - art. 641 al. 2 : délai en mois — expiration le jour du dernier mois
 *   portant le même quantième que le jour de l'acte ; à défaut de quantième
 *   identique, le dernier jour du mois ;
 * - art. 642 : délai expirant un samedi, dimanche, jour férié ou chômé —
 *   prorogation jusqu'au premier jour ouvrable suivant.
 *
 * Convention fuseau : mêmes journées ISO ancrées à midi local que
 * `calendarDates.ts`.
 */

import { addDays, parseIsoDay, toIsoDay } from './calendarDates'

export interface DeadlineDuration {
  months?: number
  days?: number
}

export interface DeadlineRule {
  id: string
  labelFr: string
  duration: DeadlineDuration
  /** Fondement textuel (ex. 'art. 538 CPC') ou 'usage' pour un délai d'usage. */
  basis: string
}

/**
 * Catalogue des délais usuels — extensible : ajouter une entrée suffit, le
 * sélecteur de l'interface et le calcul s'appuient uniquement sur ce tableau.
 */
export const DEADLINE_RULES = [
  {
    id: 'appel',
    labelFr: "Appel d'un jugement contradictoire",
    duration: { months: 1 },
    basis: 'art. 538 CPC'
  },
  {
    id: 'appel-opposition-defaut',
    labelFr: 'Appel ou opposition (jugement rendu par défaut)',
    duration: { months: 1 },
    basis: 'art. 538 et 571 CPC'
  },
  {
    id: 'pourvoi-cassation',
    labelFr: 'Pourvoi en cassation',
    duration: { months: 2 },
    basis: 'art. 612 CPC'
  },
  {
    id: 'conclusions-appelant',
    labelFr: "Conclusions de l'appelant",
    duration: { months: 3 },
    basis: 'art. 908 CPC'
  },
  {
    id: 'conclusions-intime',
    labelFr: "Conclusions de l'intimé",
    duration: { months: 3 },
    basis: 'art. 909 CPC'
  },
  {
    id: 'signification-jugement',
    labelFr: 'Signification du jugement (caducité)',
    duration: { months: 6 },
    basis: 'art. 478 CPC'
  },
  {
    id: 'appel-prudhommes',
    labelFr: "Appel d'un jugement de conseil de prud'hommes",
    duration: { months: 1 },
    basis: 'art. R. 1461-1 C. trav.'
  },
  {
    id: 'appel-ordonnance-refere',
    labelFr: "Appel d'une ordonnance de référé",
    duration: { days: 15 },
    basis: 'art. 490 CPC'
  },
  {
    id: 'recours-contentieux-administratif',
    labelFr: 'Recours contentieux administratif',
    duration: { months: 2 },
    basis: 'art. R. 421-1 CJA'
  },
  {
    id: 'mise-en-demeure-8j',
    labelFr: 'Réponse à mise en demeure (8 jours)',
    duration: { days: 8 },
    basis: 'usage'
  },
  {
    id: 'mise-en-demeure-15j',
    labelFr: 'Réponse à mise en demeure (15 jours)',
    duration: { days: 15 },
    basis: 'usage'
  }
] as const satisfies readonly DeadlineRule[]

export type DeadlineRuleId = (typeof DEADLINE_RULES)[number]['id']

export function findDeadlineRule(id: string): DeadlineRule | undefined {
  return DEADLINE_RULES.find((rule) => rule.id === id)
}

/**
 * Dimanche de Pâques (calendrier grégorien) — algorithme de Gauss
 * dans la formulation anonyme reprise par Meeus.
 */
export function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day, 12)
}

/** Jours fériés légaux français (métropole) d'une année, en ISO YYYY-MM-DD. */
export function frenchLegalHolidays(year: number): string[] {
  const easter = easterSunday(year)
  const fixed: Array<[month: number, day: number]> = [
    [1, 1], // Jour de l'an
    [5, 1], // Fête du Travail
    [5, 8], // Victoire 1945
    [7, 14], // Fête nationale
    [8, 15], // Assomption
    [11, 1], // Toussaint
    [11, 11], // Armistice 1918
    [12, 25] // Noël
  ]
  return [
    ...fixed.map(([month, day]) => toIsoDay(new Date(year, month - 1, day, 12))),
    toIsoDay(addDays(easter, 1)), // Lundi de Pâques
    toIsoDay(addDays(easter, 39)), // Ascension
    toIsoDay(addDays(easter, 50)) // Lundi de Pentecôte
  ]
}

export function isFrenchLegalHoliday(date: Date): boolean {
  return frenchLegalHolidays(date.getFullYear()).includes(toIsoDay(date))
}

export type DeadlineAdjustmentReason = 'weekend' | 'holiday'

export interface DeadlineComputation {
  dateIso: string
  adjusted: boolean
  adjustedReason?: DeadlineAdjustmentReason
}

/**
 * Mois ajoutés selon la règle du quantième (art. 641 al. 2) : même quantième
 * dans le mois cible, à défaut le dernier jour du mois (31 jan + 1 mois →
 * 28/29 fév) — contrairement à `calendarDates.addMonths`, ancré au 1er.
 */
function addMonthsQuantieme(date: Date, months: number): Date {
  const targetMonth = date.getMonth() + months
  const lastDayOfTarget = new Date(date.getFullYear(), targetMonth + 1, 0, 12).getDate()
  return new Date(date.getFullYear(), targetMonth, Math.min(date.getDate(), lastDayOfTarget), 12)
}

/**
 * Date d'expiration d'un délai courant à compter de `baseDateIso` (jour de
 * l'acte, exclu du décompte), prorogée au premier jour ouvrable si elle tombe
 * un samedi, dimanche ou jour férié (art. 642). `adjustedReason` reflète la
 * nature du jour d'échéance initial (férié prioritaire sur week-end).
 */
export function computeDeadline(rule: DeadlineRule, baseDateIso: string): DeadlineComputation {
  const base = parseIsoDay(baseDateIso)
  const { months = 0, days = 0 } = rule.duration
  let deadline = months > 0 ? addMonthsQuantieme(base, months) : base
  if (days > 0) {
    deadline = addDays(deadline, days)
  }

  let adjustedReason: DeadlineAdjustmentReason | undefined
  while (isFrenchLegalHoliday(deadline) || deadline.getDay() === 0 || deadline.getDay() === 6) {
    adjustedReason ??= isFrenchLegalHoliday(deadline) ? 'holiday' : 'weekend'
    deadline = addDays(deadline, 1)
  }

  return {
    dateIso: toIsoDay(deadline),
    adjusted: adjustedReason !== undefined,
    adjustedReason
  }
}
