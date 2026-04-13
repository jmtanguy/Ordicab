import type { AppLocale } from '@shared/types'

export type AsyncVoidAction = () => Promise<void>
export type AsyncLocaleAction = (locale: AppLocale) => Promise<void>
