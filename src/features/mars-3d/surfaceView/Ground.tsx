import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { DataTexture, PerspectiveCamera, Vector2 } from 'three'
import { formatMarsCoordinate, type MarsCoordinate } from '../../../domain'
import { useMissionStore, useSurfaceHeading } from '../../../state'
import type { GroundImagery, SurfaceDetail } from '../surfaceDetail'
import type { SurfaceElevation } from '../surfaceElevation'
import { buildGroundPatch, type GroundPatch, type HeightProvenance } from './groundPatch'
import { generateGroundDetail, DETAIL_PX } from './groundDetail'
import { readyStatus, withLoaded, type GroundImageryStatus, type GroundStatus } from './groundStatus'
import { generateGrain } from './groundGrain'
import { groundShader } from './groundMaterial'
import { GroundRoute } from './GroundRoute'
import { Rocks } from './Rocks'
import { sampleHeight } from './heightfield'
import { patchBounds, type MapPicture } from './overheadMapView'
import { anchorPosition } from './rockLayout'
import {
  clampAltitude,
  clampEye,
  EYE_HEIGHT_M,
  moveStep,
  scaledAbove,
  speedFor,
  type Move,
  type MoveKeys,
  type MoveMode,
} from './moveMath'
import { groundPointToCoordinate, isPolarBox, makeFrame, PATCH_HALF_KM, PATCH_SIZE_KM, toCoordinate, toPatch } from './surfacePatch'
import { tilingTexture } from './tilingTexture'
import { useNearField } from './useNearField'
import { applyWalkPose, type WalkPose } from './walkAlong'
import { northOnPatch, screenHeadingDeg, walkerHeading, walkerPosition } from './walkerHeading'

/** Past this distance from the patch centre, the next patch is built around the walker. */
const RECENTRE_M = 6000
/** The walker stops this far inside the edge if the next patch is not ready. */
const EDGE_MARGIN_M = 300
/** After a failed build, wait this long before asking again. */
const RETRY_MS = 5000
const LOOK_RAD_PER_PX = 0.003
const MAX_PITCH_RAD = 1.45
const READOUT_MS = 250
/** The compass heading is written at most this often, and only when its whole degree changes. */
const HEADING_MS = 50
/** Field of view, degrees: normal, and zoomed like binoculars (Z). */
const FOV_DEG = 70
const ZOOM_FOV_DEG = 5

/** One grain tile covers this many metres of ground. */
const GRAIN_TILE_M = 24
const GRAIN_PX = 256
const GRAIN_BUMP = 1.5

interface Sources {
  elevation: SurfaceElevation
  detail: SurfaceDetail | null
  /** Finer brightness composed over the layer's colour, coarsest first; empty for none. */
  groundImagery: readonly GroundImagery[]
  globeImage: HTMLCanvasElement | null
}

/**
 * The ground under the walker and the walking itself. Shows one patch at a
 * time, centred where it was built. Once the walker is RECENTRE_M from that
 * centre, the next patch is built around them in the background and swapped
 * in; the walker's place and heading carry over through surface
 * coordinates, and since heights and imagery are functions of the place on
 * Mars, the new patch matches the old one where they overlap.
 *
 * Position and look live in a ref and the frame loop allocates nothing
 * except the position readout, a few times a second, and the compass
 * heading when its whole degree changes. Walking rides the
 * terrain at `eyeM` above it; flying holds an absolute `altM`, moves
 * where the camera looks, and never dips below the ground. Disposal: each patch is
 * disposed when the next replaces it and on unmount, a build in flight is
 * aborted (and disposed if it finishes anyway), the grain texture is
 * disposed on unmount, and every listener is removed.
 */
