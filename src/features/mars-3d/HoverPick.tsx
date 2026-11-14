import { useThree } from '@react-three/fiber'
import { useEffect, type RefObject } from 'react'
import { Raycaster, Vector2, Vector3, type Mesh } from 'three'
import type { MarsCoordinate } from '../../domain'
import { throttleTrailing } from '../../lib/throttle'
import { hoverDecimals, terrainPointLimit, useMissionStore, useUnitHover } from '../../state'
import { sameAtDecimals, UNIT_HOVER_DECIMALS } from './hoverCompare'
import { pickCoordinate } from './overlayLift'

/** Store writes at most this often while the cursor moves. */
const HOVER_INTERVAL_MS = 50

/**
 * The surface coordinate under the cursor, into the store's
 * `hoverCoordinate`. DERIVED: the pick ray against the sphere the picture is
 * drawn on (overlayLift.ts), which matches the tilted mesh because the tilt is about the origin, then
 * the same mesh-local → coordinate projection every other pick uses.
 *
 * Quiet by design: the ray is cast per pointer move with the Three.js
 * objects created once per mount (the coordinate itself is a small fresh
 * object, and getBoundingClientRect allocates a DOMRect), but the store is
 * written only when the value changes at the shown precision, and at most
 * every 50 ms with a trailing write so the last position always lands.
 * Leaving the canvas or missing the globe writes null once. The comparison
 * is against the store itself, not a private copy, so another writer
 * (the point menu) cannot leave this one with a stale view of it.
 * Listeners and the pending write are removed on unmount.
 */
export function HoverPick({ globe }: { globe: RefObject<Mesh | null> }) {
  const camera = useThree((s) => s.camera)
  const domElement = useThree((s) => s.gl.domElement)

  useEffect(() => {
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const hit = new Vector3()

    const write = throttleTrailing((next: MarsCoordinate | null) => {
      const { hoverCoordinate, setHoverCoordinate, activeLayerId, activeToolId, camera } = useMissionStore.getState()
      const unit = useUnitHover.getState()
      // The fine cursor: for the geology layer's unit and for the profile
      // tools' preview, which must end where the click will land.
      const fine = activeLayerId === 'geology' || terrainPointLimit(activeToolId) !== null ? next : null
      if (!sameAtDecimals(unit.at, fine, UNIT_HOVER_DECIMALS)) unit.setAt(fine)
      // At the readout's own precision, finer below 100 km.
      if (sameAtDecimals(hoverCoordinate, next, hoverDecimals(camera?.altitudeKm ?? null))) return
      setHoverCoordinate(next)
    }, HOVER_INTERVAL_MS)

    const onMove = (e: PointerEvent) => {
      const mesh = globe.current
      if (!mesh) return
      const rect = domElement.getBoundingClientRect()
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      // A fresh object only when there is a hit to report; the throttle
      // keeps the last one and drops the rest.
      write(pickCoordinate(raycaster.ray, mesh, hit))
    }
    const onLeave = () => write(null)

    domElement.addEventListener('pointermove', onMove)
    domElement.addEventListener('pointerleave', onLeave)
    return () => {
      domElement.removeEventListener('pointermove', onMove)
      domElement.removeEventListener('pointerleave', onLeave)
      write.cancel()
      const { hoverCoordinate, setHoverCoordinate } = useMissionStore.getState()
      if (hoverCoordinate !== null) setHoverCoordinate(null)
      useUnitHover.getState().setAt(null)
    }
  }, [camera, domElement, globe])

  return null
}
