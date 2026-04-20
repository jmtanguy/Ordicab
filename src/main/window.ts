/**
 * Main window creation and lifecycle management.
 *
 * Two responsibilities are split into two factory functions:
 *
 * `createMainWindow`
 *   Instantiates the BrowserWindow with hardened security settings
 *   (contextIsolation: true, nodeIntegration: false) and points it at the
 *   renderer — either the Vite dev server URL in development, or the built
 *   index.html in production. Also intercepts any window.open / anchor[target]
 *   calls and forwards them to the OS browser instead of opening a new
 *   Electron window.
 *
 * `createMainWindowLifecycle`
 *   Thin stateful wrapper around the BrowserWindow. It re-creates the window
 *   if it has been destroyed (e.g. macOS "activate" after closing the window)
 *   and exposes `showWindow` for platforms/events that need to bring it to
 *   the foreground.
 *
 * Both functions accept interface-based dependencies so they are fully
 * unit-testable without a real Electron environment.
 */
export interface BrowserWindowLike {
  isDestroyed(): boolean
  isVisible(): boolean
  show(): void
  focus(): void
}

export interface WebContentsLike {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
}

export interface BrowserWindowRuntimeLike extends BrowserWindowLike {
  webContents: WebContentsLike
  loadURL(url: string): void
  loadFile(path: string): void
}

export interface BrowserWindowConstructorLike<TWindow extends BrowserWindowRuntimeLike> {
  new (options: BrowserWindowOptions): TWindow
}

export interface BrowserWindowOptions {
  width: number
  height: number
  minWidth: number
  minHeight: number
  title: string
  show: boolean
  autoHideMenuBar: boolean
  icon?: string
  webPreferences: {
    preload: string
    contextIsolation: true
    nodeIntegration: false
  }
}

export interface MainWindowCreationOptions<TWindow extends BrowserWindowRuntimeLike> {
  BrowserWindow: BrowserWindowConstructorLike<TWindow>
  preloadPath: string
  rendererIndexPath: string
  rendererUrl?: string
  platform: NodeJS.Platform
  linuxIconPath?: string
  openExternal(url: string): void
}

export interface MainWindowLifecycleOptions<TWindow extends BrowserWindowLike> {
  createWindow(): TWindow
}

export interface MainWindowLifecycle<TWindow extends BrowserWindowLike> {
  getWindow(): TWindow | null
  getOrCreateWindow(): TWindow
  showWindow(): TWindow
}

export function createMainWindow<TWindow extends BrowserWindowRuntimeLike>(
  options: MainWindowCreationOptions<TWindow>
): TWindow {
  const browserWindowOptions: BrowserWindowOptions = {
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 720,
    title: 'Ordicab',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  }

  if (options.platform === 'linux' && options.linuxIconPath) {
    browserWindowOptions.icon = options.linuxIconPath
  }

  const mainWindow = new options.BrowserWindow(browserWindowOptions)

  // Prevent Electron from opening new child windows. Any navigation target
  // (links, window.open) is redirected to the system browser instead.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    options.openExternal(details.url)
    return { action: 'deny' }
  })

  if (options.rendererUrl) {
    mainWindow.loadURL(options.rendererUrl)
  } else {
    mainWindow.loadFile(options.rendererIndexPath)
  }

  return mainWindow
}

export function createMainWindowLifecycle<TWindow extends BrowserWindowLike>(
  options: MainWindowLifecycleOptions<TWindow>
): MainWindowLifecycle<TWindow> {
  let mainWindow: TWindow | null = null

  function getOrCreateWindow(): TWindow {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = options.createWindow()
    }
    return mainWindow
  }

  return {
    getWindow(): TWindow | null {
      if (mainWindow && mainWindow.isDestroyed()) {
        return null
      }
      return mainWindow
    },
    getOrCreateWindow,
    showWindow(): TWindow {
      const windowInstance = getOrCreateWindow()
      if (!windowInstance.isVisible()) {
        windowInstance.show()
      }
      windowInstance.focus()
      return windowInstance
    }
  }
}
