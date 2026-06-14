import { describe, expect, it } from 'vitest'

import {
  addDays,
  addMonths,
  addWeeks,
  computeAutoState,
  isSameDay,
  isToday,
  isoWeekNumber,
  minutesToTime,
  mondayIndex,
  monthGrid,
  parseIsoDay,
  startOfWeek,
  timeToMinutes,
  toIsoDay,
  weekDays,
  workingWeekDays
} from '../calendarDates'

describe('parseIsoDay / toIsoDay', () => {
  it('aller-retour stable sur une journée ISO', () => {
    expect(toIsoDay(parseIsoDay('2026-06-10'))).toBe('2026-06-10')
    expect(toIsoDay(parseIsoDay('2026-01-01'))).toBe('2026-01-01')
    expect(toIsoDay(parseIsoDay('2026-12-31'))).toBe('2026-12-31')
  })
})

describe('mondayIndex / startOfWeek', () => {
  it('lundi=0, dimanche=6', () => {
    expect(mondayIndex(parseIsoDay('2026-06-08'))).toBe(0) // lundi
    expect(mondayIndex(parseIsoDay('2026-06-10'))).toBe(2) // mercredi
    expect(mondayIndex(parseIsoDay('2026-06-14'))).toBe(6) // dimanche
  })

  it('un dimanche remonte au lundi précédent, un lundi reste lui-même', () => {
    expect(toIsoDay(startOfWeek(parseIsoDay('2026-06-14')))).toBe('2026-06-08')
    expect(toIsoDay(startOfWeek(parseIsoDay('2026-06-08')))).toBe('2026-06-08')
  })
})

describe('weekDays / workingWeekDays', () => {
  it('7 jours ordonnés lundi → dimanche', () => {
    const days = weekDays(parseIsoDay('2026-06-10')).map(toIsoDay)
    expect(days).toEqual([
      '2026-06-08',
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14'
    ])
  })

  it('5 jours ouvrés lundi → vendredi', () => {
    const days = workingWeekDays(parseIsoDay('2026-06-10')).map(toIsoDay)
    expect(days).toEqual(['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'])
  })
})

describe('monthGrid', () => {
  it('toujours 42 cases et la première est un lundi', () => {
    const grid = monthGrid(parseIsoDay('2026-06-10'))
    expect(grid).toHaveLength(42)
    expect(grid.map(mondayIndex)[0]).toBe(0)
    expect(grid.map(toIsoDay)[0]).toBe('2026-06-01') // juin 2026 commence un lundi
  })

  it('mois commençant un dimanche : 6 jours du mois précédent en tête', () => {
    // Février 2026 commence un dimanche.
    const grid = monthGrid(parseIsoDay('2026-02-15')).map(toIsoDay)
    expect(grid).toHaveLength(42)
    expect(grid[0]).toBe('2026-01-26')
    expect(grid[6]).toBe('2026-02-01')
  })

  it('contient tous les jours du mois cible', () => {
    const grid = monthGrid(parseIsoDay('2026-02-15')).map(toIsoDay)
    for (let day = 1; day <= 28; day++) {
      expect(grid).toContain(`2026-02-${String(day).padStart(2, '0')}`)
    }
  })
})

describe('isoWeekNumber', () => {
  it('valeurs connues', () => {
    expect(isoWeekNumber(parseIsoDay('2026-06-10'))).toBe(24)
    expect(isoWeekNumber(parseIsoDay('2026-01-01'))).toBe(1)
  })

  it('frontières d’année', () => {
    // Le 29 déc 2025 (lundi) appartient à la S1 de 2026.
    expect(isoWeekNumber(parseIsoDay('2025-12-29'))).toBe(1)
    expect(isoWeekNumber(parseIsoDay('2026-12-31'))).toBe(53)
    expect(isoWeekNumber(parseIsoDay('2027-01-01'))).toBe(53)
    expect(isoWeekNumber(parseIsoDay('2027-01-04'))).toBe(1)
  })

  it('année à 53 semaines (2026)', () => {
    expect(isoWeekNumber(parseIsoDay('2026-12-28'))).toBe(53)
  })
})

describe('addDays / addWeeks / addMonths', () => {
  it('addDays franchit les mois', () => {
    expect(toIsoDay(addDays(parseIsoDay('2026-01-31'), 1))).toBe('2026-02-01')
    expect(toIsoDay(addDays(parseIsoDay('2026-03-01'), -1))).toBe('2026-02-28')
  })

  it('addWeeks décale de 7 jours', () => {
    expect(toIsoDay(addWeeks(parseIsoDay('2026-06-10'), 1))).toBe('2026-06-17')
    expect(toIsoDay(addWeeks(parseIsoDay('2026-06-10'), -2))).toBe('2026-05-27')
  })

  it('addMonths ancre au 1er du mois (pas de débordement du 31)', () => {
    expect(toIsoDay(addMonths(parseIsoDay('2026-01-31'), 1))).toBe('2026-02-01')
    expect(toIsoDay(addMonths(parseIsoDay('2026-06-10'), -1))).toBe('2026-05-01')
    expect(toIsoDay(addMonths(parseIsoDay('2026-12-15'), 1))).toBe('2027-01-01')
  })
})

describe('isSameDay / isToday', () => {
  it('compare les composantes locales', () => {
    expect(isSameDay(parseIsoDay('2026-06-10'), new Date(2026, 5, 10, 23, 59))).toBe(true)
    expect(isSameDay(parseIsoDay('2026-06-10'), parseIsoDay('2026-06-11'))).toBe(false)
  })

  it('isToday reconnaît la date du jour', () => {
    expect(isToday(new Date())).toBe(true)
    expect(isToday(addDays(new Date(), 1))).toBe(false)
  })
})

describe('timeToMinutes', () => {
  it('convertit HH:MM en minutes', () => {
    expect(timeToMinutes('07:30')).toBe(450)
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('23:59')).toBe(1439)
    expect(timeToMinutes('9:15')).toBe(555)
  })

  it('null si absent ou malformé', () => {
    expect(timeToMinutes(undefined)).toBeNull()
    expect(timeToMinutes('')).toBeNull()
    expect(timeToMinutes('25:00')).toBeNull()
    expect(timeToMinutes('12:75')).toBeNull()
    expect(timeToMinutes('abc')).toBeNull()
  })
})

describe('minutesToTime', () => {
  it('formate les minutes en HH:MM', () => {
    expect(minutesToTime(450)).toBe('07:30')
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(1439)).toBe('23:59')
  })

  it('clampe les valeurs hors plage', () => {
    expect(minutesToTime(-30)).toBe('00:00')
    expect(minutesToTime(1500)).toBe('23:59')
  })
})

describe('computeAutoState', () => {
  it('aujourd’hui et demain sont à venir, hier est passé', () => {
    expect(computeAutoState(toIsoDay(new Date()))).toBe('upcoming')
    expect(computeAutoState(toIsoDay(addDays(new Date(), 1)))).toBe('upcoming')
    expect(computeAutoState(toIsoDay(addDays(new Date(), -1)))).toBe('done')
  })
})
