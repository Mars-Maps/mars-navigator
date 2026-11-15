import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  LineDashedMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  type Group,
} from 'three'
import { MAX_WALK_PLANS, useWalkPlan } from '../../state'
import { GLOBE_RADIUS } from './constants'
import { ROUTE_LIFT } from './overlayLift'
import { createDotTexture } from './walkDots'
import { walkColour, walkPlanGeometry } from './walkPlanGeometry'
import { WalkSamplePoints } from './WalkSamplePoints'

/** As the route (RouteOverlay): above the grid and the landing ellipse. */
const LIFT = ROUTE_LIFT
/** A dash and a gap, as a fraction of camera altitude: about 6 px each at this lens, at every zoom. */
const DASH_PER_ALTITUDE = 0.003
/** Across, in CSS pixels: a whole walk can be about 20 px at the closest view, so the dots stay small. */
const STOP_PX = 5
/**
 * A walk that is not selected: drawn, but dimmed under the selected
 * one. A one-pixel dash fades out below about this (checked in headless
 * Chrome at 0.45, where it was hard to find).
 */
const UNSELECTED_OPACITY = 0.7
/** Over the route's trail (2); the selected walk over the others; the line's dots over the line. */
const LINE_RENDER_ORDER = 2
const SELECTED_LINE_RENDER_ORDER = 2.2
const STOP_RENDER_ORDER = 3

/** The walk never answers a pick: right-click reaches the globe underneath. */
function noRaycast() {}

type Line = LineSegments<BufferGeometry, LineDashedMaterial>

/** Dashes and gaps of `length` scene units: written each frame for the camera's altitude. */
function setDash(material: LineDashedMaterial, length: number) {
  material.dashSize = length
  material.gapSize = length
}

/**
 * Where the planned walks are on the globe: up to three, each
 * a dashed line along its legs' paths in its kind's colour, the selected one
 * in full with a dot per stop and a green point per sample, the others
 * dimmed. A locator: a walk of a few km is about 20 px at the closest view,
 * so the Plan a walk panel's diagram is what shows its shape and flags.
 * Mount inside the globe mesh, as RouteOverlay does. A leg with no path is
 * not drawn; the panel says why. Depth testing against the globe hides it
 * over the horizon.
 *
 * One line per walk and the stop dots, one draw call each. Materials and
 * the texture are created once and disposed on unmount; the geometries are
 * replaced, and the old ones disposed, when the plans change. The frame
 * loop writes numbers only.
 */
export function WalkPlanOverlay() {
  const plans = useWalkPlan((s) => s.plans)
  const selectedIndex = useWalkPlan((s) => s.selectedIndex)
  const camera = useThree((s) => s.camera)
  const groupRef = useRef<Group>(null)
  const linesRef = useRef<Line[]>([])
  const dotsRef = useRef<Points<BufferGeometry, PointsMaterial> | null>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const lines: Line[] = Array.from({ length: MAX_WALK_PLANS }, () => {
      const line = new LineSegments(new BufferGeometry(), new LineDashedMaterial({ color: 0xffffff, transparent: true }))
      line.raycast = noRaycast
      line.frustumCulled = false
      line.visible = false
      return line
    })
    const texture = createDotTexture('#ffffff')
    const dots = new Points(
      new BufferGeometry(),
      new PointsMaterial({ map: texture, size: STOP_PX, sizeAttenuation: false, transparent: true, depthWrite: false }),
    )
    dots.raycast = noRaycast
    dots.renderOrder = STOP_RENDER_ORDER
    dots.frustumCulled = false
    linesRef.current = lines
    dotsRef.current = dots
    group.add(...lines, dots)
    return () => {
      group.remove(...lines, dots)
      for (const line of lines) {
        line.geometry.dispose()
        line.material.dispose()
      }
      dots.geometry.dispose()
      dots.material.dispose()
      texture.dispose()
      linesRef.current = []
      dotsRef.current = null
    }
  }, [])

  useEffect(() => {
    const lines = linesRef.current
    const dots = dotsRef.current
    if (lines.length === 0 || !dots) return
    lines.forEach((line, i) => {
      const plan = plans[i] ?? null
      const { segments, lineDistances, stops } = walkPlanGeometry(plan, GLOBE_RADIUS * LIFT)
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(segments, 3))
      geometry.setAttribute('lineDistance', new BufferAttribute(lineDistances, 1))
      const previous = line.geometry
      line.geometry = geometry
      previous.dispose()
      line.visible = plan !== null
      if (!plan) return
      const selected = i === selectedIndex
      line.material.color.setHex(walkColour(plan))
      line.material.opacity = selected ? 1 : UNSELECTED_OPACITY
      line.renderOrder = selected ? SELECTED_LINE_RENDER_ORDER : LINE_RENDER_ORDER
      if (!selected) return
      const dotGeometry = new BufferGeometry()
      dotGeometry.setAttribute('position', new BufferAttribute(stops, 3))
      const previousDots = dots.geometry
      dots.geometry = dotGeometry
      previousDots.dispose()
    })
    dots.visible = plans.length > 0
  }, [plans, selectedIndex])

  useFrame(() => {
    const dash = (camera.position.length() - GLOBE_RADIUS) * DASH_PER_ALTITUDE
    for (const line of linesRef.current) setDash(line.material, dash)
  })

  return (
    <group ref={groupRef}>
      <WalkSamplePoints />
    </group>
  )
}
