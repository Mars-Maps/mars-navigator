import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  Points,
  Vector3,
  type InstancedBufferGeometry,
  type Vector2,
  type ShaderMaterial,
  type Texture,
} from 'three'
import { markerHex, useMarkerColors, useMeasure, useMissionStore, useTerrainPoints } from '../../state'
import { GLOBE_RADIUS, LENS_FACTOR } from './constants'
import { createPinGeometry, createPinMaterial, createPinTexture } from './mapPin'
import { ROUTE_LIFT } from './overlayLift'
import { MEASURE_COLOR } from './MeasureLine'
import { createPathDotMaterial } from './pathDots'
import { ROUTE_PIN_COLOR, TERRAIN_POINT_COLOR } from './pinColors'
import { RouteHazardPoints } from './RouteHazardPoints'
import { RouteHoverMarker } from './RouteHoverMarker'
import { PIN_ANIMATION_S, pinPose } from './pinAnimation'
import { coordinateToLocalPoint } from './projection'
import {
  draftWaypoints,
  greatCirclePath,
  pathDotStride,
  resamplePath,
  type OverlayPoint,
  type OverlayPointKind,
} from './routeGeometry'
import { WalkPlanOverlay } from './WalkPlanOverlay'
import { useOverlayLift } from './useOverlayLift'

const LIFT = ROUTE_LIFT
/** Role colours (`pinColors.ts`, shared with the surface view's map). */
const KIND_COLOR: Record<OverlayPointKind, number> = {
  ...ROUTE_PIN_COLOR,
  // The Measure tool's A and B, the colour of its line.
  measure: MEASURE_COLOR,
  // The profile tools' points, the colour of their line and region.
  terrain: TERRAIN_POINT_COLOR,
}
/** Route dots every 2 km along the path: close enough for the 200 km floor. */
const PATH_STEP = 0.002
/** Long routes space the dots wider rather than exceed this many. */
const MAX_PATH_POINTS = 40000
/**
 * Shown dots about this fraction of camera altitude apart, roughly 15 px
 * with the 45° reference lens; the current lens puts the camera
 * LENS_FACTOR times farther for the same ground, so divide.
 */
const DOT_SPACING_PER_ALTITUDE = 0.014 / LENS_FACTOR

/** The overlay never answers a pick: right-click reaches the globe underneath. */
function noRaycast() {}

/** A pin with a stable identity, so a pin that stays put does not pop again. */
interface KeyedPoint extends OverlayPoint {
  key: string
  /** A marked point's own colour; otherwise its kind's. */
  color?: number
}

/**
 * Everything the effects and the frame loop mutate, created once per mount
 * and never read during render.
 */
interface Rig {
  path: Points<BufferGeometry, ShaderMaterial>
  /** Spacing of the current path's points, scene units. */
  pathStep: number
  pins: Mesh<InstancedBufferGeometry, ShaderMaterial>
  texture: Texture
  /** Clock time each pin key appeared; -Infinity for pins present at mount. */
  bornAt: Map<string, number>
  /** Key of each vertex in the pin geometry, in order. */
  keys: string[]
  /** A pin animated last frame, so the settled pose still has to be written. */
  animating: boolean
  primed: boolean
  pose: { scale: number; angle: number }
}

function createRig(): Rig {
  const path = new Points(new BufferGeometry(), createPathDotMaterial())
  path.raycast = noRaycast
  path.renderOrder = 2
  path.frustumCulled = false
  const texture = createPinTexture()
  const pins = new Mesh(
    createPinGeometry(new Float32Array(0), new Float32Array(0)),
    createPinMaterial(texture),
  )
  pins.raycast = noRaycast
  // Pins sit on top of everything on the globe, and are never culled as a
  // whole: the shader hides the ones over the horizon.
  pins.renderOrder = 3
  pins.frustumCulled = false
  return {
    path,
    pathStep: PATH_STEP,
    pins,
    texture,
    bornAt: new Map(),
    keys: [],
    animating: false,
    primed: false,
    pose: { scale: 1, angle: 0 },
  }
}

/** One instance per pin: tip position, colour, and the animated scale and angle. */
function buildPinGeometry(points: readonly KeyedPoint[]): InstancedBufferGeometry {
  const tips = new Float32Array(points.length * 3)
  const colors = new Float32Array(points.length * 3)
  const color = new Color()
  const p = new Vector3()
  points.forEach((point, i) => {
    coordinateToLocalPoint(point.coordinate, GLOBE_RADIUS * LIFT, p).toArray(tips, i * 3)
    color.setHex(point.color ?? KIND_COLOR[point.kind]).toArray(colors, i * 3)
  })
  return createPinGeometry(tips, colors)
}

/**
 * Departure, stops, destination and marked points as map pins on the globe, with a trail of dots joining the waypoints in order along great
 * circles (pathDots.ts). Mount inside the globe mesh so it spins and tilts
 * with the surface.
 *
 * The trail joins the user's picks, and the caption says it is not a
 * planned path (PLACEHOLDER_REASONS), until a route with a DERIVED path is
 * navigated: then the trail is that path, as the caption says.
 *
 * The trail is one Points object and the pins one instanced Mesh (mapPin.ts),
 * one draw call each. A pin that
 * appears pops in and wobbles (pinAnimation.ts); pins present at mount do
 * not. Geometry is rebuilt only when the draft or the markers change, and
 * the old one is disposed; the trail, pins, texture and materials are created once and
 * disposed on unmount. The frame loop writes numbers only.
 */
