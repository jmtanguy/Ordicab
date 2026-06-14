import { describe, expect, it } from 'vitest'

import { parseIsoDay, toIsoDay } from '../calendarDates'
import {
  DEADLINE_RULES,
  computeDeadline,
  easterSunday,
  findDeadlineRule,
  frenchLegalHolidays,
  isFrenchLegalHoliday,
  type DeadlineRule
} from '../proceduralDeadlines'

function rule(id: string): DeadlineRule {
  const found = findDeadlineRule(id)
  if (!found) throw new Error(`règle inconnue : ${id}`)
  return found
}

describe('easterSunday', () => {
  it('calcule le dimanche de Pâques pour plusieurs années', () => {
    expect(toIsoDay(easterSunday(2000))).toBe('2000-04-23')
    expect(toIsoDay(easterSunday(2024))).toBe('2024-03-31')
    expect(toIsoDay(easterSunday(2025))).toBe('2025-04-20')
    expect(toIsoDay(easterSunday(2026))).toBe('2026-04-05')
    expect(toIsoDay(easterSunday(2027))).toBe('2027-03-28')
  })

  it('gère les extrêmes du cycle pascal', () => {
    expect(toIsoDay(easterSunday(2038))).toBe('2038-04-25') // Pâques le plus tardif
    expect(toIsoDay(easterSunday(2285))).toBe('2285-03-22') // Pâques le plus précoce
  })
})

describe('frenchLegalHolidays', () => {
  it('liste les 11 jours fériés légaux de 2026', () => {
    expect([...frenchLegalHolidays(2026)].sort()).toEqual([
      '2026-01-01',
      '2026-04-06', // lundi de Pâques
      '2026-05-01',
      '2026-05-08',
      '2026-05-14', // Ascension (Pâques + 39)
      '2026-05-25', // lundi de Pentecôte (Pâques + 50)
      '2026-07-14',
      '2026-08-15',
      '2026-11-01',
      '2026-11-11',
      '2026-12-25'
    ])
  })

  it('isFrenchLegalHoliday distingue fériés et jours ordinaires', () => {
    expect(isFrenchLegalHoliday(parseIsoDay('2026-07-14'))).toBe(true)
    expect(isFrenchLegalHoliday(parseIsoDay('2026-07-15'))).toBe(false)
  })
})

describe('catalogue DEADLINE_RULES', () => {
  it('a des identifiants uniques et des durées définies', () => {
    const ids = DEADLINE_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of DEADLINE_RULES as readonly DeadlineRule[]) {
      expect((r.duration.months ?? 0) + (r.duration.days ?? 0)).toBeGreaterThan(0)
      expect(r.basis.length).toBeGreaterThan(0)
    }
  })

  it('expose les délais clés avec leur fondement', () => {
    expect(rule('appel')).toMatchObject({ duration: { months: 1 }, basis: 'art. 538 CPC' })
    expect(rule('pourvoi-cassation')).toMatchObject({
      duration: { months: 2 },
      basis: 'art. 612 CPC'
    })
    expect(rule('appel-ordonnance-refere')).toMatchObject({
      duration: { days: 15 },
      basis: 'art. 490 CPC'
    })
    expect(rule('mise-en-demeure-8j').basis).toBe('usage')
    expect(findDeadlineRule('inexistant')).toBeUndefined()
  })
})

describe('computeDeadline — délais en jours (art. 641 al. 1)', () => {
  it('exclut le dies a quo : le jour de l’acte ne compte pas', () => {
    expect(computeDeadline(rule('mise-en-demeure-8j'), '2026-06-01')).toEqual({
      dateIso: '2026-06-09', // mardi
      adjusted: false,
      adjustedReason: undefined
    })
  })

  it('15 jours sans prorogation quand l’échéance est un jour ouvrable', () => {
    expect(computeDeadline(rule('appel-ordonnance-refere'), '2026-06-01').dateIso).toBe(
      '2026-06-16'
    )
  })
})

describe('computeDeadline — délais en mois (art. 641 al. 2)', () => {
  it('expire au même quantième du mois cible', () => {
    expect(computeDeadline(rule('appel'), '2026-06-10').dateIso).toBe('2026-07-10')
    expect(computeDeadline(rule('pourvoi-cassation'), '2026-04-30').dateIso).toBe('2026-06-30')
  })

  it('à défaut de quantième identique, expire le dernier jour du mois', () => {
    // 31 janvier + 1 mois → 29 février (bissextile) / 28 février
    expect(computeDeadline(rule('appel'), '2024-01-31').dateIso).toBe('2024-02-29')
    expect(computeDeadline(rule('appel'), '2023-01-31').dateIso).toBe('2023-02-28')
    expect(computeDeadline(rule('appel'), '2026-03-31').dateIso).toBe('2026-04-30')
    // 30 août + 6 mois → 28 février (quantième 30 absent)
    expect(computeDeadline(rule('signification-jugement'), '2024-08-30').dateIso).toBe('2025-02-28')
  })
})

describe('computeDeadline — prorogation (art. 642)', () => {
  it('reporte une échéance tombant un dimanche au lundi suivant', () => {
    expect(computeDeadline(rule('appel'), '2026-01-15')).toEqual({
      dateIso: '2026-02-16', // le 15 février 2026 est un dimanche
      adjusted: true,
      adjustedReason: 'weekend'
    })
  })

  it('combine règle du quantième et report de week-end', () => {
    // 31 janvier + 1 mois → samedi 28 février → lundi 2 mars
    expect(computeDeadline(rule('appel'), '2026-01-31')).toEqual({
      dateIso: '2026-03-02',
      adjusted: true,
      adjustedReason: 'weekend'
    })
  })

  it('reporte une échéance tombant un jour férié', () => {
    // 6 juillet + 8 jours → mardi 14 juillet (férié) → mercredi 15
    expect(computeDeadline(rule('mise-en-demeure-8j'), '2026-07-06')).toEqual({
      dateIso: '2026-07-15',
      adjusted: true,
      adjustedReason: 'holiday'
    })
  })

  it('enchaîne férié puis week-end (1er mai 2026 un vendredi)', () => {
    expect(computeDeadline(rule('appel'), '2026-04-01')).toEqual({
      dateIso: '2026-05-04',
      adjusted: true,
      adjustedReason: 'holiday'
    })
  })

  it('enchaîne week-end puis férié (lundi de Pâques)', () => {
    // 20 mars + 15 jours → samedi 4 avril → dim. 5 → lundi de Pâques 6 → mardi 7
    expect(computeDeadline(rule('appel-ordonnance-refere'), '2026-03-20')).toEqual({
      dateIso: '2026-04-07',
      adjusted: true,
      adjustedReason: 'weekend'
    })
  })

  it('qualifie de férié une échéance tombant un samedi férié (15 août 2026)', () => {
    expect(computeDeadline(rule('appel'), '2026-07-15')).toEqual({
      dateIso: '2026-08-17',
      adjusted: true,
      adjustedReason: 'holiday'
    })
  })
})

describe('computeDeadline — durées mixtes mois + jours', () => {
  it('applique les mois (quantième) puis les jours, ex. délai de distance (art. 643)', () => {
    const appelDistance: DeadlineRule = {
      id: 'appel-distance-test',
      labelFr: 'Appel avec délai de distance',
      duration: { months: 1, days: 5 },
      basis: 'art. 538 et 643 CPC'
    }
    expect(computeDeadline(appelDistance, '2026-01-15').dateIso).toBe('2026-02-20')
  })
})
