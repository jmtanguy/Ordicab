/**
 * Preload script — the security boundary between the main process and the renderer.
 *
 * Electron loads this script in a privileged context that has access to both
 * Node.js APIs and the browser DOM, but it runs before the renderer page. Its
 * sole job is to expose a controlled surface (ordicabAPI) to the renderer via
 * `contextBridge.exposeInMainWorld`, without leaking the full Node.js or
 * Electron API.
 *
 * Why contextBridge?
 *   With contextIsolation enabled the renderer's JavaScript runs in a separate
 *   V8 context from the preload. contextBridge safely serialises values across
 *   that boundary. Any object exposed here is the ONLY way for renderer code to
 *   communicate with the main process.
 *
 * The actual API shape is built in ./api.ts and the full type contract lives in
 * shared/types/api.ts (OrdicabAPI interface).
 */
import { contextBridge, ipcRenderer } from 'electron'

import { createOrdicabApi } from './api'

const ordicabAPI = createOrdicabApi(
  ipcRenderer.invoke.bind(ipcRenderer),
  ipcRenderer.on.bind(ipcRenderer),
  ipcRenderer.off.bind(ipcRenderer)
)

// Hard-fail if contextIsolation was accidentally disabled. Without it the
// renderer could access Node.js directly, undermining the whole security model.
if (!process.contextIsolated) {
  throw new Error(
    'contextIsolation must be enabled — ordicabAPI cannot be exposed safely without it.'
  )
}

try {
  contextBridge.exposeInMainWorld('ordicabAPI', ordicabAPI)
} catch (error) {
  console.error(error)
}
