import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface TrayLabels {
  tooltip: string
  openWindow: string
  quit: string
}

const DEFAULT_TRAY_LABELS: TrayLabels = {
  tooltip: 'Ordicab',
  openWindow: 'Open Ordicab',
  quit: 'Quit Ordicab'
}

export interface TrayMenuItem {
  label?: string
  type?: 'separator'
  click?(): void
}

export interface TrayLike {
  setToolTip(text: string): void
  setContextMenu(menu: unknown): void
  on(event: 'click', listener: () => void): void
}

export interface TrayControllerOptions<TTray extends TrayLike, TMenu> {
  createTray(iconPath: string): TTray
  buildMenu(template: TrayMenuItem[]): TMenu
  isPackaged: boolean
  appPath: string
  resourcesPath: string
  iconFileName?: string
  labels?: Partial<TrayLabels>
  onOpenWindow(): void
  onQuit(): void
  fileExists?(path: string): boolean
}

export function resolveTrayLabels(overrides?: Partial<TrayLabels>): TrayLabels {
  return {
    ...DEFAULT_TRAY_LABELS,
    ...overrides
  }
}

export function buildTrayMenuTemplate(
  labels: TrayLabels,
  onOpenWindow: () => void,
  onQuit: () => void
): TrayMenuItem[] {
  return [
    {
      label: labels.openWindow,
      click: onOpenWindow
    },
    {
      type: 'separator'
    },
    {
      label: labels.quit,
      click: onQuit
    }
  ]
}

export interface TrayIconPathOptions {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
  iconFileName?: string
}

export function resolveTrayIconPath(
  options: TrayIconPathOptions,
  fileExists: (path: string) => boolean = existsSync
): string {
  const iconFileName = options.iconFileName ?? 'icon.png'
  const packagedCandidates = [
    join(options.resourcesPath, iconFileName),
    join(options.resourcesPath, 'app.asar.unpacked', 'resources', iconFileName),
    join(options.appPath, 'resources', iconFileName)
  ]

  const developmentCandidates = [
    join(options.appPath, 'resources', iconFileName),
    join(process.cwd(), 'resources', iconFileName)
  ]

  const candidates = options.isPackaged ? packagedCandidates : developmentCandidates
  const resolved = candidates.find((candidatePath) => fileExists(candidatePath))
  if (!resolved) {
    throw new Error(`Tray icon not found. Searched:\n${candidates.map((p) => `  ${p}`).join('\n')}`)
  }
  return resolved
}

export interface TrayController<TTray extends TrayLike> {
  initTray(): TTray
  getTray(): TTray | null
  updateLabels(labels: Partial<TrayLabels>): void
}

export function createTrayController<TTray extends TrayLike, TMenu>(
  options: TrayControllerOptions<TTray, TMenu>
): TrayController<TTray> {
  let tray: TTray | null = null
  let currentLabels = resolveTrayLabels(options.labels)

  function applyLabels(labels: TrayLabels): void {
    if (!tray) {
      return
    }

    tray.setToolTip(labels.tooltip)
    const menuTemplate = buildTrayMenuTemplate(labels, options.onOpenWindow, options.onQuit)
    tray.setContextMenu(options.buildMenu(menuTemplate))
  }

  function initTray(): TTray {
    if (tray) {
      return tray
    }

    const trayIconPath = resolveTrayIconPath(
      {
        isPackaged: options.isPackaged,
        appPath: options.appPath,
        resourcesPath: options.resourcesPath,
        iconFileName: options.iconFileName
      },
      options.fileExists
    )

    tray = options.createTray(trayIconPath)
    tray.on('click', options.onOpenWindow)
    applyLabels(currentLabels)

    return tray
  }

  return {
    initTray,
    getTray(): TTray | null {
      return tray
    },
    updateLabels(labels: Partial<TrayLabels>): void {
      currentLabels = resolveTrayLabels({
        ...currentLabels,
        ...labels
      })
      applyLabels(currentLabels)
    }
  }
}
