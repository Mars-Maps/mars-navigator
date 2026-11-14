import { useEffect, useRef } from 'react'
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineLoop, type Group } from 'three'
import { isAvailable } from '../../domain'
import { useSite } from '../../state'
import { GLOBE_RADIUS } from './constants'
import { coordinateToLocalPoint } from './projection'
import { useOverlayLift } from './useOverlayLift'

/** Above the grid (1.001), below the route (1.002), so a walk draws over it. */
const LIFT = 1.0015
/**
 * Not a classification colour (green, blue, amber, grey are taken) and not
 * a pin role colour (pinColors.ts): a sky blue, so the outline reads as the
 * one official line on the globe.
 */
export const ELLIPSE_COLOR = 0x7dd3fc

/** The outline never answers a pick: clicks reach the globe underneath. */
function noRaycast() {}

/**
 * The site's landing ellipse, OFFICIAL from its map's feature
 * service, drawn as the ring's own vertices joined by straight segments:
 * at 763 vertices some 35 m apart no segment leaves the surface by more
 * than the lift. Mount inside the globe mesh. Nothing is drawn while the
 * ellipse is unread or UNAVAILABLE; the intro says why in that case. The
 * loop and material are created once and disposed on unmount; the
 * geometry is replaced, and the old one disposed, when the ring changes.
 */
export function LandingEllipse() {
  const ellipse = useSite((s) => s.ellipse)
  const groupRef = useRef<Group>(null)
  useOverlayLift(groupRef, LIFT)
  const loopRef = useRef<LineLoop<BufferGeometry, LineBasicMaterial> | null>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const loop = new LineLoop(new BufferGeometry(), new LineBasicMaterial({ color: ELLIPSE_COLOR }))
    loop.raycast = noRaycast
    loop.renderOrder = 1
    loopRef.current = loop
    group.add(loop)
    return () => {
      group.remove(loop)
      loop.geometry.dispose()
      loop.material.dispose()
      loopRef.current = null
    }
  }, [])

  useEffect(() => {
    const loop = loopRef.current
    if (!loop) return
    const geometry = new BufferGeometry()
    if (ellipse && isAvailable(ellipse)) {
      // The ring repeats its first vertex last; a loop closes itself.
      const ring = ellipse.value
      const n = ring.length > 1 ? ring.length - 1 : ring.length
      const positions = new Float32Array(n * 3)
      const point = coordinateToLocalPoint(ring[0], GLOBE_RADIUS * LIFT)
      for (let i = 0; i < n; i++) {
        coordinateToLocalPoint(ring[i], GLOBE_RADIUS * LIFT, point)
        positions[i * 3] = point.x
        positions[i * 3 + 1] = point.y
        positions[i * 3 + 2] = point.z
      }
      geometry.setAttribute('position', new BufferAttribute(positions, 3))
    }
    const previous = loop.geometry
    loop.geometry = geometry
    previous.dispose()
  }, [ellipse])

  return <group ref={groupRef} />
}
