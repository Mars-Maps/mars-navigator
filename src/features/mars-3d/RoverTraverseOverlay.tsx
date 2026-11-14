import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Group, Points, PointsMaterial, Vector3 } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { RoverTraverse, TraversePoint } from '../../domain'
import { throttleTrailing } from '../../lib/throttle'
import { GLOBE_RADIUS } from './constants'
import { TRAVERSE_COLOR } from './pinColors'
import { nearestOnScreen, traversePositions } from './traverseGeometry'
import { useOverlayLift } from './useOverlayLift'

/** Between the geology units and grid (1.001) and the planned route (1.002). */
const LIFT = 1.0015
/**
 * Solid line, in CSS pixels: the planned route is dotted, so they never look
 * alike. 4 px, not 3, so it reads over the lit crater.
 */
const LINE_WIDTH_PX = 4
/**
 * A dark edge drawn under the line, 1.5 px proud on each side, so the magenta
 * keeps its outline on bright ground, dark ground and every layer.
 * Translucent black, as the From above map's edge (mapOverlay.ts `EDGE`).
 */
const EDGE_WIDTH_PX = LINE_WIDTH_PX + 3
const EDGE_COLOR = 0x000000
const EDGE_OPACITY = 0.6
/** Waypoint squares, in CSS pixels. PointsMaterial draws squares, not the route's pins. */
const MARKER_SIZE_PX = 5
/**
 * The squares get the same edge, as proud of them as the line's is of the
 * line. With the whole crater in view the waypoints lie a pixel or two
 * apart, so their squares cover the line and its edge, and without this the
 * path had no outline at the view the edge was added for.
 */
const MARKER_EDGE_SIZE_PX = MARKER_SIZE_PX + (EDGE_WIDTH_PX - LINE_WIDTH_PX)
/** A waypoint answers the pointer within this distance on screen. */
const PICK_RADIUS_PX = 8
const PICK_INTERVAL_MS = 50

/** The path never answers a pick: right-click reaches the globe underneath. */
function noRaycast() {}

/** A waypoint under the pointer, and where to show its sol. */
export interface TraverseHover {
  point: TraversePoint
  /** Pointer position in CSS pixels, relative to the canvas. */
  x: number
  y: number
}

/**
 * The rover's driven path: a solid line through every published
 * waypoint, with a small square at each, drawn up to `count` waypoints (the
 * sol slider). Mount inside the globe mesh so it spins and tilts with the
 * surface.
 *
 * Line, markers and their dark edges are created once per traverse and
 * disposed when it changes and on unmount; the slider only moves the draw
 * range, so a drag allocates nothing. Line2 reads the viewport size itself before each
 * render, so nothing runs per frame. The pointer picks the nearest shown
 * waypoint on screen, throttled, into `onHover`.
 */
