import { useEffect, useState } from 'react'
import { create } from 'zustand'

import { safeLocalStorageGet, safeLocalStorageSet } from './ipc'

const TIMER_STORAGE_KEY = 'ordicab.timer.v1'

export interface RunningTimer {
  dossierId: string
  dossierName: string
  label?: string
  /** Wall-clock epoch (ms) when the current running stretch started. */
  startedAtMs: number
  /** Elapsed ms accumulated by the stretches completed before the last pause. */
  pausedAccumulatedMs: number
  isPaused: boolean
}

/**
 * Elapsed time is recomputed from the persisted wall-clock start timestamp
 * rather than an in-memory counter, so an accidental app restart or a long
 * render gap never loses running time.
 */
export function computeElapsedMs(timer: RunningTimer, nowMs: number): number {
  const runningMs = timer.isPaused ? 0 : Math.max(0, nowMs - timer.startedAtMs)
  return timer.pausedAccumulatedMs + runningMs
}

/** Billable minutes: rounded UP to the next whole minute, minimum 1. */
export function elapsedMsToBillableMinutes(elapsedMs: number): number {
  return Math.max(1, Math.ceil(elapsedMs / 60_000))
}

/** Formats elapsed ms as `mm:ss`, or `h:mm:ss` once an hour is reached. */
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const two = (value: number): string => String(value).padStart(2, '0')
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`
}

function sanitizeTimer(raw: unknown): RunningTimer | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<RunningTimer>
  if (typeof value.dossierId !== 'string' || value.dossierId.length === 0) return null
  if (typeof value.dossierName !== 'string') return null
  if (typeof value.startedAtMs !== 'number' || !Number.isFinite(value.startedAtMs)) return null
  const pausedAccumulatedMs =
    typeof value.pausedAccumulatedMs === 'number' && Number.isFinite(value.pausedAccumulatedMs)
      ? Math.max(0, value.pausedAccumulatedMs)
      : 0
  return {
    dossierId: value.dossierId,
    dossierName: value.dossierName,
    label: typeof value.label === 'string' && value.label.length > 0 ? value.label : undefined,
    startedAtMs: value.startedAtMs,
    pausedAccumulatedMs,
    isPaused: value.isPaused === true
  }
}

function loadStoredTimer(): RunningTimer | null {
  const raw = safeLocalStorageGet(TIMER_STORAGE_KEY)
  if (!raw) return null
  try {
    return sanitizeTimer(JSON.parse(raw))
  } catch {
    return null
  }
}

function persistTimer(timer: RunningTimer | null): void {
  if (timer) {
    safeLocalStorageSet(TIMER_STORAGE_KEY, JSON.stringify(timer))
    return
  }
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(TIMER_STORAGE_KEY)
  } catch {
    // Ignore renderer preference persistence failures.
  }
}

interface TimerStoreState {
  timer: RunningTimer | null
}

interface TimerStoreActions {
  /** Starts a timer. No-op when one is already running (at most one timer). */
  start: (dossierId: string, dossierName: string, label?: string) => void
  pause: () => void
  resume: () => void
  /**
   * Stops and clears the timer. Returns the billable minutes (rounded up to
   * the next whole minute, minimum 1), or null when no timer was running.
   */
  stop: () => number | null
  /** Clears the timer without producing billable time. */
  discard: () => void
}

type TimerStore = TimerStoreState & TimerStoreActions

export const useTimerStore = create<TimerStore>()((set, get) => ({
  timer: loadStoredTimer(),
  start: (dossierId, dossierName, label) => {
    if (get().timer) return
    const timer: RunningTimer = {
      dossierId,
      dossierName,
      label: label?.trim() || undefined,
      startedAtMs: Date.now(),
      pausedAccumulatedMs: 0,
      isPaused: false
    }
    persistTimer(timer)
    set({ timer })
  },
  pause: () => {
    const current = get().timer
    if (!current || current.isPaused) return
    const timer: RunningTimer = {
      ...current,
      pausedAccumulatedMs: computeElapsedMs(current, Date.now()),
      isPaused: true
    }
    persistTimer(timer)
    set({ timer })
  },
  resume: () => {
    const current = get().timer
    if (!current || !current.isPaused) return
    const timer: RunningTimer = { ...current, startedAtMs: Date.now(), isPaused: false }
    persistTimer(timer)
    set({ timer })
  },
  stop: () => {
    const current = get().timer
    if (!current) return null
    persistTimer(null)
    set({ timer: null })
    return elapsedMsToBillableMinutes(computeElapsedMs(current, Date.now()))
  },
  discard: () => {
    if (!get().timer) return
    persistTimer(null)
    set({ timer: null })
  }
}))

/** Live elapsed ms for the current timer (1 s tick while running), or null when idle. */
export function useTimerElapsedMs(): number | null {
  const timer = useTimerStore((state) => state.timer)
  const [nowMs, setNowMs] = useState(0)

  useEffect(() => {
    if (!timer || timer.isPaused) return
    // Wall-clock reads happen in timer callbacks only (render must stay pure);
    // the timeout(0) replaces the stale `nowMs` right after mount/resume.
    const first = window.setTimeout(() => setNowMs(Date.now()), 0)
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [timer])

  if (!timer) return null
  // A stale `nowMs` (initial render, resume) clamps to zero running time in
  // computeElapsedMs, so at worst one frame shows only the accumulated time.
  return computeElapsedMs(timer, nowMs)
}