export function RouteOverlay() {
  const draft = useMissionStore((s) => s.routeDraft)
  const markers = useMissionStore((s) => s.markers)
  const markerColors = useMarkerColors((s) => s.colors)
  const measure = useMeasure((s) => s.points)
  const terrain = useTerrainPoints((s) => s.points)
  const camera = useThree((s) => s.camera)
  const clock = useThree((s) => s.clock)

  // The store's own object, so the selector is stable; null outside navigation.
  const activePath = useMissionStore((s) => s.activeRoute?.path ?? null)
  const waypoints = useMemo(() => draftWaypoints(draft), [draft])
  const trail = useMemo(
    () => (activePath?.classification === 'DERIVED' ? activePath.value.map((p) => p.coordinate) : waypoints.map((w) => w.coordinate)),
    [activePath, waypoints],
  )
  const points = useMemo(
    (): KeyedPoint[] => [
      ...waypoints.map((w) => ({
        ...w,
        key: `${w.kind}:${w.coordinate.latitude}:${w.coordinate.longitudeEast}`,
      })),
      ...markers.map((m): KeyedPoint => ({ kind: 'marked', coordinate: m.coordinate, key: m.id, color: markerHex(markerColors, m.id) })),
      ...measure.map(
        (c, i): KeyedPoint => ({ kind: 'measure', coordinate: c, key: `measure:${i}:${c.latitude}:${c.longitudeEast}` }),
      ),
      ...terrain.map(
        (c, i): KeyedPoint => ({ kind: 'terrain', coordinate: c, key: `terrain:${i}:${c.latitude}:${c.longitudeEast}` }),
      ),
    ],
    [waypoints, markers, markerColors, measure, terrain],
  )

  const rigRef = useRef<Rig | null>(null)
  const groupRef = useRef<Group>(null)
  // The hover marker and the walk plan are children at the same lift, so this moves them too.
  useOverlayLift(groupRef, LIFT)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const rig = createRig()
    rigRef.current = rig
    group.add(rig.path, rig.pins)
    return () => {
      group.remove(rig.path, rig.pins)
      rig.path.geometry.dispose()
      rig.path.material.dispose()
      rig.pins.geometry.dispose()
      rig.pins.material.dispose()
      rig.texture.dispose()
      rigRef.current = null
    }
  }, [])

  useEffect(() => {
    const rig = rigRef.current
    if (!rig) return
    const geometry = new BufferGeometry()
    if (trail.length >= 2) {
      const radius = GLOBE_RADIUS * LIFT
      const strip = greatCirclePath(trail, radius)
      let length = 0
      for (let i = 3; i < strip.length; i += 3) {
        length += Math.hypot(strip[i] - strip[i - 3], strip[i + 1] - strip[i - 2], strip[i + 2] - strip[i - 1])
      }
      rig.pathStep = Math.max(PATH_STEP, length / MAX_PATH_POINTS)
      const dots = resamplePath(strip, rig.pathStep, radius)
      const count = dots.length / 3
      const index = new Float32Array(count)
      for (let i = 0; i < count; i++) index[i] = i
      geometry.setAttribute('position', new BufferAttribute(dots, 3))
      geometry.setAttribute('aIndex', new BufferAttribute(index, 1))
    }
    const previous = rig.path.geometry
    rig.path.geometry = geometry
    previous.dispose()
  }, [trail])

  useEffect(() => {
    const rig = rigRef.current
    if (!rig) return
    const now = rig.primed ? clock.elapsedTime : -Infinity
    rig.primed = true
    const present = new Set(points.map((p) => p.key))
    for (const key of rig.bornAt.keys()) if (!present.has(key)) rig.bornAt.delete(key)
    for (const key of present) if (!rig.bornAt.has(key)) rig.bornAt.set(key, now)
    rig.keys = points.map((p) => p.key)
    const previous = rig.pins.geometry
    rig.pins.geometry = buildPinGeometry(points)
    previous.dispose()
    rig.animating = true
  }, [points, clock])

  useFrame((state) => {
    const rig = rigRef.current
    if (!rig) return
    const altitude = camera.position.length() - GLOBE_RADIUS
    const path = rig.path.material.uniforms
    path.uStride.value = pathDotStride(altitude, rig.pathStep, DOT_SPACING_PER_ALTITUDE)
    path.uPixelRatio.value = state.viewport.dpr
    const viewport: Vector2 = rig.pins.material.uniforms.uViewport.value
    viewport.set(state.size.width, state.size.height)

    if (!rig.animating) return
    const scale = rig.pins.geometry.getAttribute('aScale') as BufferAttribute | undefined
    const angle = rig.pins.geometry.getAttribute('aAngle') as BufferAttribute | undefined
    if (!scale || !angle) return
    const t = state.clock.elapsedTime
    let still = false
    for (let i = 0; i < rig.keys.length; i++) {
      const age = t - (rig.bornAt.get(rig.keys[i]) ?? -Infinity)
      if (age < PIN_ANIMATION_S) still = true
      pinPose(age, rig.pose)
      scale.array[i] = rig.pose.scale
      angle.array[i] = rig.pose.angle
    }
    scale.needsUpdate = true
    angle.needsUpdate = true
    // One more frame writes the settled pose, then the loop idles.
    rig.animating = still
  })

  return (
    <group ref={groupRef}>
      <RouteHazardPoints />
      <RouteHoverMarker />
      <WalkPlanOverlay />
    </group>
  )
}
