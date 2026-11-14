import { useMemo } from 'react'
import { DoubleSide } from 'three'
import { GLOBE_RADIUS } from './constants'
import { unitColor } from './geologyColors'
import type { GeologicUnitArea } from '../../domain'
import { mergeAreas } from './geologyGeometry'

/**
 * Units sit this far above the surface (about 3 km), under the route
 * (RouteOverlay, 1.002), so the route line is always drawn on top, as on
 * NASA's annotated route map PIA23179.
 */
const LIFT = 1.001

/** Translucent enough that the terrain under a unit still reads. */
const FILL_OPACITY = 0.35
const OUTLINE_OPACITY = 0.45

/** Counts rebuilds, so each new set of buffers mounts fresh (see key). */
let builds = 0

/** The overlay never answers a pick: hover reads the unit from the
    globe's coordinate (geologyArea's areaAt), so the globe's own pick stays the one. */
function noRaycast() {}

/**
 * Geology layer: mapped units drawn as translucent colours with
 * outlines, over the global map while the geology layer is the
 * active one. Mount inside the globe mesh so it spins and tilts with the
 * surface.
 *
 * All units are merged into one fill and one outline geometry, built once
 * per `areas`. Geometry and materials are JSX-declared, so React Three
 * Fiber disposes them on unmount and when `areas` changes. Toggling hides
 * the group rather than unmounting it, and nothing runs per frame.
 */
export function GeologyOverlay({
  areas,
  visible,
}: {
  areas: readonly GeologicUnitArea[]
  visible: boolean
}) {
  const { merged, build } = useMemo(
    () => ({
      merged: mergeAreas(areas, GLOBE_RADIUS * LIFT, (a) => unitColor(a.unit)),
      build: ++builds,
    }),
    [areas],
  )
  if (merged.indices.length === 0) return null

  return (
    // key: a new `areas` remounts the group, so R3F disposes the old
    // geometries instead of swapping attributes under a live one.
    <group key={build} visible={visible}>
      <mesh raycast={noRaycast} renderOrder={1}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[merged.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[merged.colors, 3]} />
          <bufferAttribute attach="index" args={[merged.indices, 1]} />
        </bufferGeometry>
        {/* depthWrite off: units never hide the route or each other's
            outlines; depthTest on: the far side of the globe hides them. */}
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={FILL_OPACITY}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      <lineSegments raycast={noRaycast} renderOrder={1}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[merged.outline, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color={0xffffff}
          transparent
          opacity={OUTLINE_OPACITY}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  )
}