export function Ground({
  start,
  sources,
  onStatus,
  onNearStatus,
  mode,
  onToggleModeRef,
  readoutRef,
  pictureRef,
  observerRef,
  yawRef,
  walkPoseRef,
  traverse,
}: {
  start: MarsCoordinate
  sources: Sources
  onStatus: (status: GroundStatus) => void
  /** The near-field image's tiles; null where there is none. */
  onNearStatus: (status: GroundImageryStatus | null) => void
  /** Walk or fly; the F key asks the owner to flip it through `onToggleModeRef`. */
  mode: MoveMode
  onToggleModeRef: RefObject<() => void>
  readoutRef: RefObject<HTMLSpanElement | null>
  /** The patch's picture and where it lies, for the overhead map; updated with the readout. */
  pictureRef: RefObject<MapPicture | null>
  /** Where the walker stands, for the sky; updated a few times a second. */
  observerRef: RefObject<MarsCoordinate | null>
  /** Where they look, 0 north, clockwise, for the expanded map; updated with `observerRef`. */
  yawRef: RefObject<number>
  /** Set while the walk driver moves the walker along the plan; it wins over the keys. */
  walkPoseRef: RefObject<WalkPose | null>
  /** The rover's driven path, draped beside the plan. */
  traverse?: readonly MarsCoordinate[]
}) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const domElement = useThree((s) => s.gl.domElement)
  const [patch, setPatch] = useState<GroundPatch | null>(null)

  // Everything the frame loop and the async builds share, mutated in place.
  const rig = useRef({
    active: null as GroundPatch | null,
    /** The drop point's frame: rocks and ground detail are laid out on it, so a patch swap moves none of them. */
    anchor: makeFrame(start),
    building: null as AbortController | null,
    retryAt: 0,
    /** The first patch threw; retry it, since the walker cannot move yet. */
    startFailed: false,
    readoutAt: 0,
    /** True north at the walker, radians clockwise from the patch's +y; null near a pole. Updated with the readout. */
    northRad: null as number | null,
    /** The heading last written to the compass store; undefined before the first write. */
    headingDeg: undefined as number | null | undefined,
    headingAt: 0,
    provenance: null as HeightProvenance | null,
    ground: [] as GroundImageryStatus[],
    /** Why the next patch could not be built, while the walker waits at the edge. */
    edge: null as string | null,
    xM: 0,
    yM: 0,
    yaw: 0,
    pitch: -0.05,
    /** Walking: the eye above the ground. */
    eyeM: EYE_HEIGHT_M,
    /** Flying: the camera's height in the patch's metres, the same datum as the heights. */
    altM: 0,
    mode: 'walk' as MoveMode,
    /** Wheel turns since the last frame, log scale; applied to the height above ground. */
    wheelLog: 0,
    zoomed: false,
    keys: { forward: false, back: false, left: false, right: false, up: false, down: false, run: false } as MoveKeys,
    step: { dx: 0, dy: 0, dz: 0 } as Move,
    build: null as ((centre: MarsCoordinate) => void) | null,
  })

  /** The current patch centre in the anchor's metres, for the shader (x east, y south); set on each swap. */
  const origin = useMemo(() => new Vector2(), [])
  const latest = useRef({ sources, onStatus })
  useEffect(() => {
    latest.current = { sources, onStatus }
  }, [sources, onStatus])
  // Nobody stands here once the ground is gone: no heading for the compass, no position for the HUD.
  useEffect(() => () => useSurfaceHeading.getState().clear(), [])
  // Nor a place or a picture: after a teleport the old ones must not stand in for the new.
  useEffect(
    () => () => {
      observerRef.current = null
      pictureRef.current = null
    },
    [observerRef, pictureRef],
  )

  // The builder, and the first patch around the drop point.
  useEffect(() => {
    const r = rig.current
    r.build = (centre) => {
      r.building?.abort()
      const controller = new AbortController()
      r.building = controller
      const { sources: s } = latest.current
      const options = { ...s, maxAnisotropy: gl.capabilities.getMaxAnisotropy() }
      void buildGroundPatch(centre, options, controller.signal).then((result) => {
        if (controller.signal.aborted) {
          if (result.status === 'ready') result.patch.dispose()
          return
        }
        r.building = null
        if (result.status === 'ready') {
          r.startFailed = false
          setPatch(result.patch)
        } else if (result.status === 'unavailable') {
          unavailable(result.reason)
        }
      }, (error: unknown) => {
        // A throwing elevation or imagery source must not leave `building`
        // set, or no patch is ever built again. Report it and retry.
        if (controller.signal.aborted) return
        r.building = null
        r.startFailed = !r.active
        unavailable(`the ground could not be built (${error instanceof Error ? error.message : String(error)})`)
      })
    }
    const unavailable = (reason: string) => {
      r.retryAt = performance.now() + RETRY_MS
      if (!r.active) latest.current.onStatus({ kind: 'unavailable', reason })
      else if (r.provenance) {
        r.edge = reason
        latest.current.onStatus(readyStatus(r.provenance, r.ground, r.edge))
      }
    }
    r.build(start)
    return () => {
      r.building?.abort()
      r.building = null
    }
  }, [gl, start])

  // Swap in a new patch before the next frame draws: carry the walker over.
  useLayoutEffect(() => {
    if (!patch) return
    const r = rig.current
    const previous = r.active
    if (previous) {
      const ahead = 100
      const here = toCoordinate(previous.frame, r.xM / 1000, r.yM / 1000)
      const there = toCoordinate(
        previous.frame,
        (r.xM + Math.sin(r.yaw) * ahead) / 1000,
        (r.yM + Math.cos(r.yaw) * ahead) / 1000,
      )
      const p = toPatch(patch.frame, here)
      const q = toPatch(patch.frame, there)
      r.xM = p.xKm * 1000
      r.yM = p.yKm * 1000
      r.yaw = Math.atan2(q.xKm - p.xKm, q.yKm - p.yKm)
    } else {
      r.xM = 0
      r.yM = 0
    }
    r.active = patch
    // The yaw is now in the new patch's frame; recompute north on the next frame too.
    r.readoutAt = 0
    const centre = anchorPosition(r.anchor, patch.frame, 0, 0)
    origin.set(centre.xM, -centre.yM)
    r.provenance = patch.provenance
    r.ground = patch.ground.map(({ imagery, zoom, total }) => ({ imagery, zoom, total, loaded: null }))
    r.edge = null
    latest.current.onStatus(readyStatus(patch.provenance, r.ground, null))
    // The caption learns each mosaic's tile count as soon as its own tiles settle.
    patch.ground.forEach((g, i) => void g.loaded.then((loaded) => {
      if (r.active !== patch) return
      r.ground = withLoaded(r.ground, i, loaded)
      latest.current.onStatus(readyStatus(patch.provenance, r.ground, r.edge))
    }))
    return () => {
      if (r.active === patch) r.active = null
      patch.dispose()
    }
  }, [patch, origin])

  const grain = useMemo(() => {
    const tex = tilingTexture(
      new DataTexture(generateGrain(undefined, GRAIN_PX), GRAIN_PX, GRAIN_PX),
      gl.capabilities.getMaxAnisotropy(),
    )
    const repeats = (PATCH_SIZE_KM * 1000) / GRAIN_TILE_M
    tex.repeat.set(repeats, repeats)
    return tex
  }, [gl])
  useEffect(() => () => grain.dispose(), [grain])

  const detail = useMemo(
    () => tilingTexture(new DataTexture(generateGroundDetail(), DETAIL_PX, DETAIL_PX), gl.capabilities.getMaxAnisotropy()),
    [gl],
  )
  useEffect(() => () => detail.dispose(), [detail])
  const near = useNearField(rig, onNearStatus)
  // One function for the material's lifetime, so its program compiles once.
  const shade = useMemo(() => groundShader(detail, origin, near), [detail, origin, near])

  useWalkInput(rig, domElement, onToggleModeRef)

  // Switching keeps the height above the ground: flying starts at the eye,
  // landing brings the eye to where the flight was, within walking's limits.
  useEffect(() => {
    const r = rig.current
    if (r.mode === mode) return
    // With no patch yet, 0 is a placeholder the first frame replaces by
    // clamping to the real ground; it is never shown or drawn.
    const ground = r.active ? sampleHeight(r.active.field, r.xM, r.yM) : 0
    if (mode === 'fly') r.altM = ground + r.eyeM
    else r.eyeM = clampEye(r.altM - ground)
    r.mode = mode
  }, [mode])

  useFrame((state, delta) => {
    const r = rig.current
    const active = r.active
    if (!active) {
      if (r.startFailed && !r.building && performance.now() >= r.retryAt) r.build?.(start)
      return
    }
    const k = r.keys
    const flying = r.mode === 'fly'
    const ground = sampleHeight(active.field, r.xM, r.yM)
    if (r.wheelLog !== 0) {
      if (flying) r.altM = clampAltitude(ground + scaledAbove(r.altM - ground, r.wheelLog), ground)
      else r.eyeM = clampEye(scaledAbove(r.eyeM, r.wheelLog))
      r.wheelLog = 0
    }
    const above = flying ? r.altM - ground : r.eyeM
    const m = moveStep(r.mode, k, r.yaw, r.pitch, speedFor(above, k.run), Math.min(delta, 0.1), r.step)
    if (m.dx !== 0 || m.dy !== 0 || m.dz !== 0) {
      // Yaw 0 looks north (−z); positive yaw turns right, towards east.
      const limit = PATCH_HALF_KM * 1000 - EDGE_MARGIN_M
      r.xM = Math.max(-limit, Math.min(limit, r.xM + m.dx))
      r.yM = Math.max(-limit, Math.min(limit, r.yM + m.dy))
      r.altM += m.dz
    }
    if (walkPoseRef.current) applyWalkPose(active.frame, walkPoseRef.current, r)

    const now = performance.now()
    if (!r.building && now >= r.retryAt && Math.hypot(r.xM, r.yM) > RECENTRE_M) {
      r.build?.(toCoordinate(active.frame, r.xM / 1000, r.yM / 1000))
    }

    const groundHere = sampleHeight(active.field, r.xM, r.yM)
    if (flying) {
      r.altM = clampAltitude(r.altM, groundHere)
      camera.position.set(r.xM, r.altM, -r.yM)
    } else {
      camera.position.set(r.xM, groundHere + r.eyeM, -r.yM)
    }
    camera.rotation.set(r.pitch, -r.yaw, 0, 'YXZ')

    const fov = r.zoomed ? ZOOM_FOV_DEG : FOV_DEG
    const lens = state.camera
    if (lens instanceof PerspectiveCamera && lens.fov !== fov) {
      lens.fov = fov
      lens.updateProjectionMatrix()
    }

    if (now - r.readoutAt > READOUT_MS || !observerRef.current) {
      r.readoutAt = now
      const here = toCoordinate(active.frame, r.xM / 1000, r.yM / 1000)
      observerRef.current = here
      useSurfaceHeading.getState().setPosition(walkerPosition(here))
      yawRef.current = r.yaw
      r.northRad = isPolarBox(active.box) ? null : northOnPatch(active.frame, here)
      const readout = readoutRef.current
      if (readout) {
        const zoom = r.zoomed ? ' · zoom ×14' : ''
        const aboveHere = flying ? r.altM - groundHere : r.eyeM
        const height = `${aboveHere.toFixed(aboveHere < 10 ? 1 : 0)} m`
        readout.textContent = `${formatMarsCoordinate(here, 4)} · ${flying ? `flying ${height} above ground` : `eye ${height} up`}${zoom}`
      }
      // A patch over a pole covers every longitude, so its flat picture has
      // no north-up place: the map shows the layer's tiles alone there.
      pictureRef.current = isPolarBox(active.box)
        ? null
        : { image: active.image, bounds: patchBounds(active.box, active.frame.centre.longitudeEast) }
    }

    // The compass: a whole-degree change, at most every HEADING_MS.
    const heading = r.northRad === null ? null : screenHeadingDeg(r.northRad, r.yaw)
    if (heading !== r.headingDeg && now - r.headingAt >= HEADING_MS) {
      r.headingDeg = heading
      r.headingAt = now
      useSurfaceHeading.getState().setHeading(walkerHeading(heading))
    }
  })

  if (!patch) return null
  // Right-click on the ground opens the app's right-click menu there,
  // as on the globe: Set point and Mark point at the ground under the cursor.
  const onContextMenu = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    useMissionStore.getState().openContextMenu({
      coordinate: groundPointToCoordinate(patch.frame, e.point.x, e.point.z),
      anchor: { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY },
    })
  }
  return (
    <>
      <mesh geometry={patch.geometry} onContextMenu={onContextMenu}>
        <meshLambertMaterial map={patch.texture} bumpMap={grain} bumpScale={GRAIN_BUMP} onBeforeCompile={shade} />
      </mesh>
      <Rocks rigRef={rig} />
      <GroundRoute patch={patch} traverse={traverse} />
    </>
  )
}

