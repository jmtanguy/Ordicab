import { z } from 'zod'

import type {
  CalendarSyncOptionsInput,
  CalendarSyncSettingsSaveInput
} from '@shared/domain/calendarSync'

export const calendarSyncSettingsSaveInputSchema = z.object({
  serverUrl: z.string().trim().url('Expected a valid CalDAV server URL'),
  username: z.string().trim().min(1),
  password: z.string().min(1).optional()
})

export const calendarSyncOptionsInputSchema = z.object({
  enabled: z.boolean().optional(),
  futureOnly: z.boolean().optional()
})

export type { CalendarSyncOptionsInput, CalendarSyncSettingsSaveInput }
