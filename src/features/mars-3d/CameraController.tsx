import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type RefObject } from 'react'
import { PerspectiveCamera, Quaternion, Raycaster, Sphere, Vector2, Vector3, type Mesh } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { MarsCoordinate } from '../../domain'
import { toolTakesClicks, useMissionStore, type CameraView, type ViewMode } from '../../state'
import {
  clampPolar,
  easeStep,
  isPinch,
  nearForAltitude,
  northHeading,
  rotateSpeedForAltitude,
  towardCursorFraction,
  wheelZoomFactor,
  zoomAltitude,
} from './cameraMath'
import {
  GLOBE_RADIUS,
  KM_PER_SCENE_UNIT,
  LENS_FACTOR,
  MAX_CAMERA_ALTITUDE_KM,
  MIN_CAMERA_ALTITUDE_KM,
} from './constants'
import { PICK_RADIUS } from './overlayLift'
import { coordinateToLocalPoint, localPointToCoordinate } from './projection'
import {
  createNorthUpRollScratch,
  createSpinRestart,
  NORTH_UP_SNAP_RAD,
  northUpRollStep,
} from './spinMath'

const LIMITS = {
  min: MIN_CAMERA_ALTITUDE_KM / KM_PER_SCENE_UNIT,
  max: MAX_CAMERA_ALTITUDE_KM / KM_PER_SCENE_UNIT,
}
/** Altitude multiplier for a double-click or a zoom-in button press. */
const ZOOM_STEP = 0.5
/** Matches OrbitControls' polar limits, so animations never aim past them. */
const POLE_MARGIN_RAD = 0.01
const EASE_RATE_PER_S = 8
const DISTANCE_EPSILON = 1e-4
const ANGLE_EPSILON_RAD = 1e-4
/**
 * Pointer travel while pressed that makes the press a drag: a click
 * on a touchpad moves a pixel or two, and must keep the flight it asked
 * for. The measure tool reads a click the same way (MEASURE_CLICK_MAX_PX).
 */
const DRAG_START_PX = 4
/** WheelEvent.deltaMode 1 and 2 report lines and pages, not pixels. */
const PIXELS_PER_LINE = 16
const PIXELS_PER_PAGE = 400

/**
 * Scratch objects and animation goal, created once per mount so neither
 * the frame loop nor the input handlers allocate.
 */
function createRig() {
  return {
    goalDistance: 0,
    goalDir: new Vector3(),
    hasGoalDir: false,
    dragging: false,
    /** False while an animation runs; the view is published once it settles. */
    settled: true,
    dir: new Vector3(),
    tmp: new Vector3(),
    swing: new Quaternion(),
    partial: new Quaternion(),
    ndc: new Vector2(),
    raycaster: new Raycaster(),
    sphere: new Sphere(new Vector3(), PICK_RADIUS),
    /** The globe's north axis and the camera's screen axes, in world space. */
    north: new Vector3(),
    screenUp: new Vector3(),
    screenRight: new Vector3(),
    /**
     * The spin is easing north-up; the view is reported again once
     * north is screen-up, so the compass does not keep the tilted heading.
     */
    awaitingNorthUp: true,
    /** The compass dial's "turn north up" is running; a drag stops it. */
    rolling: false,
    rollDir: new Vector3(),
    rollScratch: createNorthUpRollScratch(),
  }
}

type Rig = ReturnType<typeof createRig>


interface CameraControllerProps {
  /** The globe mesh, for converting the view centre to surface coordinates. */
  globe: RefObject<Mesh | null>
  /**
   * The demo spin runs while this is true. Cleared on the first
   * interaction, set again when the app re-enters `welcome`, or after
   * thirty idle seconds at a whole-globe view in welcome or close-up.
   */
  autoRotate: RefObject<boolean>
  onViewChange?: (view: CameraView) => void
}

/**
 * Camera controls: drag to rotate, wheel towards the cursor,
 * double-click to zoom in, and the store's zoom and centre requests.
 *
 * OrbitControls handles dragging only. Zoom and centring set a goal that
 * the frame loop eases towards, so all three compose. The camera always
 * looks at the globe centre.
 *
 * It also decides when the demo spin restarts: see createSpinRestart.
 *
 * Disposal: OrbitControls, every DOM listener and the restart timer are
 * removed in the effect cleanup. Nothing is allocated per frame or per
 * input event.
 */
