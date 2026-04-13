import chokidar, { type ChokidarOptions } from 'chokidar'
import { basename, isAbsolute, relative } from 'node:path'

import type { AiMode, DomainStatusSnapshot, OrdicabDataChangedEvent } from '@shared/types'

import {
  type InstructionsGeneratorLike,
  DelegatedInstructionsGeneratorError
} from '../aiDelegated/aiDelegatedInstructionsGenerator'
import { isAiDelegatedInstructionsFilename } from '../aiDelegated/aiDelegatedInstructions'
import { ORDICAB_DIRECTORY_NAME } from './ordicabPaths'

interface DomainServiceLike {
  getStatus: () => Promise<DomainStatusSnapshot>
}

export interface OrdicabDataFileWatcherLike {
  on(event: string, listener: (...args: unknown[]) => void): this
  close(): Promise<unknown>
}

export type OrdicabDataWatchFactory = (
  path: string | readonly string[],
  options: ChokidarOptions
) => OrdicabDataFileWatcherLike

export interface OrdicabDataWatcherLike {
  watchActiveDomain: () => Promise<void>
  watchDomain: (domainPath: string) => Promise<void>
  dispose: () => Promise<void>
}

export interface OrdicabDataWatcherOptions {
  domainService: DomainServiceLike
  instructionsGenerator: InstructionsGeneratorLike
  listRegisteredDossiers: () => Promise<Array<{ id: string }>>
  onDataChanged?: (event: OrdicabDataChangedEvent) => void
  onDocxTemplateChanged?: (templateId: string) => void
  getActiveAiMode?: () => AiMode
  debounceMs?: number
  logError?: (message: string, error: unknown) => void
  watchFactory?: OrdicabDataWatchFactory
}

const DEFAULT_DEBOUNCE_MS = 500

type OrdicabDataChangeTarget = Omit<OrdicabDataChangedEvent, 'changedAt'>
type RelevantOrdicabChange =
  | { scope: 'domain' }
  | { scope: 'domain-docx-template'; templateId: string }
  | { scope: 'dossier-metadata'; dossierId: string }
  | { scope: 'dossier-documents'; dossierId: string }

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function hasHiddenSegment(segments: string[]): boolean {
  return segments.some((segment) => segment.startsWith('.'))
}

function getRelativeDomainPath(domainPath: string, filePath: unknown): string | null {
  if (typeof filePath !== 'string') {
    return null
  }

  const relativePath = relative(domainPath, filePath)
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    relativePath === '..' ||
    isAbsolute(relativePath)
  ) {
    return null
  }

  return normalizeRelativePath(relativePath)
}

function inferOrdicabDataType(filePath: string): OrdicabDataChangedEvent['type'] | null {
  const filename = basename(filePath)

  if (filename === 'contacts.json') {
    return 'contacts'
  }

  if (filename === 'dossier.json') {
    return 'dossier'
  }

  if (filename === 'entity.json') {
    return 'entity'
  }

  if (filename === 'templates.json') {
    return 'templates'
  }

  return null
}

export function inferOrdicabDataChangeTarget(
  domainPath: string,
  filePath: unknown
): OrdicabDataChangeTarget | null {
  if (typeof filePath !== 'string') {
    return null
  }

  const dataType = inferOrdicabDataType(filePath)

  if (!dataType) {
    return null
  }

  const relativePath = getRelativeDomainPath(domainPath, filePath)
  if (!relativePath) {
    return null
  }

  const segments = relativePath.split(/[/\\]+/)

  if (segments[0] === ORDICAB_DIRECTORY_NAME) {
    return dataType === 'entity' || dataType === 'templates'
      ? { dossierId: null, type: dataType }
      : null
  }

  if (segments.length >= 3 && segments[1] === ORDICAB_DIRECTORY_NAME) {
    return dataType === 'contacts' || dataType === 'dossier'
      ? {
          dossierId: segments[0],
          type: dataType
        }
      : null
  }

  return null
}

