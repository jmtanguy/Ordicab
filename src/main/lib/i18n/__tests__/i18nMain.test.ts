import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createMainI18n, detectSupportedLocale } from '../i18nMain'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-i18n-main-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('detectSupportedLocale', () => {
  it('matches supported French locales and falls back to English otherwise', () => {
    expect(detectSupportedLocale(['fr-FR'])).toBe('fr')
    expect(detectSupportedLocale(['fr-CA', 'en-US'])).toBe('fr')
    expect(detectSupportedLocale(['de-DE'])).toBe('en')
    expect(detectSupportedLocale([])).toBe('en')
  })
})

describe('createMainI18n', () => {
  it('uses the detected system locale on first launch and exposes translated tray labels', async () => {
    const root = await createTempDir()
    const service = await createMainI18n({
      stateFilePath: join(root, 'locale-state.json'),
      preferredSystemLanguages: ['fr-FR']
    })

    expect(service.getLocale()).toBe('fr')
    expect(service.getTrayLabels()).toEqual({
      tooltip: 'Ordicab',
      openWindow: 'Ouvrir Ordicab',
      quit: 'Quitter Ordicab'
    })
  })

  it('persists an explicit locale override that wins on the next cold start', async () => {
    const root = await createTempDir()
    const stateFilePath = join(root, 'locale-state.json')
    const service = await createMainI18n({
      stateFilePath,
      preferredSystemLanguages: ['fr-FR']
    })

    await service.setLocale('en')

    await expect(readFile(stateFilePath, 'utf8')).resolves.toContain('"locale": "en"')

    const reloaded = await createMainI18n({
      stateFilePath,
      preferredSystemLanguages: ['fr-FR']
    })

    expect(reloaded.getLocale()).toBe('en')
    expect(reloaded.getTrayLabels().openWindow).toBe('Open Ordicab')
  })

  it('ignores unsupported persisted locales and falls back to the detected locale', async () => {
    const root = await createTempDir()
    const stateFilePath = join(root, 'locale-state.json')
    await writeFile(stateFilePath, JSON.stringify({ locale: 'es' }), 'utf8')

    const service = await createMainI18n({
      stateFilePath,
      preferredSystemLanguages: ['fr-FR']
    })

    expect(service.getLocale()).toBe('fr')
  })
})