type Rig = RefObject<{
  yaw: number
  pitch: number
  wheelLog: number
  zoomed: boolean
  keys: MoveKeys
}>

/**
 * Drag to look, keys to move, wheel to rise, F to fly or walk. Listeners
 * removed on unmount. Esc is not here: the surface view leaves through the
 * app's Escape stack.
 */
function useWalkInput(
  rig: Rig,
  domElement: HTMLCanvasElement,
  onToggleModeRef: RefObject<() => void>,
) {
  useEffect(() => {
    const r = rig.current
    let dragging = false
    let lastX = 0
    let lastY = 0

    const typing = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    const setKey = (code: string, down: boolean) => {
      if (code === 'KeyW' || code === 'ArrowUp') r.keys.forward = down
      else if (code === 'KeyS' || code === 'ArrowDown') r.keys.back = down
      else if (code === 'KeyA' || code === 'ArrowLeft') r.keys.left = down
      else if (code === 'KeyD' || code === 'ArrowRight') r.keys.right = down
      else if (code === 'Space') r.keys.up = down
      else if (code === 'KeyC') r.keys.down = down
      else if (code === 'ShiftLeft' || code === 'ShiftRight') r.keys.run = down
      else return false
      return true
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e)) return
      // A control that uses the keys itself, such as the map's grip or the right-click menu: Z and F too.
      if (e.target instanceof Element && e.target.closest('[data-own-keys]')) return
      if (e.code === 'KeyZ') {
        r.zoomed = !r.zoomed
        return
      }
      if (e.code === 'KeyF') {
        onToggleModeRef.current()
        return
      }
      if (setKey(e.code, true)) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      setKey(e.code, false)
    }
    const onBlur = () => {
      r.keys.forward = r.keys.back = r.keys.left = r.keys.right = r.keys.up = r.keys.down = r.keys.run = false
    }
    const onPointerDown = (e: PointerEvent) => {
      // Only the left button looks around: the right one opens the menu, and must not turn the view under it.
      if (e.button !== 0) return
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      domElement.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      // Street View style: the ground follows the pointer. Finer when zoomed.
      const rate = LOOK_RAD_PER_PX * (r.zoomed ? ZOOM_FOV_DEG / FOV_DEG : 1)
      r.yaw -= (e.clientX - lastX) * rate
      r.pitch = Math.max(-MAX_PITCH_RAD, Math.min(MAX_PITCH_RAD, r.pitch + (e.clientY - lastY) * rate))
      lastX = e.clientX
      lastY = e.clientY
    }
    const onPointerUp = () => {
      dragging = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Applied in the frame loop, which knows the ground height.
      r.wheelLog += -e.deltaY * 0.002
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    domElement.addEventListener('pointerdown', onPointerDown)
    domElement.addEventListener('pointermove', onPointerMove)
    domElement.addEventListener('pointerup', onPointerUp)
    domElement.addEventListener('pointercancel', onPointerUp)
    domElement.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      domElement.removeEventListener('pointerdown', onPointerDown)
      domElement.removeEventListener('pointermove', onPointerMove)
      domElement.removeEventListener('pointerup', onPointerUp)
      domElement.removeEventListener('pointercancel', onPointerUp)
      domElement.removeEventListener('wheel', onWheel)
    }
  }, [rig, domElement, onToggleModeRef])
}
