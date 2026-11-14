import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { LineBasicMaterial } from 'three'
import { useMissionStore } from '../../state'
import { GLOBE_RADIUS, KM_PER_SCENE_UNIT } from './constants'
import { GRID_LEVELS, buildGridLines, levelFade } from './gridLines'

/** Lines sit this far above the surface (about 3 km) so they never flicker into it. */
const LIFT = 1.001

/** The grid never answers a pick: right-click reaches the globe underneath. */
function noRaycast() {}

/**
 * Latitude/longitude grid, shown while the store's `gridVisible` is
 * on; the icon panel only flips it. Mount inside the globe mesh so it spins
 * and tilts with the surface.
 *
 * Every level's geometry is built once on mount. Toggling hides the group
 * rather than unmounting it, and the frame loop only changes opacities, so
 * nothing is allocated per frame. Geometry and materials are JSX-declared,
 * so React Three Fiber disposes them on unmount.
 */
export function CoordinateGrid() {
  const visible = useMissionStore((s) => s.gridVisible)
  const camera = useThree((s) => s.camera)
  const materials = useRef<(LineBasicMaterial | null)[]>([])

  const levels = useMemo(
    () =>
      GRID_LEVELS.map((level, i) => ({
        level,
        positions: buildGridLines(
          level.stepDeg,
          i > 0 ? GRID_LEVELS[i - 1].stepDeg : null,
          GLOBE_RADIUS * LIFT,
        ),
      })),
    [],
  )

  useFrame(() => {
    if (!visible) return
    const altitudeKm = (camera.position.length() - GLOBE_RADIUS) * KM_PER_SCENE_UNIT
    // A plain loop: a forEach callback would allocate a closure every frame.
    for (let i = 0; i < GRID_LEVELS.length; i++) {
      const material = materials.current[i]
      if (!material) continue
      const level = GRID_LEVELS[i]
      const fade = levelFade(altitudeKm, level.maxAltitudeKm)
      material.visible = fade > 0
      material.opacity = level.opacity * fade
    }
  })

  return (
    <group visible={visible}>
      {levels.map(({ level, positions }, i) => (
        <lineSegments key={level.stepDeg} raycast={noRaycast}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          {/* depthWrite off: lines never hide each other; depthTest on: the
              far side of the globe hides them. */}
          <lineBasicMaterial
            ref={(m) => {
              materials.current[i] = m
            }}
            color={0xffffff}
            transparent
            opacity={level.opacity}
            depthWrite={false}
          />
        </lineSegments>
      ))}
    </group>
  )
}
