import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, type RefObject } from 'react'
import type { MarsCoordinate } from '../../../domain'
import { useWalkPlan } from '../../../state'
import { cumulativeM, pointAlong, stopsPath, walkFrom, type WalkPose } from './walkAlong'

/**
 * Rehearsal pace, metres per second: sped up so a kilometre leg takes about
 * half a minute. A playback speed, never a walking-time estimate.
 */
export const REHEARSAL_SPEED_M_S = 30

/** Keys that move the walker by hand (Ground's), which take over from the walk. */
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC'])

/** What the walk is doing, for the surface view's panel. */
export type WalkStatus =
  | { kind: 'walking'; stopLabel: string; movedToStart: boolean }
  | { kind: 'jumped'; stopLabel: string }
  | null

/**
 * Walks the walker to the stop the plan is heading for, along the
 * planner's leg paths, whenever `useWalkPlan`'s active stop changes while
 * standing (the HUD's Previous / Next stop). Writes the pose into
 * `poseRef` each frame; the ground puts the walker there. A leg with no
 * path moves the walker straight onto the stop instead of drawing a line
 * nobody planned, and a walker off the route is moved onto its start the same
 * way. Any movement key hands control back and ends the walk.
 *
 * Mount inside the surface view's Canvas. Nothing is allocated per frame
 * but the pose; the store subscription and key listener go on unmount.
 */
export function WalkDriver({
  start,
  observerRef,
  poseRef,
  onStatus,
}: {
  /** The spot the ground stands on; a teleport changes it and ends the walk, as a move key does. */
  start: MarsCoordinate
  /** Where the walker stands now, from the ground. */
  observerRef: RefObject<MarsCoordinate | null>
  poseRef: RefObject<WalkPose | null>
  onStatus: (status: WalkStatus) => void
}) {
  const walk = useRef<{
    path: MarsCoordinate[]
    cumulative: Float64Array
    doneM: number
    /** A walk clears its status on arrival; a jump keeps saying it jumped. */
    arrived: 'walked' | 'jumped'
  } | null>(null)
  const statusRef = useRef(onStatus)
  useEffect(() => {
    statusRef.current = onStatus
  })

  useEffect(() => {
    walk.current = null
    poseRef.current = null
    statusRef.current(null)
  }, [start, poseRef])

  useEffect(() => {
    const stop = () => {
      walk.current = null
      poseRef.current = null
      statusRef.current(null)
    }
    const unsubscribe = useWalkPlan.subscribe((s, prev) => {
      if (s.plan !== prev.plan || !s.plan) {
        stop()
        return
      }
      if (s.activeStopIndex === prev.activeStopIndex) return
      const target = s.plan.stops[s.activeStopIndex]
      const here = observerRef.current
      const planned = stopsPath(s.plan, prev.activeStopIndex, s.activeStopIndex)
      if (!planned) {
        // A zero-length walk: the frame loop places the walker on the stop
        // once, in the same order as any other pose.
        walk.current = { path: [target.coordinate], cumulative: new Float64Array(1), doneM: 0, arrived: 'jumped' }
        statusRef.current({ kind: 'jumped', stopLabel: target.label })
        return
      }
      const { path, movedToStart } = walkFrom(here, planned)
      walk.current = { path, cumulative: cumulativeM(path), doneM: 0, arrived: 'walked' }
      statusRef.current({ kind: 'walking', stopLabel: target.label, movedToStart })
    })
    const onKey = (e: KeyboardEvent) => {
      if (MOVE_KEYS.has(e.code)) stop()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unsubscribe()
      window.removeEventListener('keydown', onKey)
      walk.current = null
      poseRef.current = null
    }
  }, [observerRef, poseRef])

  useFrame((_, delta) => {
    const w = walk.current
    if (!w) {
      // The last pose was applied last frame; the walker stays where it is.
      if (poseRef.current) poseRef.current = null
      return
    }
    // Up to a second per frame, not the keys' 0.1 s: the panel states the
    // pace, so a slow machine must not quietly walk slower than it says.
    w.doneM += REHEARSAL_SPEED_M_S * Math.min(delta, 1)
    poseRef.current = pointAlong(w.path, w.cumulative, w.doneM)
    if (w.doneM >= w.cumulative[w.cumulative.length - 1]) {
      walk.current = null
      if (w.arrived === 'walked') statusRef.current(null)
    }
  })

  return null
}
