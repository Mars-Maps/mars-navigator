import { useEffect, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, type Group } from 'three'
import { useMeasure } from '../../state'
import { GLOBE_RADIUS } from './constants'
import { greatCirclePath } from './routeGeometry'
import { useOverlayLift } from './useOverlayLift'

/**
 * Just above the coordinate grid (1.001) and the detail tiles, which write
 * depth. The route trail ignores depth and draws over the line wherever
 * they cross.
 */
const LIFT = 1.003
/** The Measure pins' colour (RouteOverlay), so line and ends read as one. */
export const MEASURE_COLOR = 0xffffff

/** The line never answers a pick: clicks reach the globe underneath. */
function noRaycast() {}

/**
 * The Measure tool's line: the great circle from A to B, solid, so it
 * is never read as the dotted route trail. Its ends are pins in
 * RouteOverlay. Mount inside the globe mesh. The line and material are
 * created once and disposed on unmount; the geometry is replaced, and the
 * old one disposed, whenever the points change.
 */
export function MeasureLine() {
  const points = useMeasure((s) => s.points)
  const groupRef = useRef<Group>(null)
  useOverlayLift(groupRef, LIFT)
  const lineRef = useRef<Line<BufferGeometry, LineBasicMaterial> | null>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: MEASURE_COLOR }))
    line.raycast = noRaycast
    line.renderOrder = 2
    lineRef.current = line
    group.add(line)
    return () => {
      group.remove(line)
      line.geometry.dispose()
      line.material.dispose()
      lineRef.current = null
    }
  }, [])

  useEffect(() => {
    const line = lineRef.current
    if (!line) return
    const geometry = new BufferGeometry()
    if (points.length === 2) {
      geometry.setAttribute('position', new BufferAttribute(greatCirclePath(points, GLOBE_RADIUS * LIFT), 3))
    }
    const previous = line.geometry
    line.geometry = geometry
    previous.dispose()
  }, [points])

  return <group ref={groupRef} />
}
