import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WELCOME_RETURN_DELAY_MS,
  bindViewModeTriggers,
  createHoldCount,
  createWelcomeReturn,
  type HoldCount,
  type InputTarget,
  type TriggerEvent,
} from '../../src/app/viewModeTriggers'
import { ALTITUDE_TOLERANCE_KM, isWholeGlobeView } from '../../src/features/mars-3d/wholeGlobeView'
import {
  LENS_FACTOR,
  MAX_CAMERA_ALTITUDE_KM,
  START_CAMERA_ALTITUDE_KM,
} from '../../src/features/mars-3d/constants'
import { unavailable } from '../../src/domain'
import { useMissionStore } from '../../src/state'

// The whole-globe range: from the start altitude up to the ceiling.
const START = START_CAMERA_ALTITUDE_KM
const CEILING = MAX_CAMERA_ALTITUDE_KM
/** Well inside close-up. */
const CLOSE = START / 2
const DELAY = WELCOME_RETURN_DELAY_MS

describe('isWholeGlobeView', () => {
  it('is the start altitude: 2.2 radii up with the reference lens, scaled by the lens factor', () => {
    expect(START).toBeCloseTo(2.2 * 3389.5 * LENS_FACTOR, 6)
  })

  it('accepts the start altitude, anything within the settle tolerance below it, and up to the ceiling', () => {
    expect(isWholeGlobeView(START)).toBe(true)
    expect(isWholeGlobeView(START - ALTITUDE_TOLERANCE_KM)).toBe(true)
    expect(isWholeGlobeView(12000 * LENS_FACTOR)).toBe(true)
    expect(isWholeGlobeView(CEILING)).toBe(true)
  })

  it('rejects a close-up view and a non-finite altitude', () => {
    expect(isWholeGlobeView(START - ALTITUDE_TOLERANCE_KM - 0.01)).toBe(false)
    expect(isWholeGlobeView(CLOSE)).toBe(false)
    expect(isWholeGlobeView(200)).toBe(false)
    expect(isWholeGlobeView(Number.NaN)).toBe(false)
    expect(isWholeGlobeView(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('takes another threshold', () => {
    expect(isWholeGlobeView(99.5, 100)).toBe(true)
    expect(isWholeGlobeView(98, 100)).toBe(false)
  })
})

describe('createWelcomeReturn', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const onReturn = vi.fn()
    const wait = createWelcomeReturn(onReturn, DELAY)
    return { onReturn, wait }
  }

  it('returns ten seconds after a whole-globe view', () => {
    const { onReturn, wait } = setup()
    wait.view(CLOSE)
    wait.view(CEILING)
    vi.advanceTimersByTime(DELAY - 1)
    expect(onReturn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('arms on the very first view when it shows the whole globe', () => {
    const { onReturn, wait } = setup()
    wait.view(START)
    vi.advanceTimersByTime(DELAY)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('a later whole-globe view (a drag or zoom settling) restarts the wait', () => {
    const { onReturn, wait } = setup()
    wait.view(START)
    vi.advanceTimersByTime(DELAY - 1)
    wait.view(START + 500)
    vi.advanceTimersByTime(DELAY - 1)
    expect(onReturn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('restarts the wait on input', () => {
    const { onReturn, wait } = setup()
    wait.view(CLOSE)
    wait.view(CEILING)
    vi.advanceTimersByTime(DELAY - 1)
    wait.input()
    vi.advanceTimersByTime(DELAY - 1)
    expect(onReturn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('ignores input while nothing is armed', () => {
    const { onReturn, wait } = setup()
    wait.view(CLOSE)
    wait.input()
    vi.advanceTimersByTime(DELAY)
    expect(onReturn).not.toHaveBeenCalled()
  })

  it('cancels when the camera comes back into close-up', () => {
    const { onReturn, wait } = setup()
    wait.view(CLOSE)
    wait.view(CEILING)
    vi.advanceTimersByTime(DELAY / 2)
    wait.view(CLOSE)
    vi.advanceTimersByTime(DELAY)
    expect(onReturn).not.toHaveBeenCalled()
  })

  it('reset and dispose cancel a running wait', () => {
    const a = setup()
    a.wait.view(CLOSE)
    a.wait.view(CEILING)
    a.wait.reset()
    const b = setup()
    b.wait.view(CLOSE)
    b.wait.view(CEILING)
    b.wait.dispose()
    vi.advanceTimersByTime(DELAY)
    expect(a.onReturn).not.toHaveBeenCalled()
    expect(b.onReturn).not.toHaveBeenCalled()
  })

  it('fires once per whole-globe view, not again on input afterwards', () => {
    const { onReturn, wait } = setup()
    wait.view(CLOSE)
    wait.view(CEILING)
    vi.advanceTimersByTime(DELAY * 3)
    wait.input()
    vi.advanceTimersByTime(DELAY)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })
})

describe('createHoldCount', () => {
  it('is held until every hold is released, and tells listeners once, on the last', () => {
    const holds = createHoldCount()
    const listener = vi.fn()
    holds.onRelease(listener)
    const a = holds.hold()
    const b = holds.hold()
    expect(holds.held()).toBe(true)
    a()
    expect(holds.held()).toBe(true)
    expect(listener).not.toHaveBeenCalled()
    b()
    expect(holds.held()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('counts a release once, however often it is called', () => {
    const holds = createHoldCount()
    const a = holds.hold()
    const b = holds.hold()
    a()
    a()
    expect(holds.held()).toBe(true)
    b()
    expect(holds.held()).toBe(false)
  })

  it('stops telling a listener after it unsubscribes', () => {
    const holds = createHoldCount()
    const listener = vi.fn()
    holds.onRelease(listener)()
    holds.hold()()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('createWelcomeReturn while held', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const holds = createHoldCount()
    const onReturn = vi.fn()
    const wait = createWelcomeReturn(onReturn, DELAY, isWholeGlobeView, holds)
    return { holds, onReturn, wait }
  }

  it('does not return while held, however long; the release restarts a full wait', () => {
    const { holds, onReturn, wait } = setup()
    const release = holds.hold()
    wait.view(START)
    vi.advanceTimersByTime(DELAY * 3)
    expect(onReturn).not.toHaveBeenCalled()
    release()
    vi.advanceTimersByTime(DELAY - 1)
    expect(onReturn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('a release while a wait is still running restarts it in full', () => {
    const { holds, onReturn, wait } = setup()
    const release = holds.hold()
    wait.view(START)
    vi.advanceTimersByTime(DELAY - 1)
    release()
    vi.advanceTimersByTime(DELAY - 1)
    expect(onReturn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('waits for the last of two holds', () => {
    const { holds, onReturn, wait } = setup()
    const a = holds.hold()
    const b = holds.hold()
    wait.view(START)
    vi.advanceTimersByTime(DELAY)
    a()
    vi.advanceTimersByTime(DELAY * 2)
    expect(onReturn).not.toHaveBeenCalled()
    b()
    vi.advanceTimersByTime(DELAY)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('a release with no wait pending starts nothing', () => {
    const { holds, onReturn, wait } = setup()
    const release = holds.hold()
    wait.view(CLOSE)
    release()
    vi.advanceTimersByTime(DELAY)
    expect(onReturn).not.toHaveBeenCalled()
  })

  it('a close-up view or a reset drops a pending wait', () => {
    for (const drop of [(w: ReturnType<typeof setup>['wait']) => w.view(CLOSE), (w: ReturnType<typeof setup>['wait']) => w.reset()]) {
      const { holds, onReturn, wait } = setup()
      const release = holds.hold()
      wait.view(START)
      vi.advanceTimersByTime(DELAY)
      drop(wait)
      release()
      vi.advanceTimersByTime(DELAY)
      expect(onReturn).not.toHaveBeenCalled()
    }
  })

  it('after dispose, a release no longer restarts it', () => {
    const { holds, onReturn, wait } = setup()
    const release = holds.hold()
    wait.view(START)
    vi.advanceTimersByTime(DELAY)
    wait.dispose()
    release()
    vi.advanceTimersByTime(DELAY)
    expect(onReturn).not.toHaveBeenCalled()
  })
})

/**
 * A window stand-in: listeners by event type, fired by hand with a target
 * of 'scene', 'panel' or 'keeper' (an element marked data-keeps-welcome).
 * The predicates below read that string, since there is no DOM here.
 */
function fakeTarget() {
  type Listener = (event: TriggerEvent) => void
  const listeners = new Map<string, Set<Listener>>()
  const target: InputTarget = {
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn)
    },
  }
  const fire = (type: string, on: 'scene' | 'panel' | 'keeper' = 'scene') =>
    listeners.get(type)?.forEach((fn) => fn({ target: on }))
  const count = () => [...listeners.values()].reduce((n, s) => n + s.size, 0)
  return { target, fire, count }
}
const onScene = (event: TriggerEvent) => event.target === 'scene'
const onKeeper = (event: TriggerEvent) => event.target === 'keeper'

describe('bindViewModeTriggers', () => {
  const store = useMissionStore
  const view = (altitudeKm: number) => ({
    altitudeKm,
    target: { latitude: 0, longitudeEast: 0 },
    headingDeg: unavailable<number>('not under test'),
  })
  let unbind: () => void
  let input: ReturnType<typeof fakeTarget>
  let holds: HoldCount

  beforeEach(() => {
    vi.useFakeTimers()
    store.setState({ viewMode: 'welcome', introDismissed: false, camera: null, activeRoute: null })
    input = fakeTarget()
    holds = createHoldCount()
    unbind = bindViewModeTriggers(store, input.target, DELAY, onScene, onKeeper, holds)
  })
  afterEach(() => {
    unbind()
    vi.useRealTimers()
  })

  it('a pointer-down anywhere leaves welcome', () => {
    input.fire('pointerdown')
    expect(store.getState().viewMode).toBe('close-up')
  })

  it('a wheel over the scene leaves welcome', () => {
    input.fire('wheel', 'scene')
    expect(store.getState().viewMode).toBe('close-up')
  })

  it('a wheel over a panel scrolls it and does not leave welcome', () => {
    input.fire('wheel', 'panel')
    expect(store.getState().viewMode).toBe('welcome')
  })

  it('a pointer-down over a panel still leaves welcome: click anywhere', () => {
    input.fire('pointerdown', 'panel')
    expect(store.getState().viewMode).toBe('close-up')
  })

  it('a pointer-down on an element that leaves welcome itself does not, so its click lands', () => {
    input.fire('pointerdown', 'keeper')
    expect(store.getState().viewMode).toBe('welcome')
  })

  it('out of welcome, a pointer-down on such an element still counts as input', () => {
    input.fire('pointerdown')
    store.getState().setCameraView(view(START))
    vi.advanceTimersByTime(DELAY - 1)
    input.fire('pointerdown', 'keeper')
    vi.advanceTimersByTime(DELAY - 1)
    expect(store.getState().viewMode).toBe('close-up')
    vi.advanceTimersByTime(1)
    expect(store.getState().viewMode).toBe('welcome')
  })

  it('a twenty-second plan with no input does not bring welcome back; ten idle seconds after it do', () => {
    input.fire('pointerdown')
    store.getState().setCameraView(view(START))
    const release = holds.hold()
    vi.advanceTimersByTime(DELAY * 2)
    expect(store.getState().viewMode).toBe('close-up')
    release()
    vi.advanceTimersByTime(DELAY - 1)
    expect(store.getState().viewMode).toBe('close-up')
    vi.advanceTimersByTime(1)
    expect(store.getState().viewMode).toBe('welcome')
  })

  it('a key press does not leave welcome', () => {
    input.fire('keydown')
    expect(store.getState().viewMode).toBe('welcome')
  })

  it('zooming in no longer leaves welcome on its own', () => {
    store.getState().setCameraView(view(1500))
    expect(store.getState().viewMode).toBe('welcome')
  })

  it('returns to welcome ten seconds after a zoom-out to the start altitude, intro back', () => {
    input.fire('pointerdown')
    store.getState().dismissIntro()
    store.getState().setCameraView(view(CLOSE))
    store.getState().setCameraView(view(START))
    vi.advanceTimersByTime(DELAY - 1)
    expect(store.getState().viewMode).toBe('close-up')
    vi.advanceTimersByTime(1)
    expect(store.getState().viewMode).toBe('welcome')
    expect(store.getState().introDismissed).toBe(false)
  })

  it('any input during the wait restarts it', () => {
    input.fire('pointerdown')
    store.getState().setCameraView(view(CLOSE))
    store.getState().setCameraView(view(CEILING))
    // A wheel over a panel counts as activity too, once out of welcome.
    for (const [type, on] of [['keydown', 'scene'], ['wheel', 'panel'], ['pointerdown', 'scene']] as const) {
      vi.advanceTimersByTime(DELAY - 1)
      input.fire(type, on)
    }
    vi.advanceTimersByTime(DELAY - 1)
    expect(store.getState().viewMode).toBe('close-up')
    vi.advanceTimersByTime(1)
    expect(store.getState().viewMode).toBe('welcome')
  })

  it('a click that leaves welcome, then ten idle seconds, brings welcome back', () => {
    store.setState({ camera: view(START) })
    input.fire('pointerdown')
    // The controller re-reports the settled view on a mode change.
    store.getState().setCameraView(view(START))
    vi.advanceTimersByTime(DELAY - 1)
    expect(store.getState().viewMode).toBe('close-up')
    vi.advanceTimersByTime(1)
    expect(store.getState().viewMode).toBe('welcome')
  })

  it('zooming out from the start altitude, then ten idle seconds, brings welcome back', () => {
    store.setState({ camera: view(START) })
    input.fire('pointerdown')
    store.getState().setCameraView(view(START))
    input.fire('wheel')
    store.getState().setCameraView(view(CEILING))
    vi.advanceTimersByTime(DELAY - 1)
    expect(store.getState().viewMode).toBe('close-up')
    vi.advanceTimersByTime(1)
    expect(store.getState().viewMode).toBe('welcome')
  })

  it('zooming back in cancels the wait', () => {
    input.fire('pointerdown')
    store.getState().setCameraView(view(CLOSE))
    store.getState().setCameraView(view(CEILING))
    vi.advanceTimersByTime(DELAY / 2)
    store.getState().setCameraView(view(CLOSE))
    vi.advanceTimersByTime(DELAY)
    expect(store.getState().viewMode).toBe('close-up')
  })

  it('never returns to welcome from navigation, even with the whole globe in view', () => {
    input.fire('pointerdown')
    store.getState().setCameraView(view(CLOSE))
    store.setState({ viewMode: 'navigation' })
    store.getState().setCameraView(view(CEILING))
    vi.advanceTimersByTime(DELAY)
    expect(store.getState().viewMode).toBe('navigation')
  })

  it('a wait is dropped when navigation starts, and does not resume on End navigation', () => {
    input.fire('pointerdown')
    store.getState().setCameraView(view(CLOSE))
    store.getState().setCameraView(view(CEILING))
    store.setState({ viewMode: 'navigation' })
    store.setState({ viewMode: 'close-up' })
    vi.advanceTimersByTime(DELAY)
    expect(store.getState().viewMode).toBe('close-up')
  })

  it('teardown removes every listener and cancels the wait', () => {
    input.fire('pointerdown')
    store.getState().setCameraView(view(CLOSE))
    store.getState().setCameraView(view(CEILING))
    unbind()
    expect(input.count()).toBe(0)
    vi.advanceTimersByTime(DELAY)
    expect(store.getState().viewMode).toBe('close-up')
    unbind = () => {}
  })
})
