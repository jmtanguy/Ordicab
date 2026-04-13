import { afterEach, describe, expect, it } from 'vitest'

import { createRendererI18n, normalizeAppLocale } from '../index'

describe('normalizeAppLocale', () => {
  it('keeps supported locales and strips regional variants', () => {
    expect(normalizeAppLocale('en')).toBe('en')
    expect(normalizeAppLocale('fr-FR')).toBe('fr')
    expect(normalizeAppLocale('fr-CA')).toBe('fr')
    expect(normalizeAppLocale('es-ES')).toBe('en')
    expect(normalizeAppLocale(undefined)).toBe('en')
  })
})

describe('createRendererI18n', () => {
  afterEach(async () => {
    const i18n = await createRendererI18n('en')
    await i18n.changeLanguage('en')
  })

  it('initializes in the requested locale and supports live switching', async () => {
    const i18n = await createRendererI18n('fr')

    expect(i18n.language).toBe('fr')
    expect(i18n.t('dashboard.settings_title')).toBe('Réglages')

    await i18n.changeLanguage('en')

    expect(i18n.t('dashboard.settings_title')).toBe('Settings')
  })

  it('falls back unsupported locales to English', async () => {
    const i18n = await createRendererI18n('es-ES')

    expect(i18n.language).toBe('en')
    expect(i18n.t('dashboard.change_domain_action')).toBe('Change Domain')
  })
})