export function createOrdicabDataWatcher(
  options: OrdicabDataWatcherOptions
): OrdicabDataWatcherLike {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const logError =
    options.logError ??
    ((message: string, error: unknown) => {
      console.error(message, error)
    })
  const watchFactory =
    options.watchFactory ??
    ((path, watchOptions) => {
      const normalizedPath: string | string[] = typeof path === 'string' ? path : Array.from(path)

      return chokidar.watch(normalizedPath, watchOptions) as unknown as OrdicabDataFileWatcherLike
    })

  let activeDomainPath: string | null = null
  let watcher: OrdicabDataFileWatcherLike | null = null
  let domainChangeTimer: ReturnType<typeof setTimeout> | null = null
  const dossierChangeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingDomainEvents = new Map<OrdicabDataChangedEvent['type'], OrdicabDataChangeTarget>()
  const pendingDossierEvents = new Map<
    string,
    Map<OrdicabDataChangedEvent['type'], OrdicabDataChangeTarget>
  >()

  function clearQueuedEvents(): void {
    pendingDomainEvents.clear()
    pendingDossierEvents.clear()
  }

  async function closeWatcher(): Promise<void> {
    if (domainChangeTimer) {
      clearTimeout(domainChangeTimer)
      domainChangeTimer = null
    }

    for (const timer of dossierChangeTimers.values()) {
      clearTimeout(timer)
    }
    dossierChangeTimers.clear()
    clearQueuedEvents()

    if (!watcher) {
      return
    }

    const currentWatcher = watcher
    watcher = null
    await currentWatcher.close()
  }

  function logGenerationError(error: unknown): void {
    const message =
      error instanceof DelegatedInstructionsGeneratorError
        ? '[OrdicabDataWatcher] CLAUDE.md regeneration failed.'
        : '[OrdicabDataWatcher] Unexpected regeneration failure.'

    logError(message, error)
  }

  function clearDossierTimer(dossierId: string): void {
    const timer = dossierChangeTimers.get(dossierId)

    if (!timer) {
      return
    }

    clearTimeout(timer)
    dossierChangeTimers.delete(dossierId)
  }

  function clearAllDossierTimers(): void {
    for (const dossierId of dossierChangeTimers.keys()) {
      clearDossierTimer(dossierId)
    }
  }

  function queueRendererEvent(event: OrdicabDataChangeTarget): void {
    if (event.dossierId === null) {
      pendingDomainEvents.set(event.type, event)
      return
    }

    const dossierEvents = pendingDossierEvents.get(event.dossierId) ?? new Map()
    dossierEvents.set(event.type, event)
    pendingDossierEvents.set(event.dossierId, dossierEvents)
  }

  function emitRendererEvents(events: Iterable<OrdicabDataChangeTarget>): void {
    if (!options.onDataChanged) {
      return
    }

    const changedAt = new Date().toISOString()

    for (const event of events) {
      options.onDataChanged({
        ...event,
        changedAt
      })
    }
  }

  function flushAllRendererEvents(): void {
    if (pendingDomainEvents.size === 0 && pendingDossierEvents.size === 0) {
      return
    }

    emitRendererEvents(pendingDomainEvents.values())

    for (const events of pendingDossierEvents.values()) {
      emitRendererEvents(events.values())
    }

    clearQueuedEvents()
  }

  function flushDossierRendererEvents(dossierId: string): void {
    const events = pendingDossierEvents.get(dossierId)

    if (!events) {
      return
    }

    emitRendererEvents(events.values())
    pendingDossierEvents.delete(dossierId)
  }

  function scheduleDomainGeneration(domainPath: string): void {
    if (domainChangeTimer) {
      clearTimeout(domainChangeTimer)
    }

    clearAllDossierTimers()

    domainChangeTimer = setTimeout(() => {
      domainChangeTimer = null
      flushAllRendererEvents()
      const mode = options.getActiveAiMode?.() ?? 'claude-code'
      void options.instructionsGenerator.generateForMode(domainPath, mode).catch(logGenerationError)
    }, debounceMs)
  }

  function scheduleDossierEventFlush(dossierId: string): void {
    if (domainChangeTimer) {
      return
    }

    clearDossierTimer(dossierId)
    dossierChangeTimers.set(
      dossierId,
      setTimeout(() => {
        dossierChangeTimers.delete(dossierId)
        flushDossierRendererEvents(dossierId)
      }, debounceMs)
    )
  }

  function classifyChange(domainPath: string, filePath: unknown): RelevantOrdicabChange | null {
    const relativePath = getRelativeDomainPath(domainPath, filePath)
    if (!relativePath) {
      return null
    }

    const segments = relativePath.split('/')
    const filename = segments.at(-1) ?? ''

    if (relativePath.startsWith('.ordicab-delegated/')) {
      return null
    }

    if (isAiDelegatedInstructionsFilename(filename)) {
      return null
    }

    if (segments[0] === ORDICAB_DIRECTORY_NAME) {
      // Detect changes to template docx source files: .ordicab/templates/{id}.docx
      if (segments[1] === 'templates' && filename.endsWith('.docx')) {
        const templateId = filename.slice(0, -5)
        return { scope: 'domain-docx-template', templateId }
      }

      if (
        filename !== 'entity.json' &&
        filename !== 'templates.json' &&
        filename !== 'registry.json'
      ) {
        return null
      }

      return { scope: 'domain' }
    }

    if (segments.length >= 3 && segments[1] === ORDICAB_DIRECTORY_NAME) {
      if (filename !== 'contacts.json' && filename !== 'dossier.json') {
        return null
      }

      return {
        scope: 'dossier-metadata',
        dossierId: segments[0]
      }
    }

    if (segments.length >= 2 && !hasHiddenSegment(segments)) {
      return {
        scope: 'dossier-documents',
        dossierId: segments[0]
      }
    }

    return null
  }

  function attachWatcher(nextWatcher: OrdicabDataFileWatcherLike, domainPath: string): void {
    const onDataChanged = (
      event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir',
      filePath: unknown
    ): void => {
      const change = classifyChange(domainPath, filePath)

      if (!change) {
        return
      }

      if (event !== 'unlink') {
        const rendererEvent = inferOrdicabDataChangeTarget(domainPath, filePath)

        if (rendererEvent) {
          queueRendererEvent(rendererEvent)
        }
      }

      if (change.scope === 'domain-docx-template') {
        if (event === 'change' || event === 'add') {
          options.onDocxTemplateChanged?.(change.templateId)
        }
        return
      }

      if (change.scope === 'domain') {
        scheduleDomainGeneration(domainPath)
        return
      }

      scheduleDossierEventFlush(change.dossierId)
    }

    nextWatcher.on('add', (filePath) => {
      onDataChanged('add', filePath)
    })
    nextWatcher.on('change', (filePath) => {
      onDataChanged('change', filePath)
    })
    nextWatcher.on('unlink', (filePath) => {
      onDataChanged('unlink', filePath)
    })
    nextWatcher.on('addDir', (filePath) => {
      onDataChanged('addDir', filePath)
    })
    nextWatcher.on('unlinkDir', (filePath) => {
      onDataChanged('unlinkDir', filePath)
    })
    nextWatcher.on('error', (error) => {
      logError('[OrdicabDataWatcher] File watching error.', error)
    })
  }

  async function watchDomain(domainPath: string): Promise<void> {
    if (activeDomainPath === domainPath && watcher) {
      return
    }

    activeDomainPath = domainPath
    await closeWatcher()

    const nextWatcher = watchFactory(domainPath, {
      depth: 2,
      ignoreInitial: true,
      persistent: true
    })

    watcher = nextWatcher
    attachWatcher(nextWatcher, domainPath)
  }

  return {
    watchActiveDomain: async (): Promise<void> => {
      const status = await options.domainService.getStatus()

      if (!status.registeredDomainPath || !status.isAvailable) {
        activeDomainPath = null
        await closeWatcher()
        return
      }

      await watchDomain(status.registeredDomainPath)
    },

    watchDomain,

    dispose: async (): Promise<void> => {
      activeDomainPath = null
      await closeWatcher()
    }
  }
}
