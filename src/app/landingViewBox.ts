import { MARS_MEAN_RADIUS_KM, type MarsCoordinate, type SiteBounds } from '../domain'
import { visibleCapRadians } from '../features/mars-3d/tilePyramid'

/**
 * The ground the landing rating is worked on for a camera view: a box
 * round the view's centre that holds everything on screen, and the spacing
 * of the lattice laid over it. Pure, so it is tested without a camera.
 *
 * Before this the rating was read once, over the site's map sheet, whatever
 * the camera showed: a square 59 km across that stayed where it was while
 * the map moved under it.
 */

/**
 * Cells across the box, at most: what the site's sheet has at the lattice's
 * least spacing (59 km at 0.41 km), so a view costs about what the sheet's
 * read did, a row request per lattice row of the global model.
 */
export const LANDING_VIEW_CELLS = 144

/**
 * The widest box rated, km. Wider, and a cell is over 8 km across: a slope
 * averaged that far says little about ground to land on, and a row of the
 * global model across the box is several requests' worth of bytes. A
 * project choice. A view wider than this gets no box: the caller keeps to
 * the site's sheet and says to zoom in.
 */
export const LANDING_VIEW_MAX_KM = 1200

/** Nearer a pole than this the lattice gives nothing (`landingLattice`), so the box stops here. */
const MAX_ABS_LATITUDE = 85

export interface LandingViewBox {
  bounds: SiteBounds
  /** The lattice's least spacing over the box, km: never under `minSpacingKm`. */
  spacingKm: number
}

/**
 * The box for a view from `altitudeKm` over `target`, through a lens of
 * `fovDeg` on a screen of `aspect` (width over height), or null when the
 * view is wider than `LANDING_VIEW_MAX_KM` or lies past the lattice's
 * latitude limit.
 *
 * A square on the ground whose half-side is the angle from the view's
 * centre to its corner, so it holds the screen at any heading. Widened
 * east–west by the cosine of its edge nearer a pole, where a degree of
 * longitude is shortest. Cut at ±85° and at 0 and 360°E: the lattice does
 * not cross either, so a view over the 0°E meridian is coloured on the
 * centre's side of it only.
 */
export function landingViewBox(
  view: { altitudeKm: number; target: MarsCoordinate },
  screen: { fovDeg: number; aspect: number },
  minSpacingKm: number,
): LandingViewBox | null {
  const { altitudeKm, target } = view
  if (!(altitudeKm > 0) || !(screen.aspect > 0) || !(minSpacingKm > 0)) return null
  if (!Number.isFinite(target.latitude) || !Number.isFinite(target.longitudeEast)) return null
  const half = visibleCapRadians(altitudeKm, screen.fovDeg, screen.aspect, MARS_MEAN_RADIUS_KM)
  const sideKm = 2 * half * MARS_MEAN_RADIUS_KM
  if (!(sideKm > 0) || sideKm > LANDING_VIEW_MAX_KM) return null
  const halfDeg = (half * 180) / Math.PI
  const south = Math.max(-MAX_ABS_LATITUDE, target.latitude - halfDeg)
  const north = Math.min(MAX_ABS_LATITUDE, target.latitude + halfDeg)
  if (!(north > south)) return null
  const narrowest = Math.cos((Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180)
  const halfLonDeg = halfDeg / narrowest
  const west = Math.max(0, target.longitudeEast - halfLonDeg)
  const east = Math.min(360, target.longitudeEast + halfLonDeg)
  if (!(east > west)) return null
  return { bounds: { west, east, south, north }, spacingKm: Math.max(minSpacingKm, sideKm / LANDING_VIEW_CELLS) }
}
