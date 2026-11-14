import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  LineDashedMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  type Group,
} from 'three'
import { useWalkPlan } from '../../state'
import { GLOBE_RADIUS } from './constants'
import { ROUTE_LIFT } from './overlayLift'
import { walkPlanGeometry } from './walkPlanGeometry'

/** As the route (RouteOverlay): above the grid and the landing ellipse. */
const LIFT = ROUTE_LIFT
/** A dash and a gap, as a fraction of camera altitude: about 6 px each at this lens, at every zoom. */
const DASH_PER_ALTITUDE = 0.003
/** Across, in CSS pixels: a whole walk can be about 20 px at the closest view, so the dots stay small. */
const STOP_PX = 5
/** The sprite's own size; drawn smaller, so its edge stays smooth. */
const TEXTURE_PX = 32
/** Over the route's trail (2); the line's dots over the line. */
const LINE_RENDER_ORDER = 2
const STOP_RENDER_ORDER = 3

/** The walk never answers a pick: right-click reaches the globe underneath. */
function noRaycast() {}

/** A white dot with a dark rim, readable on every layer, as the route's dots are. */
function createStopTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_PX
  canvas.height = TEXTURE_PX
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const c = TEXTURE_PX / 2
    ctx.beginPath()
    ctx.arc(c, c, c * 0.72, 0, Math.PI * 2)
    ctx.lineWidth = c * 0.32
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * Where the planned walk is on the globe: a dashed white line along
 * each leg's path and a dot per stop, from the walk-plan store. A locator: a
 * walk of a few km is about 20 px at the closest view, so the Plan a walk
 * panel's diagram is what shows its shape and flags. Mount inside the globe
 * mesh, as RouteOverlay does. A leg with no path is not drawn; the panel says
 * why. Depth testing against the globe hides it over the horizon.
 *
 * The line and the dots are one draw call each. Materials and the texture are
 * created once and disposed on unmount; the geometry is replaced, and the old
 * one disposed, when the plan changes. The frame loop writes numbers only.
 */
export function WalkPlanOverlay() {
  const plan = useWalkPlan((s) => s.plan)
  const camera = useThree((s) => s.camera)
  const groupRef = useRef<Group>(null)
  const lineRef = useRef<LineSegments<BufferGeometry, LineDashedMaterial> | null>(null)
  const dotsRef = useRef<Points<BufferGeometry, PointsMaterial> | null>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const line = new LineSegments(new BufferGeometry(), new LineDashedMaterial({ color: 0xffffff }))
    line.raycast = noRaycast
    line.renderOrder = LINE_RENDER_ORDER
    line.frustumCulled = false
    const texture = createStopTexture()
    const dots = new Points(
      new BufferGeometry(),
      new PointsMaterial({ map: texture, size: STOP_PX, sizeAttenuation: false, transparent: true, depthWrite: false }),
    )
    dots.raycast = noRaycast
    dots.renderOrder = STOP_RENDER_ORDER
    dots.frustumCulled = false
    lineRef.current = line
    dotsRef.current = dots
    group.add(line, dots)
    return () => {
      group.remove(line, dots)
      line.geometry.dispose()
      line.material.dispose()
      dots.geometry.dispose()
      dots.material.dispose()
      texture.dispose()
      lineRef.current = null
      dotsRef.current = null
    }
  }, [])

  useEffect(() => {
    const line = lineRef.current
    const dots = dotsRef.current
    if (!line || !dots) return
    const { segments, lineDistances, stops } = walkPlanGeometry(plan, GLOBE_RADIUS * LIFT)
    const lineGeometry = new BufferGeometry()
    lineGeometry.setAttribute('position', new BufferAttribute(segments, 3))
    lineGeometry.setAttribute('lineDistance', new BufferAttribute(lineDistances, 1))
    const dotGeometry = new BufferGeometry()
    dotGeometry.setAttribute('position', new BufferAttribute(stops, 3))
    const previousLine = line.geometry
    const previousDots = dots.geometry
    line.geometry = lineGeometry
    dots.geometry = dotGeometry
    previousLine.dispose()
    previousDots.dispose()
  }, [plan])

  useFrame(() => {
    const line = lineRef.current
    if (!line) return
    const dash = (camera.position.length() - GLOBE_RADIUS) * DASH_PER_ALTITUDE
    line.material.dashSize = dash
    line.material.gapSize = dash
  })

  return <group ref={groupRef} />
}
