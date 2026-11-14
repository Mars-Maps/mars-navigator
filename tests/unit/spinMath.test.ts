import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { DEG_TO_RAD, MARS_AXIAL_TILT_DEG, START_CAMERA_ALTITUDE_KM } from '../../src/features/mars-3d/constants'
import { isAvailable } from '../../src/domain'
import { easeStep, northHeading } from '../../src/features/mars-3d/cameraMath'
import {
  createNorthUpRollScratch,
  createNorthUpScratch,
  createSpinRestart,
  NORTH_UP_RATE_PER_S,
  northUpRollStep,
  northUpStep,
  SPIN_RESTART_DELAY_MS,
} from '../../src/features/mars-3d/spinMath'
import { isWholeGlobeView } from '../../src/features/mars-3d/wholeGlobeView'
import { useMissionStore } from '../../src/state'

const UP = new Vector3(0, 1, 0)
const tilted = () => new Quaternion().setFromEuler(new Euler(0, 0, MARS_AXIAL_TILT_DEG * DEG_TO_RAD))
const northOf = (q: Quaternion) => new Vector3(0, 1, 0).applyQuaternion(q)

describe('northUpStep', () => {
  it('eases the published tilt to north-up in under a second at 60 fps', () => {
    const q = tilted()
    const scratch = createNorthUpScratch()
    const dt = 1 / 60
    let frames = 0
    while (!northUpStep(q, UP, easeStep(dt, NORTH_UP_RATE_PER_S), scratch)) frames++
    expect(frames * dt).toBeLessThan(1)
    expect(northOf(q).angleTo(UP)).toBeLessThan(1e-6)
  })

  it('moves towards screen-up every frame, never past it', () => {
    const q = tilted()
    const scratch = createNorthUpScratch()
    let last = northOf(q).angleTo(UP)
    for (let i = 0; i < 10; i++) {
      northUpStep(q, UP, 0.2, scratch)
      const now = northOf(q).angleTo(UP)
      expect(now).toBeLessThan(last)
      last = now
    }
  })

  it('aligns with a screen-up that is not world-up (an orbited camera)', () => {
    const q = tilted()
    const up = new Vector3(0, 1, 1).normalize()
    const scratch = createNorthUpScratch()
    for (let i = 0; i < 200 && !northUpStep(q, up, 0.1, scratch); i++);
    expect(northOf(q).angleTo(up)).toBeLessThan(1e-6)
  })

  it('leaves an aligned globe alone', () => {
    const q = new Quaternion()
    expect(northUpStep(q, UP, 0.5, createNorthUpScratch())).toBe(true)
    expect(q.equals(new Quaternion())).toBe(true)
  })
})

describe('isWholeGlobeView', () => {
  it('counts the start altitude and above, within 1 km', () => {
    expect(isWholeGlobeView(START_CAMERA_ALTITUDE_KM)).toBe(true)
    expect(isWholeGlobeView(START_CAMERA_ALTITUDE_KM - 0.5)).toBe(true)
    expect(isWholeGlobeView(START_CAMERA_ALTITUDE_KM - 50)).toBe(false)
    expect(isWholeGlobeView(Number.NaN)).toBe(false)
  })
})

describe('createSpinRestart', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const wholeGlobe = (km: number) => km >= 7000

  it('restarts after 30 idle seconds at a whole-globe view', () => {
    const onRestart = vi.fn()
    const r = createSpinRestart(onRestart, SPIN_RESTART_DELAY_MS, wholeGlobe)
    r.view(8000)
    vi.advanceTimersByTime(SPIN_RESTART_DELAY_MS - 1)
    expect(onRestart).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onRestart).toHaveBeenCalledOnce()
  })

  it('restarts the wait on input', () => {
    const onRestart = vi.fn()
    const r = createSpinRestart(onRestart, SPIN_RESTART_DELAY_MS, wholeGlobe)
    r.view(8000)
    vi.advanceTimersByTime(20_000)
    r.input()
    vi.advanceTimersByTime(20_000)
    expect(onRestart).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(onRestart).toHaveBeenCalledOnce()
  })

  it('does not arm on input alone or at a close view', () => {
    const onRestart = vi.fn()
    const r = createSpinRestart(onRestart, SPIN_RESTART_DELAY_MS, wholeGlobe)
    r.input()
    r.view(2000)
    vi.advanceTimersByTime(SPIN_RESTART_DELAY_MS * 2)
    expect(onRestart).not.toHaveBeenCalled()
  })

  it('cancels on a close view and on reset', () => {
    const onRestart = vi.fn()
    const r = createSpinRestart(onRestart, SPIN_RESTART_DELAY_MS, wholeGlobe)
    r.view(8000)
    r.view(2000)
    vi.advanceTimersByTime(SPIN_RESTART_DELAY_MS)
    r.view(8000)
    r.reset()
    vi.advanceTimersByTime(SPIN_RESTART_DELAY_MS)
    expect(onRestart).not.toHaveBeenCalled()
  })
})

