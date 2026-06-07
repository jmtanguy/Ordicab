/**
 * modelProvisioningService — orchestrates the runtime download of the ONNX
 * models the app no longer bundles (NER for PII pseudonymisation, bge-m3 for
 * semantic search) into the user-data models root.
 *
 * Ordering matters for RGPD: the NER model is downloaded FIRST and is treated
 * as the gate for remote AI calls (pseudonymisation degrades to regex-only
 * without it — see nerDetection.ts). bge-m3 is downloaded second; until it is
 * present, semantic search is unavailable and the UI falls back to keyword
 * search only.
 *
 * The service is intentionally I/O-thin: the actual fetching lives in
 * modelDownloadService. This layer owns the sequencing, the observable status,
 * and the post-download hooks (rebind the embedding worker so it reloads from
 * the now-populated path, and re-index dossiers so documents get bge-m3
 * vectors). All of it is best-effort and offline-safe.
 */

import type { ModelDownloadStatus } from '@shared/types'

import {
  downloadModel,
  isModelPresent,
  EMBEDDING_MODEL,
  NER_MODEL,
  type ManagedModel
} from '../../lib/aiEmbedded/modelDownloadService'

export type ModelKind = 'ner' | 'embedding'

export type ModelStatus = ModelDownloadStatus

export interface ModelProvisioningDeps {
  /** Absolute path to the user-data models root (`{userData}/models`). */
  modelsRoot: string
  /** Called after bge-m3 finishes downloading so the worker reloads it. */
  onEmbeddingModelReady?: () => void | Promise<void>
  /** Emits status changes (wired to IPC → renderer). */
  onStatus?: (status: ModelStatus) => void
  /** Injectable for tests. */
  download?: typeof downloadModel
  isPresent?: typeof isModelPresent
}

export interface ModelProvisioningService {
  /** Current status snapshot. */
  getStatus(): ModelStatus
  /**
   * Ensure both models are present, downloading what's missing. NER first
   * (blocking gate for remote AI), then bge-m3. Safe to call repeatedly;
   * already-present models are skipped. Resolves when the sequence finishes
   * (or has nothing to do). Never rejects — failures land in status.error.
   */
  ensureModels(): Promise<void>
  /** True when the NER model is present (remote-AI RGPD gate). */
  isNerReady(): Promise<boolean>
  /** True when bge-m3 is present (semantic search availability). */
  isEmbeddingReady(): Promise<boolean>
}

export function createModelProvisioningService(
  deps: ModelProvisioningDeps
): ModelProvisioningService {
  const download = deps.download ?? downloadModel
  const isPresent = deps.isPresent ?? isModelPresent

  const status: ModelStatus = {
    ner: 'missing',
    embedding: 'missing',
    progress: null,
    error: null
  }

  function emit(): void {
    deps.onStatus?.({ ...status })
  }

  async function fetchOne(
    kind: ModelKind,
    model: ManagedModel,
    onReady?: () => void | Promise<void>
  ): Promise<void> {
    if (await isPresent(deps.modelsRoot, model)) {
      status[kind] = 'ready'
      emit()
      return
    }
    status[kind] = 'downloading'
    emit()
    try {
      await download(deps.modelsRoot, model, (p) => {
        status.progress = p
        emit()
      })
      status[kind] = 'ready'
      status.progress = null
      emit()
      await onReady?.()
    } catch (err) {
      status[kind] = 'error'
      status.error = err instanceof Error ? err.message : String(err)
      emit()
    }
  }

  let inFlight: Promise<void> | null = null

  async function ensureModels(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      // NER first — it gates remote AI (pseudonymisation). Then bge-m3.
      await fetchOne('ner', NER_MODEL)
      await fetchOne('embedding', EMBEDDING_MODEL, deps.onEmbeddingModelReady)
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    getStatus: () => ({ ...status }),
    ensureModels,
    isNerReady: () => isPresent(deps.modelsRoot, NER_MODEL),
    isEmbeddingReady: () => isPresent(deps.modelsRoot, EMBEDDING_MODEL)
  }
}
