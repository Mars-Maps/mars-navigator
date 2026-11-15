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

/**
 * A grid under another is drawn this much lower, as far under the top one
 * as the CTX ground is under it (1.0007), so the two never fight for depth.
 */
const LIFT_UNDER = 1.0008

/** A texel more solid than this, of 1, is a rated cell: the top grid hides what is under it there and nowhere else. */
const RATED_ALPHA = 0.01

/** The colours never answer a pick: the click that sets the landing site reaches the globe underneath. */
function noRaycast() {}

/**
 * The landing rating over the ground in view while the landing site is
 * picked: green, yellow and red cells, partly see-through so the ground
 * shows under them, and nothing where a cell has no rating. One patch of
 * the globe and one small texture per grid, a texel per cell, whatever the
 * lattice's size. Reads the grids from the store; the shell rates the
 * ground and sets them.
 *
 * With two grids (the site's sheet at fine cells over the view at coarse
 * ones) the first is on top and drawn first, writing depth where a cell is
 * rated, and the second is drawn lower and after it: a coarse cell that
 * reaches under the sheet is cut where the sheet has a colour, so no ground
 * is tinted twice, and shows through where the sheet has none at its edge.
 *
 * Drawn after the thermal drape and before the coordinate grid, the
 * geology units and the pins (`renderOrder` between the drape's −1 and
 * their 0 and 1), so lines stay readable over it; with the geology layer on,
 * the units' own see-through fills are painted over the rating. Unlit and
 * not tone mapped: a cell is the legend's colour in the night half too.
 * Mount inside the globe mesh. The textures and the geometries are made
 * here and disposed when the grids change and on unmount.
 */
export function LandingColours() {
  const grids = useLandingColours((s) => s.grids)
  const drawn = useMemo(
    () =>
      grids.map(({ bounds, cols, rows, rating }, i) => {
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
          GLOBE_RADIUS * (i === 0 ? LIFT : LIFT_UNDER),
        )
        return { texture, geometry }
      }),
    [grids],
  )
  useEffect(
    () => () => {
      for (const d of drawn) {
        d.texture.dispose()
        d.geometry.dispose()
      }
    },
    [drawn],
  )
  // The top grid hides the ground under its rated cells only when there is something under it.
  const covers = drawn.length > 1
  return drawn.map((d, i) => (
    // Keyed on `covers` too: the alpha test is compiled into the material, so a change of it takes a new one.
    <mesh key={`${i}-${covers}`} geometry={d.geometry} raycast={noRaycast} renderOrder={i === 0 ? -0.6 : -0.5}>
      <meshBasicMaterial
        map={d.texture}
        transparent
        depthWrite={covers && i === 0}
        alphaTest={covers && i === 0 ? RATED_ALPHA : 0}
        toneMapped={false}
      />
    </mesh>
  ))
}
