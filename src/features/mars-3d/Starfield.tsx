import { useMemo } from 'react'
import { STAR_COUNT, STARFIELD_RADIUS, generateStars } from './starPositions'

const SKY_OPACITY = 0.85

/**
 * A quiet, static night sky behind the globe. SIMULATED and
 * decorative (see starPositions.ts); nothing on screen claims otherwise.
 *
 * No colour, no per-frame work. Mounted outside the globe's tilted group,
 * so it stays fixed while the globe spins and reads as a sky at infinity
 * as the camera orbits. Shown in every view mode.
 * Geometry and material are
 * JSX-declared, so React Three Fiber disposes them on unmount.
 */
export function Starfield() {
  const { positions, colors } = useMemo(
    () => generateStars(STAR_COUNT, STARFIELD_RADIUS),
    [],
  )

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      {/* Fixed pixel size, no attenuation; depthWrite off so a star never
          cuts into the globe's edge. */}
      <pointsMaterial
        size={1.5}
        sizeAttenuation={false}
        vertexColors
        transparent
        opacity={SKY_OPACITY}
        depthWrite={false}
      />
    </points>
  )
}