describe('northUpRollStep, the compass dial\'s "turn north up"', () => {
  // The camera on +z looking at the globe centre: screen-up +y, screen-right +x.
  const VIEW = new Vector3(0, 0, 1)
  const RIGHT = new Vector3(1, 0, 0)
  const headingOf = (q: Quaternion) => {
    const h = northHeading(VIEW, northOf(q), UP, RIGHT)
    if (!isAvailable(h)) throw new Error(h.reason)
    return h.value > 180 ? h.value - 360 : h.value
  }
  /** The globe's own point under the view centre. */
  const centreOf = (q: Quaternion) => VIEW.clone().applyQuaternion(q.clone().invert())
  // A tilt that also leans the pole towards the viewer, so the view centre is off the equator.
  const leaning = (zDeg: number) =>
    new Quaternion().setFromEuler(new Euler(0.4, 0, zDeg * DEG_TO_RAD))

  it.each([MARS_AXIAL_TILT_DEG, -120, 170])(
    'turns a %s° tilt to north up in about a second, keeping the view centre on the same point',
    (zDeg) => {
      const q = leaning(zDeg)
      const centre = centreOf(q)
      expect(Math.abs(headingOf(q))).toBeGreaterThan(1)
      const scratch = createNorthUpRollScratch()
      const dt = 1 / 60
      let frames = 0
      while (northUpRollStep(q, VIEW, UP, RIGHT, easeStep(dt, 8), scratch) === 'turning') frames++
      // The camera's own ease (8/s, as a zoom or a Go to): a half turn takes about a second.
      expect(frames * dt).toBeLessThan(1.2)
      expect(Math.abs(headingOf(q))).toBeLessThan(1e-6)
      expect(centreOf(q).distanceTo(centre)).toBeLessThan(1e-9)
    },
  )

  it('takes the shorter way round, closer every frame', () => {
    const q = leaning(-120)
    const scratch = createNorthUpRollScratch()
    let last = Math.abs(headingOf(q))
    for (let i = 0; i < 10; i++) {
      northUpRollStep(q, VIEW, UP, RIGHT, 0.2, scratch)
      const now = Math.abs(headingOf(q))
      expect(now).toBeLessThan(last)
      last = now
    }
  })

  it('is done at once when north is already up, and leaves the globe alone', () => {
    const q = new Quaternion()
    expect(northUpRollStep(q, VIEW, UP, RIGHT, 0.2, createNorthUpRollScratch())).toBe('done')
    expect(q.equals(new Quaternion())).toBe(true)
  })

  it('stops, unavailable, over a pole, where north has no direction', () => {
    const q = new Quaternion()
    // Looking straight down the axis from above the north pole.
    const result = northUpRollStep(
      q,
      new Vector3(0, 1, 0),
      new Vector3(0, 0, -1),
      RIGHT,
      0.2,
      createNorthUpRollScratch(),
    )
    expect(result).toBe('unavailable')
    expect(q.equals(new Quaternion())).toBe(true)
  })
})

describe('requestNorthUp', () => {
  it('counts each click, so a second click turns the view again', () => {
    const before = useMissionStore.getState().northUpRequest?.id ?? 0
    useMissionStore.getState().requestNorthUp()
    useMissionStore.getState().requestNorthUp()
    expect(useMissionStore.getState().northUpRequest?.id).toBe(before + 2)
  })
})
