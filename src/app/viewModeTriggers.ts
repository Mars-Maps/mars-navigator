import { useEffect } from 'react'
import { isWholeGlobeView } from '../features/mars-3d/wholeGlobeView'
import { useMissionStore, type MissionState } from '../state'

/**
 * When the mode changes between welcome and close-up.
 *
 *   welcome → close-up   the first pointer-down anywhere on screen, or a
 *                        wheel over the scene (a zoom); a wheel over a panel
 *                        is a scroll and leaves welcome alone
 *   close-up → welcome   the camera arrives at a whole-globe view (the start
 *                        altitude or higher, up to the ceiling) and then
 *                        nothing is touched for ten seconds
 *
 * The altitude on its own never changes the mode: looking at the whole
 * globe is part of working, and the welcome screen must not come back over
 * it. Navigation is not involved; a route enters and leaves it.
 *
 * Two exceptions:
 *   - while the app holds the return (a walk being planned), ten seconds
 *     without input are not idle: the user is waiting on the app
 *   - a pointer-down on an element marked `data-keeps-welcome` does not
 *     leave welcome, so the element's own click still lands; that element
 *     leaves welcome itself (the intro's Go to button, via `goToSite`)
 */
export const WELCOME_RETURN_DELAY_MS = 10_000

/** The attribute that keeps a pointer-down from leaving welcome. */
export const KEEPS_WELCOME_ATTRIBUTE = 'data-keeps-welcome'

/**
 * Holds on the welcome return. Each `hold()` returns its own
 * release, which counts once however often it is called; the return waits
 * until every hold is released.
 */
export interface HoldCount {
  hold(): () => void
  held(): boolean
  /** Called when the last hold is released. Returns the unsubscribe. */
  onRelease(listener: () => void): () => void
}

export function createHoldCount(): HoldCount {
  let holds = 0
  const listeners = new Set<() => void>()
  return {
    hold() {
      holds += 1
      let released = false
      return () => {
        if (released) return
        released = true
        holds -= 1
        if (holds === 0) listeners.forEach((fn) => fn())
      }
    },
    held: () => holds > 0,
    onRelease(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const WELCOME_HOLDS = createHoldCount()

/**
 * Holds the welcome return while the app works for the user, e.g. a walk
 * being planned. Call the returned function when it is done.
 */
export function holdWelcomeReturn(): () => void {
  return WELCOME_HOLDS.hold()
}

export interface WelcomeReturn {
  /** A settled camera view while in close-up. */
  view(altitudeKm: number): void
  /** Any pointer, wheel or key input; restarts a running wait. */
  input(): void
  /** Close-up was left or entered; cancel any wait. */
  reset(): void
  dispose(): void
}

/**
 * The ten-second wait. Every settled whole-globe view in close-up starts
 * it, including the one reported on entering close-up, so a click that
 * leaves welcome and ten idle seconds bring welcome back. A
 * close-up view cancels the wait; any input restarts it. The earlier
 * "arrival" rule, which waited for a close-up view first, left a user who
 * zoomed out from the start altitude with no way back.
 *
 * A wait that runs out while held does not return; it stays pending, and
 * the last release restarts it in full, as input would.
 */
export function createWelcomeReturn(
  onReturn: () => void,
  delayMs = WELCOME_RETURN_DELAY_MS,
  wholeGlobe: (altitudeKm: number) => boolean = isWholeGlobeView,
  holds: HoldCount = WELCOME_HOLDS,
): WelcomeReturn {
  let timer: ReturnType<typeof setTimeout> | null = null
  /** The wait ran out while held. */
  let pending = false

  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = false
  }
  const arm = () => {
    clear()
    timer = setTimeout(() => {
      timer = null
      if (holds.held()) pending = true
      else onReturn()
    }, delayMs)
  }
  const restart = () => {
    if (timer !== null || pending) arm()
  }
  const unsubscribe = holds.onRelease(restart)

  return {
    view(altitudeKm) {
      if (wholeGlobe(altitudeKm)) arm()
      else clear()
    },
    input: restart,
    reset: clear,
    dispose() {
      clear()
      unsubscribe()
    },
  }
}

/** The part of the store the triggers use; a test passes a bare store. */
export type TriggerStore = {
  getState(): Pick<MissionState, 'viewMode' | 'camera' | 'setViewMode'>
  subscribe(listener: (s: MissionState, prev: MissionState) => void): () => void
}

/** What a listener gets: enough of the DOM event to ask where it landed. */
export interface TriggerEvent {
  target: unknown
}

/** `window` in the app; a stub in tests. Capture phase, so no panel can swallow the event. */
export interface InputTarget {
  addEventListener(
    type: string,
    listener: (event: TriggerEvent) => void,
    options: AddEventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: (event: TriggerEvent) => void,
    options: AddEventListenerOptions,
  ): void
}

/**
 * Whether the event landed on the 3D scene, where a wheel zooms the camera.
 * The scene's canvas is the only one in the document; the shell's
 * compositing canvases are never attached. A test passes its own predicate,
 * since the unit environment has no DOM.
 */
export function isSceneEvent(event: TriggerEvent): boolean {
  const t = event.target
  return t instanceof Element && t.closest('canvas') !== null
}

/**
 * Whether the event landed inside an element that leaves welcome itself.
 * Like `isSceneEvent`, a test passes its own predicate.
 */
export function keepsWelcome(event: TriggerEvent): boolean {
  const t = event.target
  return t instanceof Element && t.closest(`[${KEEPS_WELCOME_ATTRIBUTE}]`) !== null
}

/** Wires the triggers to a store and an input target. Returns the teardown. */
export function bindViewModeTriggers(
  store: TriggerStore,
  target: InputTarget,
  delayMs = WELCOME_RETURN_DELAY_MS,
  onScene: (event: TriggerEvent) => boolean = isSceneEvent,
  onKeeper: (event: TriggerEvent) => boolean = keepsWelcome,
  holds: HoldCount = WELCOME_HOLDS,
): () => void {
  const wait = createWelcomeReturn(() => store.getState().setViewMode('welcome'), delayMs, isWholeGlobeView, holds)

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.viewMode !== prev.viewMode) wait.reset()
    if (s.camera !== prev.camera && s.camera && s.viewMode === 'close-up') {
      wait.view(s.camera.altitudeKm)
    }
  })

  // A click anywhere leaves welcome, except on an element that leaves
  // it itself: unmounting it on pointer-down would lose its click. A
  // wheel does so only over the scene: over a panel it scrolls, and the
  // intro panel scrolls at 900 px.
  const leaveWelcome = (event: TriggerEvent, anywhere: boolean) => {
    const s = store.getState()
    if (s.viewMode !== 'welcome') wait.input()
    else if (anywhere ? !onKeeper(event) : onScene(event)) s.setViewMode('close-up')
  }
  const onPointer = (event: TriggerEvent) => leaveWelcome(event, true)
  const onWheel = (event: TriggerEvent) => leaveWelcome(event, false)
  const onKey = () => wait.input()

  const capture: AddEventListenerOptions = { capture: true, passive: true }
  target.addEventListener('pointerdown', onPointer, capture)
  target.addEventListener('wheel', onWheel, capture)
  target.addEventListener('keydown', onKey, capture)

  return () => {
    unsubscribe()
    target.removeEventListener('pointerdown', onPointer, capture)
    target.removeEventListener('wheel', onWheel, capture)
    target.removeEventListener('keydown', onKey, capture)
    wait.dispose()
  }
}

/** Mounted once by the composition root. */
export function useViewModeTriggers(): void {
  useEffect(() => bindViewModeTriggers(useMissionStore, window), [])
}