export function RoverTraverseOverlay({
  traverse,
  count,
  onHover,
}: {
  traverse: RoverTraverse
  /** How many waypoints, from the first, to draw. */
  count: number
  onHover: (hover: TraverseHover | null) => void
}) {
  const groupRef = useRef<Group>(null)
  useOverlayLift(groupRef, LIFT)
  const rig = useRef<{
    line: Line2
    edge: Line2
    markers: Points<BufferGeometry, PointsMaterial>
    /** Waypoint positions in mesh-local space, x, y, z each. */
    positions: Float32Array
  } | null>(null)
  const camera = useThree((s) => s.camera)
  const domElement = useThree((s) => s.gl.domElement)
  // Read by the pointer handler, which outlives renders.
  const countRef = useRef(count)
  const hoverRef = useRef(onHover)
  useEffect(() => {
    countRef.current = count
    hoverRef.current = onHover
  })

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const positions = traversePositions(traverse.points, GLOBE_RADIUS * LIFT)

    const lineGeometry = new LineGeometry()
    // A line needs two points; one waypoint is shown as its marker only.
    if (positions.length >= 6) lineGeometry.setPositions(positions)
    const line = new Line2(
      lineGeometry,
      new LineMaterial({ color: TRAVERSE_COLOR, linewidth: LINE_WIDTH_PX, transparent: true, depthWrite: false }),
    )
    // The edge shares the line's geometry, so the sol slider's instance count
    // moves both at once.
    const edge = new Line2(
      lineGeometry,
      new LineMaterial({
        color: EDGE_COLOR,
        linewidth: EDGE_WIDTH_PX,
        transparent: true,
        opacity: EDGE_OPACITY,
        depthWrite: false,
      }),
    )
    const markerGeometry = new BufferGeometry()
    markerGeometry.setAttribute('position', new BufferAttribute(positions, 3))
    const markers = new Points(
      markerGeometry,
      new PointsMaterial({
        color: TRAVERSE_COLOR,
        size: MARKER_SIZE_PX,
        sizeAttenuation: false,
        transparent: true,
        depthWrite: false,
      }),
    )
    // The squares' edge shares their geometry, so the sol slider's draw range
    // moves both at once.
    const markerEdge = new Points(
      markerGeometry,
      new PointsMaterial({
        color: EDGE_COLOR,
        size: MARKER_EDGE_SIZE_PX,
        sizeAttenuation: false,
        transparent: true,
        opacity: EDGE_OPACITY,
        depthWrite: false,
      }),
    )
    for (const o of [line, edge, markers, markerEdge]) {
      o.raycast = noRaycast
      // Over the geology units, under the planned route's dots (2) and pins (3).
      o.renderOrder = 1.5
      o.frustumCulled = false
    }
    // Both edges are drawn just before the line and the squares, so all the
    // magenta lies on top of all the edge.
    edge.renderOrder = 1.49
    markerEdge.renderOrder = 1.49
    group.add(edge, markerEdge, line, markers)
    rig.current = { line, edge, markers, positions }
    return () => {
      group.remove(edge, markerEdge, line, markers)
      lineGeometry.dispose()
      line.material.dispose()
      edge.material.dispose()
      markerGeometry.dispose()
      markers.material.dispose()
      markerEdge.material.dispose()
      rig.current = null
    }
  }, [traverse])

  useEffect(() => {
    const r = rig.current
    if (!r) return
    const n = Math.max(0, Math.min(count, traverse.points.length))
    r.markers.geometry.setDrawRange(0, n)
    // One segment per pair of consecutive waypoints.
    r.line.geometry.instanceCount = Math.max(0, n - 1)
    // Under two waypoints there is no segment, and an empty line geometry
    // has no instance buffers to draw from.
    r.line.visible = n >= 2
    r.edge.visible = n >= 2
  }, [count, traverse])

  // Screen positions of the shown waypoints, computed on pointer moves
  // only, into buffers made once per traverse.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const points = traverse.points
    const screen = new Float32Array(points.length * 2)
    const world = new Vector3()
    const toCamera = new Vector3()
    const pick = throttleTrailing((x: number, y: number) => {
      const r = rig.current
      if (!r) return
      const rect = domElement.getBoundingClientRect()
      group.updateWorldMatrix(true, false)
      const n = Math.min(countRef.current, points.length)
      for (let i = 0; i < n; i++) {
        world.fromArray(r.positions, i * 3).applyMatrix4(group.matrixWorld)
        // Behind the globe when the surface faces away from the camera.
        toCamera.copy(camera.position).sub(world)
        if (toCamera.dot(world) <= 0) {
          screen[i * 2] = NaN
          screen[i * 2 + 1] = NaN
          continue
        }
        world.project(camera)
        screen[i * 2] = ((world.x + 1) / 2) * rect.width
        screen[i * 2 + 1] = ((1 - world.y) / 2) * rect.height
      }
      const i = nearestOnScreen(screen, n, x, y, PICK_RADIUS_PX)
      hoverRef.current(i === null ? null : { point: points[i], x, y })
    }, PICK_INTERVAL_MS)
    const onMove = (e: PointerEvent) => {
      const rect = domElement.getBoundingClientRect()
      pick(e.clientX - rect.left, e.clientY - rect.top)
    }
    const onLeave = () => {
      pick.cancel()
      hoverRef.current(null)
    }
    domElement.addEventListener('pointermove', onMove)
    domElement.addEventListener('pointerleave', onLeave)
    return () => {
      domElement.removeEventListener('pointermove', onMove)
      domElement.removeEventListener('pointerleave', onLeave)
      pick.cancel()
      hoverRef.current(null)
    }
  }, [traverse, camera, domElement])

  return <group ref={groupRef} />
}
