// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  computeElapsedMs,
  elapsedMsToBillableMinutes,
  formatElapsed,
  useTimerStore,
  type RunningTimer
} from '../timerStore'

const STORAGE_KEY = 'ordicab.timer.v1'

function resetStore(): void {
  window.localStorage.clear()
  // Reset only the state fields (not a full replace) so the action functions
  // created at store construction time are preserved.
  useTimerStore.setState({ timer: null })
}

beforeEach(() => {
  resetStore()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-11T10:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('timerStore elapsed computation', () => {
  it('recomputes elapsed time from the wall-clock start timestamp', () => {
    const timer: RunningTimer = {
      dossierId: 'dos-1',
      dossierName: 'Dupont c/ Martin',
      startedAtMs: Date.now(),
      pausedAccumulatedMs: 0,
      isPaused: false
    }
    expect(computeElapsedMs(timer, timer.startedAtMs + 90_000)).toBe(90_000)
  })

  it('freezes elapsed time while paused and adds the accumulated stretches', () => {
    const timer: RunningTimer = {
      dossierId: 'dos-1',
      dossierName: 'Dupont c/ Martin',
      startedAtMs: Date.now(),
      pausedAccumulatedMs: 120_000,
      isPaused: true
    }
    // `now` far beyond the start: a paused timer only reports the accumulation.
    expect(computeElapsedMs(timer, timer.startedAtMs + 999_000)).toBe(120_000)
  })

  it('never reports negative running time (clock set backwards)', () => {
    const timer: RunningTimer = {
      dossierId: 'dos-1',
      dossierName: 'Dupont c/ Martin',
      startedAtMs: Date.now(),
      pausedAccumulatedMs: 60_000,
      isPaused: false
    }
    expect(computeElapsedMs(timer, timer.startedAtMs - 5_000)).toBe(60_000)
  })

  it('pause then resume keeps the paused gap out of the elapsed time', () => {
    const store = useTimerStore.getState()
    store.start('dos-1', 'Dupont c/ Martin')

    vi.advanceTimersByTime(2 * 60_000)
    store.pause()
    vi.advanceTimersByTime(30 * 60_000) // long pause, must not count
    store.resume()
    vi.advanceTimersByTime(60_000)

    const timer = useTimerStore.getState().timer
    expect(timer).not.toBeNull()
    expect(computeElapsedMs(timer!, Date.now())).toBe(3 * 60_000)
  })
})

describe('timerStore billable rounding', () => {
  it('rounds elapsed time UP to the next whole minute', () => {
    expect(elapsedMsToBillableMinutes(60_001)).toBe(2)
    expect(elapsedMsToBillableMinutes(14 * 60_000 + 1_000)).toBe(15)
  })

  it('keeps exact whole minutes as-is', () => {
    expect(elapsedMsToBillableMinutes(5 * 60_000)).toBe(5)
  })

  it('bills at least 1 minute', () => {
    expect(elapsedMsToBillableMinutes(0)).toBe(1)
    expect(elapsedMsToBillableMinutes(10_000)).toBe(1)
  })

  it('stop() returns the rounded-up minutes and clears the timer', () => {
    const store = useTimerStore.getState()
    store.start('dos-1', 'Dupont c/ Martin')
    vi.advanceTimersByTime(2 * 60_000 + 10_000)

    expect(store.stop()).toBe(3)
    expect(useTimerStore.getState().timer).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('stop() returns null when no timer is running', () => {
    expect(useTimerStore.getState().stop()).toBeNull()
  })
})

describe('timerStore lifecycle', () => {
  it('start() keeps at most one running timer', () => {
    const store = useTimerStore.getState()
    store.start('dos-1', 'Dupont c/ Martin', 'Rédaction conclusions')
    store.start('dos-2', 'Autre dossier')

    const timer = useTimerStore.getState().timer
    expect(timer?.dossierId).toBe('dos-1')
    expect(timer?.label).toBe('Rédaction conclusions')
  })

  it('discard() clears the timer without billing', () => {
    const store = useTimerStore.getState()
    store.start('dos-1', 'Dupont c/ Martin')
    store.discard()

    expect(useTimerStore.getState().timer).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('pause() and resume() are no-ops in the wrong state', () => {
    const store = useTimerStore.getState()
    store.resume()
    expect(useTimerStore.getState().timer).toBeNull()

    store.start('dos-1', 'Dupont c/ Martin')
    store.resume() // already running
    expect(useTimerStore.getState().timer?.isPaused).toBe(false)

    store.pause()
    store.pause() // already paused
    expect(useTimerStore.getState().timer?.isPaused).toBe(true)
  })
})

describe('timerStore persistence shape', () => {
  it('persists the running timer to localStorage', () => {
    useTimerStore.getState().start('dos-1', 'Dupont c/ Martin', 'Audience')

    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toEqual({
      dossierId: 'dos-1',
      dossierName: 'Dupont c/ Martin',
      label: 'Audience',
      startedAtMs: Date.now(),
      pausedAccumulatedMs: 0,
      isPaused: false
    })
  })

  it('persists pause accumulation so a restart keeps the paused elapsed time', () => {
    const store = useTimerStore.getState()
    store.start('dos-1', 'Dupont c/ Martin')
    vi.advanceTimersByTime(90_000)
    store.pause()

    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)
    expect(persisted.pausedAccumulatedMs).toBe(90_000)
    expect(persisted.isPaused).toBe(true)
  })
})

describe('formatElapsed', () => {
  it('formats as mm:ss under one hour', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65_000)).toBe('01:05')
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe('59:59')
  })

  it('formats as h:mm:ss from one hour on', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00')
    expect(formatElapsed(2 * 3_600_000 + 5 * 60_000 + 9_000)).toBe('2:05:09')
  })
})
