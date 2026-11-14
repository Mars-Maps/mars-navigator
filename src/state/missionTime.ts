import { useMemo } from 'react'
import { create } from 'zustand'
import {
  marsSolarTime,
  type Classified,
  type MarsSolarTime,
  type TimeState,
} from '../domain'

/**
 * The mission clock (#7). Its own store, separate from missionStore,
 * so a time change re-renders only what reads time — the sun light, the
 * caption, the time menu.
 *
 * The clock runs: once a second the shell's ticker
 * calls `tick`, which recomputes the instant from an anchor — the instant
 * last set and the real-clock moment it was set at — so it never drifts by
 * accumulating intervals. Setting a date, time or slider position moves the
 * anchor and the clock carries on from there. Pause freezes it; Run resumes
 * from the frozen instant with no jump. Pause is sticky: setting a time
 * while paused moves the frozen clock and leaves it paused. Set now returns
 * to real time and runs. Sun position is always calculated from the
 * instant, never stored, so the two cannot disagree.
 *
 * Every action takes `now` so a test can drive the clock without faking
 * Date; the app leaves it to default to Date.now(). Components get them
 * through `useMissionTime`, which hides `now`: passed straight to onClick,
 * an action would receive the click event as `now`, and NaN in the clock
 * sends every picker into a render loop.
 */
export interface MissionTimeState extends TimeState {
  /** Whether the clock advances with real time. */
  running: boolean
  /** The instant last set, and the real-clock moment it was set at. */
  anchorUtcMs: number
  anchorRealMs: number
  /** Ignored unless finite — a bad date input must not break the scene. Keeps running or paused. */
  setInstant: (utcMs: number, now?: number) => void
  /** Real time, running. */
  setNow: (now?: number) => void
  pause: () => void
  resume: (now?: number) => void
  /** Advance to `now` if running. Returns the same state otherwise, so nothing re-renders. */
  tick: (now?: number) => void
}

export const useMissionTimeStore = create<MissionTimeState>()((set) => {
  const start = Date.now()
  return {
    utcMs: start,
    running: true,
    anchorUtcMs: start,
    anchorRealMs: start,
    setInstant: (utcMs, now = Date.now()) =>
      set((s) => (Number.isFinite(utcMs) ? { utcMs, anchorUtcMs: utcMs, anchorRealMs: now } : s)),
    setNow: (now = Date.now()) => set({ utcMs: now, anchorUtcMs: now, anchorRealMs: now, running: true }),
    pause: () => set({ running: false }),
    resume: (now = Date.now()) => set((s) => ({ running: true, anchorUtcMs: s.utcMs, anchorRealMs: now })),
    tick: (now = Date.now()) =>
      set((s) => {
        if (!s.running || !Number.isFinite(now)) return s
        const utcMs = s.anchorUtcMs + (now - s.anchorRealMs)
        return utcMs === s.utcMs ? s : { utcMs }
      }),
  }
})

/** How often the shell ticks the clock. The menu shows seconds, so once a second. */
export const MISSION_CLOCK_INTERVAL_MS = 1000

/**
 * Starts the ticker. Returns the function that stops it. The shell calls
 * this once on mount; a paused clock still ticks, cheaply, and returns the
 * same state so nothing re-renders.
 */
export function startMissionClock(
  store: { getState: () => { tick: (now: number) => void } } = useMissionTimeStore,
  intervalMs = MISSION_CLOCK_INTERVAL_MS,
  now: () => number = Date.now,
): () => void {
  const timer = setInterval(() => store.getState().tick(now()), intervalMs)
  return () => clearInterval(timer)
}

export interface MissionTime {
  utcMs: number
  /** DERIVED via Mars24, with its method — show that in the UI. */
  solar: Classified<MarsSolarTime>
  running: boolean
  setInstant: (utcMs: number) => void
  setNow: () => void
  pause: () => void
  resume: () => void
}

/**
 * For components: the instant, the sun geometry for it, whether the clock
 * runs, and the actions. The calculation runs once per instant, not once per
 * render — and so once a second while the clock runs.
 *
 * Per-frame 3D code should read useMissionTimeStore.getState() or
 * subscribe, and call marsSolarTime() only when utcMs changes.
 */
export function useMissionTime(): MissionTime {
  const utcMs = useMissionTimeStore((s) => s.utcMs)
  const running = useMissionTimeStore((s) => s.running)
  const solar = useMemo(() => marsSolarTime(utcMs), [utcMs])
  // Store actions never change, so the wrappers are made once.
  const actions = useMemo(() => {
    const s = useMissionTimeStore.getState()
    return {
      setInstant: (ms: number) => s.setInstant(ms),
      setNow: () => s.setNow(),
      pause: () => s.pause(),
      resume: () => s.resume(),
    }
  }, [])
  return { utcMs, solar, running, ...actions }
}
