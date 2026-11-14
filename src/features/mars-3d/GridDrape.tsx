import { useEffect, useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'
import { GLOBE_RADIUS } from './constants'

/**
 * Above the detail tiles (1.0006) and under the grid and the overlays
 * (1.001 and up). 1.0009, not lower, so the shell's facets clear the tiles
 * with depth precision to spare when the camera is far. The
 * CTX ground (1.0007) would sit under it, but is only drawn under the
 * satellite layer, never with a grid layer.
 */
const LIFT = 1.0009

/**
 * Finer than the globe's 96 × 64 so the shell's facets never dip under the
 * tiles: a 256 × 128 facet sags about 0.00015 of the radius at its middle,
 * which leaves it above the tiles' 1.0006.
 */
const WIDTH_SEGMENTS = 256
const HEIGHT_SEGMENTS = 128

/** The drape never answers a pick: hover and right-click reach the globe underneath. */
function noRaycast() {}

/**
 * A thermal grid layer's colours, partly see-through, on a shell just
 * above the detail tiles, so the base map's grey tiles under it show
 * the crater through the colours at close range. The picture arrives from
 * the store (`drape.over`) with its alpha already set and its no-data cells
 * clear; this only shows it. Mount inside the globe mesh so it spins
 * and tilts with the surface. Lit like the globe, so the terminator
 * crosses it too; depthWrite off, so nothing drawn after it is hidden.
 *
 * The texture is created here and disposed when the picture changes and
 * on unmount; geometry and material are JSX, disposed by React Three Fiber.
 */
export function GridDrape({ image }: { image: HTMLCanvasElement }) {
  const texture = useMemo(() => {
    const next = new CanvasTexture(image)
    next.colorSpace = SRGBColorSpace
    return next
  }, [image])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    // Drawn before the other see-through layers: the coordinate grid has the
    // same depth and draw order, and three.js would otherwise draw whichever
    // was created later on top, so the colours could wash out its lines.
    <mesh raycast={noRaycast} renderOrder={-1}>
      <sphereGeometry args={[GLOBE_RADIUS * LIFT, WIDTH_SEGMENTS, HEIGHT_SEGMENTS]} />
      <meshLambertMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  )
}
