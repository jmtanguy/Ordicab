/**
 * ollamaProcess.ts
 *
 * Manages the lifecycle of the local Ollama server process.
 * When the app starts in "local" AI mode, it tries to launch Ollama
 * automatically so non-technical users don't have to start it manually.
 *
 * Rules:
 *  - If Ollama is already running (HTTP reachable), we leave it alone and
 *    do NOT shut it down on exit (we didn't start it).
 *  - If Ollama is not running, we spawn `ollama serve` and track the PID.
 *    On app quit we kill that child process.
 */

import { execFile, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import * as http from 'node:http'
import * as https from 'node:https'
import { existsSync } from 'fs'
import { join } from 'path'

// ── Candidate binary paths ────────────────────────────────────────────────────

function candidatePaths(): string[] {
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? ''
    return [
      join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\Program Files\\Ollama\\ollama.exe',
      'ollama.exe' // fallback: assume it is in PATH
    ]
  }

  // macOS / Linux
  return [
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    '/opt/homebrew/opt/ollama/bin/ollama',
    '/usr/bin/ollama',
    'ollama' // fallback: assume it is in PATH
  ]
}

function findOllamaBinary(): string | null {
  for (const p of candidatePaths()) {
    // Paths that look absolute — check they actually exist on disk.
    // The bare "ollama" / "ollama.exe" entries are PATH-resolved at spawn time.
    if (p.includes('/') || p.includes('\\')) {
      if (existsSync(p)) return p
    } else {
      // Will be resolved by the shell / PATH at spawn time.
      return p
    }
  }
  return null
}

// ── HTTP reachability check ───────────────────────────────────────────────────

function isOllamaReachable(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Use Node's built-in http/https rather than importing fetch so this
    // module stays free of renderer-side dependencies.
    const url = new URL(endpoint)
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.get(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: '/',
        timeout: 3000
      },
      (res: { statusCode?: number }) => {
        resolve((res.statusCode ?? 0) < 500)
      }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface OllamaProcessManager {
  /** Stop the Ollama process if we started it. No-op otherwise. */
  shutdown(): void
}

/**
 * Ensures the Ollama server is running.
 *
 * @param endpoint  The HTTP endpoint to probe, e.g. "http://localhost:11434"
 * @returns  A manager whose `shutdown()` kills the process if we spawned it.
 */
export async function ensureOllamaRunning(endpoint: string): Promise<OllamaProcessManager> {
  const noOp: OllamaProcessManager = { shutdown: () => {} }

  // 1. Already running? Great — don't touch it.
  const already = await isOllamaReachable(endpoint)
  if (already) {
    console.log('[OllamaProcess] Ollama already running at', endpoint)
    return noOp
  }

  // 2. Find the binary.
  const binary = findOllamaBinary()
  if (!binary) {
    console.warn('[OllamaProcess] Ollama binary not found — user must start it manually.')
    return noOp
  }

  console.log('[OllamaProcess] Spawning Ollama:', binary, 'serve')

  // 3. Spawn `ollama serve` as a detached-ish background process.
  //    On Windows we need shell:true so that bare binary names are resolved
  //    via PATH (absolute paths still work either way).
  let child: ChildProcess | null = null
  try {
    child = spawn(binary, ['serve'], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
      shell: process.platform === 'win32'
    })

    child.on('error', (err) => {
      console.error('[OllamaProcess] Failed to start:', err.message)
      child = null
    })

    child.on('exit', (code) => {
      console.log('[OllamaProcess] Ollama exited with code', code)
      child = null
    })
  } catch (err) {
    console.error('[OllamaProcess] Spawn error:', err)
    return noOp
  }

  // 4. Wait up to 10 s for Ollama to become reachable.
  const ready = await waitUntilReachable(endpoint, 10_000)
  if (ready) {
    console.log('[OllamaProcess] Ollama is ready.')
  } else {
    console.warn('[OllamaProcess] Ollama did not become reachable within 10 s.')
  }

  return {
    shutdown() {
      if (child && child.pid !== undefined) {
        console.log('[OllamaProcess] Shutting down Ollama (pid', child.pid, ')')
        try {
          if (process.platform === 'win32') {
            // On Windows, taskkill is needed to kill the process tree.
            execFile('taskkill', ['/pid', String(child.pid), '/f', '/t'])
          } else {
            child.kill('SIGTERM')
          }
        } catch (err) {
          console.error('[OllamaProcess] Error during shutdown:', err)
        }
        child = null
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitUntilReachable(endpoint: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isOllamaReachable(endpoint)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
