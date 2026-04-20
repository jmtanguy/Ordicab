import { describe, expect, it, vi } from 'vitest'

import { createMainWindow, createMainWindowLifecycle } from '../window'

function createWindowMock(options?: { visible?: boolean; destroyed?: boolean }): {
  isDestroyed: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
} {
  return {
    isDestroyed: vi.fn(() => options?.destroyed ?? false),
    isVisible: vi.fn(() => options?.visible ?? false),
    show: vi.fn(),
    focus: vi.fn()
  }
}

function createBrowserWindowMock(): {
  isDestroyed: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  webContents: { setWindowOpenHandler: ReturnType<typeof vi.fn> }
} {
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    show: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    webContents: { setWindowOpenHandler: vi.fn() }
  }
}

describe('createMainWindow', () => {
  it('loads renderer URL when rendererUrl is provided', () => {
    const instance = createBrowserWindowMock()
    const BrowserWindowCtor = vi.fn(() => instance)
    const openExternal = vi.fn()

    createMainWindow({
      BrowserWindow: BrowserWindowCtor as never,
      preloadPath: '/preload.js',
      rendererIndexPath: '/index.html',
      rendererUrl: 'http://localhost:5173',
      platform: 'darwin',
      openExternal
    })

    expect(instance.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    expect(instance.loadFile).not.toHaveBeenCalled()
  })

  it('loads renderer file when no rendererUrl is provided', () => {
    const instance = createBrowserWindowMock()
    const BrowserWindowCtor = vi.fn(() => instance)

    createMainWindow({
      BrowserWindow: BrowserWindowCtor as never,
      preloadPath: '/preload.js',
      rendererIndexPath: '/index.html',
      platform: 'darwin',
      openExternal: vi.fn()
    })

    expect(instance.loadFile).toHaveBeenCalledWith('/index.html')
    expect(instance.loadURL).not.toHaveBeenCalled()
  })

  it('sets window open handler that denies and delegates to openExternal', () => {
    const instance = createBrowserWindowMock()
    const BrowserWindowCtor = vi.fn(() => instance)
    const openExternal = vi.fn()

    createMainWindow({
      BrowserWindow: BrowserWindowCtor as never,
      preloadPath: '/preload.js',
      rendererIndexPath: '/index.html',
      platform: 'darwin',
      openExternal
    })

    const handler = instance.webContents.setWindowOpenHandler.mock.calls[0][0] as (details: {
      url: string
    }) => { action: string }
    const result = handler({ url: 'https://example.com' })

    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    expect(result).toEqual({ action: 'deny' })
  })

  it('sets linux icon only on linux platform', () => {
    const instance = createBrowserWindowMock()
    let capturedOptions: Record<string, unknown> | undefined

    createMainWindow({
      BrowserWindow: class {
        constructor(opts: Record<string, unknown>) {
          capturedOptions = opts
          return instance
        }
      } as never,
      preloadPath: '/preload.js',
      rendererIndexPath: '/index.html',
      platform: 'linux',
      linuxIconPath: '/icon.png',
      openExternal: vi.fn()
    })

    expect(capturedOptions?.icon).toBe('/icon.png')
  })

  it('does not set icon on non-linux platforms', () => {
    const instance = createBrowserWindowMock()
    let capturedOptions: Record<string, unknown> | undefined

    createMainWindow({
      BrowserWindow: class {
        constructor(opts: Record<string, unknown>) {
          capturedOptions = opts
          return instance
        }
      } as never,
      preloadPath: '/preload.js',
      rendererIndexPath: '/index.html',
      platform: 'darwin',
      linuxIconPath: '/icon.png',
      openExternal: vi.fn()
    })

    expect(capturedOptions?.icon).toBeUndefined()
  })
})

describe('createMainWindowLifecycle', () => {
  it('shows and focuses the window when showWindow is called', () => {
    const windowMock = createWindowMock({ visible: false })
    const createWindow = vi.fn(() => windowMock)
    const lifecycle = createMainWindowLifecycle({ createWindow })

    lifecycle.showWindow()

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(windowMock.show).toHaveBeenCalledTimes(1)
    expect(windowMock.focus).toHaveBeenCalledTimes(1)
  })

  it('does not call show on an already-visible window but still focuses it', () => {
    const windowMock = createWindowMock({ visible: true })
    const lifecycle = createMainWindowLifecycle({ createWindow: () => windowMock })

    lifecycle.showWindow()

    expect(windowMock.show).not.toHaveBeenCalled()
    expect(windowMock.focus).toHaveBeenCalledTimes(1)
  })

  it('reuses the same window instance until it is destroyed', () => {
    const firstWindow = createWindowMock({ destroyed: false })
    const secondWindow = createWindowMock({ destroyed: false })
    let createCount = 0

    const lifecycle = createMainWindowLifecycle({
      createWindow: () => {
        createCount += 1
        return createCount === 1 ? firstWindow : secondWindow
      }
    })

    const initialWindow = lifecycle.getOrCreateWindow()
    expect(initialWindow).toBe(firstWindow)
    expect(lifecycle.getOrCreateWindow()).toBe(firstWindow)
    expect(createCount).toBe(1)

    firstWindow.isDestroyed.mockReturnValue(true)
    expect(lifecycle.getOrCreateWindow()).toBe(secondWindow)
    expect(createCount).toBe(2)
  })
})
