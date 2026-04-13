import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  buildTrayMenuTemplate,
  createTrayController,
  resolveTrayIconPath,
  resolveTrayLabels
} from '../tray'

describe('tray helpers', () => {
  it('resolves tray labels with i18n-friendly override support', () => {
    const labels = resolveTrayLabels({ tooltip: 'Bac Ordicab' })
    expect(labels.tooltip).toBe('Bac Ordicab')
    expect(labels.openWindow).toBe('Open Ordicab')
    expect(labels.quit).toBe('Quit Ordicab')
  })

  it('uses the first existing tray icon candidate path in packaged mode', () => {
    const appPath = '/Applications/Ordicab.app/Contents/Resources/app.asar'
    const resourcesPath = '/Applications/Ordicab.app/Contents/Resources'
    const expectedPath = join(resourcesPath, 'app.asar.unpacked', 'resources', 'icon.png')

    const iconPath = resolveTrayIconPath(
      { isPackaged: true, appPath, resourcesPath },
      (candidatePath) => candidatePath === expectedPath
    )

    expect(iconPath).toBe(expectedPath)
  })

  it('uses the first existing tray icon candidate path in dev mode', () => {
    const appPath = '/workspace/app'
    const resourcesPath = '/workspace/resources'
    const expectedPath = join(appPath, 'resources', 'icon.png')

    const iconPath = resolveTrayIconPath(
      { isPackaged: false, appPath, resourcesPath },
      (candidatePath) => candidatePath === expectedPath
    )

    expect(iconPath).toBe(expectedPath)
  })

  it('supports a custom tray icon asset name', () => {
    const appPath = '/workspace/app'
    const resourcesPath = '/workspace/resources'
    const expectedPath = join(resourcesPath, 'app.asar.unpacked', 'resources', 'ordicab-logo.png')

    const iconPath = resolveTrayIconPath(
      { isPackaged: true, appPath, resourcesPath, iconFileName: 'ordicab-logo.png' },
      (candidatePath) => candidatePath === expectedPath
    )

    expect(iconPath).toBe(expectedPath)
  })

  it('throws when no tray icon candidate exists', () => {
    expect(() =>
      resolveTrayIconPath(
        { isPackaged: false, appPath: '/workspace', resourcesPath: '/resources' },
        () => false
      )
    ).toThrow('Tray icon not found')
  })
})

describe('createTrayController', () => {
  it('creates a single tray instance and wires click + menu actions', () => {
    const onOpenWindow = vi.fn()
    const onQuit = vi.fn()

    const tray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn()
    }

    const buildMenu = vi.fn((menuTemplate: unknown[]) => menuTemplate)
    const createTray = vi.fn(() => tray)

    const trayController = createTrayController({
      createTray,
      buildMenu,
      isPackaged: false,
      appPath: '/workspace/app',
      resourcesPath: '/workspace/resources',
      onOpenWindow,
      onQuit
    })

    const firstInstance = trayController.initTray()
    const secondInstance = trayController.initTray()

    expect(firstInstance).toBe(secondInstance)
    expect(createTray).toHaveBeenCalledTimes(1)
    expect(tray.setToolTip).toHaveBeenCalledWith('Ordicab')
    expect(tray.on).toHaveBeenCalledWith('click', onOpenWindow)
    expect(buildMenu).toHaveBeenCalledTimes(1)

    const builtTemplate = buildMenu.mock.calls[0][0]
    expect(builtTemplate).toEqual(buildTrayMenuTemplate(resolveTrayLabels(), onOpenWindow, onQuit))
  })

  it('updates tray labels after initialization without recreating the tray', () => {
    const tray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn()
    }

    const buildMenu = vi.fn((menuTemplate: unknown[]) => menuTemplate)
    const createTray = vi.fn(() => tray)

    const trayController = createTrayController({
      createTray,
      buildMenu,
      isPackaged: false,
      appPath: '/workspace/app',
      resourcesPath: '/workspace/resources',
      onOpenWindow: vi.fn(),
      onQuit: vi.fn()
    })

    trayController.initTray()
    trayController.updateLabels({
      tooltip: 'Ordicab FR',
      openWindow: 'Ouvrir Ordicab',
      quit: 'Quitter Ordicab'
    })

    expect(createTray).toHaveBeenCalledTimes(1)
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Ordicab FR')
    expect(tray.setContextMenu).toHaveBeenCalledTimes(2)
    expect(buildMenu.mock.calls[1]?.[0]).toEqual([
      { label: 'Ouvrir Ordicab', click: expect.any(Function) },
      { type: 'separator' },
      { label: 'Quitter Ordicab', click: expect.any(Function) }
    ])
  })
})
