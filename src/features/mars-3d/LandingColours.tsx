import { useEffect, useMemo } from 'react'
import { DataTexture, NearestFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three'
import { useLandingColours } from '../../state'
import { GLOBE_RADIUS } from './constants'
import { landingColourPixels } from './landingColourPixels'
import { buildTilePatch } from './tilePatch'

/**
 * As the thermal drape's (GridDrape): above the detail tiles (1.0006, the
 * CTX ground 1.0007) with depth precision to spare, and under the grid and
 * the overlays (1.001 and up). Lower than the grid's lift on purpose: the
 * click that sets the landing site is read on the picture (1.0007), and at
 * the lowest zoom a colour drawn higher stands visibly off the ground it rates.
 */
const LIFT = 1.0009

/** The colours never answer a pick: the click that sets the landing site reaches the globe underneath. */
function noRaycast() {}

/**
 * The landing rating over the site while the landing site is picked:
 * green, yellow and red cells, partly see-through so the ground shows under
 * them, and nothing where a cell has no rating. One patch of the globe and
 * one small texture, a texel per cell, whatever the lattice's size. Reads
 * the grid from the store; the shell rates the ground and sets it.
 *
 * Drawn after the thermal drape and before the coordinate grid, the
 * geology units and the pins (`renderOrder` between the drape's −1 and
 * their 0 and 1), so lines stay readable over it; with the geology layer on,
 * the units' own see-through fills are painted over the rating. Unlit and
 * not tone mapped: a cell is the legend's colour in the night half too.
 * Mount inside the globe mesh. The texture and the geometry are made here
 * and disposed when the grid changes and on unmount.
 */
export function LandingColours() {
  const grid = useLandingColours((s) => s.grid)
  const drawn = useMemo(() => {
    if (!grid) return null
    const { bounds, cols, rows, rating } = grid
    const texture = new DataTexture(landingColourPixels(rating), cols, rows, RGBAFormat, UnsignedByteType)
    texture.colorSpace = SRGBColorSpace
    // A cell is one flat colour, as the legend's rule is per cell.
    texture.magFilter = NearestFilter
    texture.minFilter = NearestFilter
    // Row 0 is the north row and the patch's v runs north to south.
    texture.flipY = false
    texture.needsUpdate = true
    const geometry = buildTilePatch(
      { north: bounds.north, south: bounds.south, west: bounds.west, width: bounds.east - bounds.west },
      GLOBE_RADIUS * LIFT,
    )
    return { texture, geometry }
  }, [grid])
  useEffect(
    () => () => {
      drawn?.texture.dispose()
      drawn?.geometry.dispose()
    },
    [drawn],
  )
  if (!drawn) return null
  return (
    <mesh geometry={drawn.geometry} raycast={noRaycast} renderOrder={-0.5}>
      <meshBasicMaterial map={drawn.texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}