export function CameraController({ globe, autoRotate, onViewChange }: CameraControllerProps) {
  const camera = useThree((s) => s.camera)
  const domElement = useThree((s) => s.gl.domElement)
  // A ref, not state: the rig is mutated every frame and never rendered.
  const rigRef = useRef<Rig | null>(null)
  if (rigRef.current === null) rigRef.current = createRig()
  const controlsRef = useRef<OrbitControls | null>(null)
  const onViewChangeRef = useRef(onViewChange)
  // Set by the effect: reports a settled view to the restart wait.
  const restartViewRef = useRef<((altitudeKm: number) => void) | null>(null)

  useEffect(() => {
    onViewChangeRef.current = onViewChange
  }, [onViewChange])

  useEffect(() => {
    const rig = rigRef.current
    if (!rig) return
    const R = GLOBE_RADIUS
    const controls = new OrbitControls(camera, domElement)
    controls.enableZoom = false
    controls.enablePan = false
    controls.minPolarAngle = POLE_MARGIN_RAD
    controls.maxPolarAngle = Math.PI - POLE_MARGIN_RAD
    controls.rotateSpeed = rotateSpeedForAltitude(camera.position.length() - R, R, LENS_FACTOR)
    controlsRef.current = controls
    rig.goalDistance = camera.position.length()
    rig.hasGoalDir = false
    // Report the starting view once the first frame has rendered.
    rig.settled = false

    rig.awaitingNorthUp = autoRotate.current

    const interact = () => {
      autoRotate.current = false
    }
    const startSpin = () => {
      autoRotate.current = true
      rig.awaitingNorthUp = true
      restart.reset()
    }
    const restart = createSpinRestart(startSpin)
    // Only welcome and close-up spin: navigation shows a route, and the
    // surface view covers the globe.
    const spinsIn = (mode: ViewMode) => mode === 'welcome' || mode === 'close-up'
    restartViewRef.current = (altitudeKm) => {
      if (autoRotate.current || !spinsIn(useMissionStore.getState().viewMode)) restart.reset()
      else restart.view(altitudeKm)
    }
    // Any input anywhere restarts the wait, as for the welcome return;
    // capture phase, so no panel can swallow it.
    const onAnyInput = () => restart.input()
    const capture: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener('pointerdown', onAnyInput, capture)
    window.addEventListener('wheel', onAnyInput, capture)
    window.addEventListener('keydown', onAnyInput, capture)

    const startSwing = (towards: Vector3, fraction: number) => {
      // Stack on an unfinished swing rather than restart from the camera.
      if (rig.hasGoalDir) rig.dir.copy(rig.goalDir)
      else rig.dir.copy(camera.position).normalize()
      rig.swing.setFromUnitVectors(rig.dir, towards)
      rig.partial.identity().slerp(rig.swing, fraction)
      rig.goalDir.copy(rig.dir).applyQuaternion(rig.partial)
      clampPolar(rig.goalDir, POLE_MARGIN_RAD)
      rig.hasGoalDir = true
    }

    /** Zooms by `factor`; with a pointer, swings towards the point under it. */
    const zoomBy = (factor: number, clientX?: number, clientY?: number) => {
      interact()
      const from = rig.goalDistance - R
      const to = zoomAltitude(from, factor, LIMITS)
      rig.goalDistance = R + to
      rig.settled = false
      if (clientX === undefined || clientY === undefined) return
      // Mid-drag the pointer already steers the view; a swing would fight it.
      if (rig.dragging) return
      const fraction = towardCursorFraction(from, to)
      if (fraction <= 0) return
      const rect = domElement.getBoundingClientRect()
      rig.ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      rig.raycaster.setFromCamera(rig.ndc, camera)
      // Off the globe (empty sky): zoom straight in.
      if (!rig.raycaster.ray.intersectSphere(rig.sphere, rig.tmp)) return
      startSwing(rig.tmp.normalize(), fraction)
    }

    const centerOn = (target: MarsCoordinate, altitudeKm?: number) => {
      const mesh = globe.current
      if (!mesh) return
      interact()
      mesh.localToWorld(coordinateToLocalPoint(target, R, rig.tmp))
      startSwing(rig.tmp.normalize(), 1)
      // A framing request also sets the height, inside the limits.
      if (altitudeKm !== undefined && Number.isFinite(altitudeKm)) {
        rig.goalDistance = R + zoomAltitude(altitudeKm / KM_PER_SCENE_UNIT, 1, LIMITS)
      }
      rig.settled = false
    }

    const onStart = () => {
      interact()
      rig.dragging = true
      // Turning the view yourself ends a "north up" turn.
      rig.rolling = false
    }
    const onEnd = () => {
      rig.dragging = false
      rig.settled = false
    }
    // A drag takes over from any unfinished centring swing: pointer travel
    // past DRAG_START_PX while the button is down, not the press itself, so
    // a press on the globe during a "Go to" flight lets the
    // flight finish; only moving the pointer takes over.
    let pressX = 0
    let pressY = 0
    const onPointerDown = (e: PointerEvent) => {
      pressX = e.clientX
      pressY = e.clientY
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!rig.dragging || !rig.hasGoalDir) return
      if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > DRAG_START_PX) rig.hasGoalDir = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const scale =
        e.deltaMode === 1 ? PIXELS_PER_LINE : e.deltaMode === 2 ? PIXELS_PER_PAGE : 1
      // Chrome, Edge and Firefox report a touchpad pinch as a ctrlKey wheel event.
      const pinch = isPinch(e.ctrlKey, e.deltaMode, e.deltaY)
      zoomBy(wheelZoomFactor(e.deltaY * scale, pinch), e.clientX, e.clientY)
    }
    const onDoubleClick = (e: MouseEvent) => {
      e.preventDefault()
      // While a tool takes clicks (Measure, the profile tools), a
      // double-click is not a zoom, so it cannot move the view under the first click's point.
      if (toolTakesClicks(useMissionStore.getState().activeToolId)) return
      zoomBy(ZOOM_STEP, e.clientX, e.clientY)
    }

    controls.addEventListener('start', onStart)
    controls.addEventListener('end', onEnd)
    domElement.addEventListener('wheel', onWheel, { passive: false })
    domElement.addEventListener('dblclick', onDoubleClick)
    domElement.addEventListener('pointerdown', onPointerDown, { passive: true })
    domElement.addEventListener('pointermove', onPointerMove, { passive: true })

    // One-shot requests: start from the current ids so a
    // request made before the scene mounted does not replay.
    const initial = useMissionStore.getState()
    let lastZoomId = initial.zoomRequest?.id ?? 0
    let lastCenterId = initial.centerRequest?.id ?? 0
    let lastNorthUpId = initial.northUpRequest?.id ?? 0
    const unsubscribe = useMissionStore.subscribe((s, prev) => {
      if (s.northUpRequest && s.northUpRequest.id !== lastNorthUpId) {
        lastNorthUpId = s.northUpRequest.id
        rig.rolling = true
        rig.settled = false
      }
      if (s.zoomRequest && s.zoomRequest.id !== lastZoomId) {
        lastZoomId = s.zoomRequest.id
        zoomBy(s.zoomRequest.direction === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP)
      }
      if (s.centerRequest && s.centerRequest.id !== lastCenterId) {
        lastCenterId = s.centerRequest.id
        centerOn(s.centerRequest.target, s.centerRequest.altitudeKm)
      }
      if (s.viewMode !== prev.viewMode) {
        if (s.viewMode === 'welcome') startSpin()
        else if (!spinsIn(s.viewMode)) restart.reset()
        // Report the view again, so whatever reads the settled view (the
        // scale bar, the shell's welcome-return wait) starts the new
        // mode from a known camera.
        rig.settled = false
      }
    })

    return () => {
      unsubscribe()
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('end', onEnd)
      domElement.removeEventListener('wheel', onWheel)
      domElement.removeEventListener('dblclick', onDoubleClick)
      domElement.removeEventListener('pointerdown', onPointerDown)
      domElement.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onAnyInput, capture)
      window.removeEventListener('wheel', onAnyInput, capture)
      window.removeEventListener('keydown', onAnyInput, capture)
      restart.dispose()
      restartViewRef.current = null
      controls.dispose()
      controlsRef.current = null
    }
  }, [camera, domElement, globe, autoRotate])

  useFrame((state, delta) => {
    const controls = controlsRef.current
    const rig = rigRef.current
    if (!controls || !rig) return
    const R = GLOBE_RADIUS
    const pos = camera.position
    const step = easeStep(delta, EASE_RATE_PER_S)
    let distance = pos.length()
    let moving = false
    // The compass dial's "turn north up": the tilt group (the globe
    // mesh's parent, at the scene root) turns about the view line, so the
    // view centre stays put. It runs alongside a zoom or a swing.
    if (rig.rolling) {
      const mesh = globe.current
      const tilt = mesh?.parent
      if (!mesh || !tilt) rig.rolling = false
      else {
        rig.rollDir.copy(pos).normalize()
        rig.screenUp.setFromMatrixColumn(camera.matrixWorld, 1)
        rig.screenRight.setFromMatrixColumn(camera.matrixWorld, 0)
        const turn = northUpRollStep(
          tilt.quaternion,
          rig.rollDir,
          rig.screenUp,
          rig.screenRight,
          step,
          rig.rollScratch,
        )
        if (turn !== 'turning') {
          rig.rolling = false
          rig.settled = false
          // The report below reads matrixWorld; bring it up to this frame's turn.
          mesh.updateWorldMatrix(true, false)
        }
      }
    }

    // Within epsilon is arrived. An exact snap to the goal was tried and
    // removed: controls.update() rewrites the position through a
    // spherical round trip, so the length differs from the goal by a few
    // ulps again next frame and the loop never settles, which means the
    // view is never reported.
    if (Math.abs(rig.goalDistance - distance) > DISTANCE_EPSILON) {
      distance += (rig.goalDistance - distance) * step
      moving = true
    }

    rig.dir.copy(pos).divideScalar(pos.length())
    if (rig.hasGoalDir) {
      if (rig.dir.angleTo(rig.goalDir) < ANGLE_EPSILON_RAD) {
        rig.dir.copy(rig.goalDir)
        rig.hasGoalDir = false
      } else {
        rig.swing.setFromUnitVectors(rig.dir, rig.goalDir)
        rig.partial.identity().slerp(rig.swing, step)
        rig.dir.applyQuaternion(rig.partial)
      }
      moving = true
    }

    if (moving) {
      pos.copy(rig.dir).multiplyScalar(distance)
      controls.rotateSpeed = rotateSpeedForAltitude(distance - R, R, LENS_FACTOR)
      // The near plane follows the altitude, so depth stays as precise as before up high.
      // The frame's own camera (the same object), set through the frame state rather than the hook's value.
      const lens = state.camera
      const near = nearForAltitude(distance - R)
      if (lens instanceof PerspectiveCamera && Math.abs(lens.near - near) > near * 0.01) {
        lens.near = near
        lens.updateProjectionMatrix()
      }
      controls.update()
      return
    }

    // Once the spin's ease has brought north to screen-up, report the view
    // again for the compass. The globe's matrixWorld is last frame's,
    // so this lands a frame after the ease ends.
    if (rig.settled && rig.awaitingNorthUp) {
      const mesh = globe.current
      if (!autoRotate.current) rig.awaitingNorthUp = false
      else if (mesh) {
        rig.north.set(0, 1, 0).transformDirection(mesh.matrixWorld)
        rig.screenUp.setFromMatrixColumn(camera.matrixWorld, 1)
        if (rig.north.angleTo(rig.screenUp) < NORTH_UP_SNAP_RAD) {
          rig.awaitingNorthUp = false
          rig.settled = false
        }
      }
    }

    if (!rig.settled && !rig.dragging && !rig.rolling) {
      rig.settled = true
      const mesh = globe.current
      const report = onViewChangeRef.current
      if (!mesh || !report) return
      mesh.worldToLocal(rig.tmp.copy(rig.dir).multiplyScalar(R))
      // North is the mesh's local +y; the demo spin turns about that axis, so
      // the heading holds while the globe keeps spinning under a settled view.
      rig.north.set(0, 1, 0).transformDirection(mesh.matrixWorld)
      rig.screenUp.setFromMatrixColumn(camera.matrixWorld, 1)
      rig.screenRight.setFromMatrixColumn(camera.matrixWorld, 0)
      const altitudeKm = (distance - R) * KM_PER_SCENE_UNIT
      restartViewRef.current?.(altitudeKm)
      report({
        altitudeKm,
        target: localPointToCoordinate(rig.tmp, R),
        headingDeg: northHeading(rig.dir, rig.north, rig.screenUp, rig.screenRight),
      })
    }
  })

  return null
}
