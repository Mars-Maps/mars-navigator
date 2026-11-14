import { MARS_MEAN_RADIUS_KM, type MarsCoordinate } from '../../../domain'

/**
 * Geometry of the surface view's ground patch: a square of PATCH_SIZE_KM
 * around any point on Mars, drawn flat. Positions on it are kilometres east
 * (x) and north (y) of its centre on an azimuthal equidistant projection,
 * which is defined everywhere (poles and the 180°E line included) except
 * the antipode, half a planet away. Distances from the centre are exact; the
 * flat drawing ignores curvature, a few metres of drop at the patch edge.
 *
 * Pure arithmetic on plain numbers, so it is tested and allocates only what
 * it returns.
 */
export const PATCH_SIZE_KM = 40
export const PATCH_HALF_KM = PATCH_SIZE_KM / 2

const R = MARS_MEAN_RADIUS_KM
const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** Unit vectors in a planet-fixed frame: z to the north pole, x to 0°E. */
export interface PatchFrame {
  centre: MarsCoordinate
  /** Centre, east and north directions at the centre. */
  c: readonly [number, number, number]
  e: readonly [number, number, number]
  n: readonly [number, number, number]
}

export function makeFrame(centre: MarsCoordinate): PatchFrame {
  const lat = centre.latitude * RAD
  const lon = centre.longitudeEast * RAD
  const c = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)] as const
  // East from the longitude alone, so it stays defined at a pole.
  const e = [-Math.sin(lon), Math.cos(lon), 0] as const
  // n = c × e
  const n = [
    c[1] * e[2] - c[2] * e[1],
    c[2] * e[0] - c[0] * e[2],
    c[0] * e[1] - c[1] * e[0],
  ] as const
  return { centre, c, e, n }
}

export interface PatchOffset {
  xKm: number
  yKm: number
}

/** Surface coordinate → km east and north of the patch centre. */
export function toPatch(frame: PatchFrame, coordinate: MarsCoordinate): PatchOffset {
  const lat = coordinate.latitude * RAD
  const lon = coordinate.longitudeEast * RAD
  const px = Math.cos(lat) * Math.cos(lon)
  const py = Math.cos(lat) * Math.sin(lon)
  const pz = Math.sin(lat)
  const { c, e, n } = frame
  const along = px * c[0] + py * c[1] + pz * c[2]
  const tx = px - c[0] * along
  const ty = py - c[1] * along
  const tz = pz - c[2] * along
  const t = Math.hypot(tx, ty, tz)
  if (t === 0) return { xKm: 0, yKm: 0 }
  // atan2, not acos: acos loses precision for points near the centre.
  const scale = (Math.atan2(t, along) * R) / t
  return {
    xKm: (tx * e[0] + ty * e[1] + tz * e[2]) * scale,
    yKm: (tx * n[0] + ty * n[1] + tz * n[2]) * scale,
  }
}

/** Km east and north of the patch centre → surface coordinate. */
export function toCoordinate(frame: PatchFrame, xKm: number, yKm: number): MarsCoordinate {
  const dist = Math.hypot(xKm, yKm)
  const { c, e, n } = frame
  if (dist === 0) return frame.centre
  const d = dist / R
  const cos = Math.cos(d)
  const sin = Math.sin(d) / dist
  const px = c[0] * cos + (e[0] * xKm + n[0] * yKm) * sin
  const py = c[1] * cos + (e[1] * xKm + n[1] * yKm) * sin
  const pz = c[2] * cos + (e[2] * xKm + n[2] * yKm) * sin
  const lon = Math.atan2(py, px) * DEG
  return {
    latitude: Math.asin(Math.max(-1, Math.min(1, pz))) * DEG,
    longitudeEast: lon < 0 ? lon + 360 : lon,
  }
}

/**
 * A point in the ground's scene, metres (x east, −z north, y up, as the
 * ground's geometry and the camera use), → surface coordinate.
 * The height is not needed: the ground's frame is flat.
 */
export function groundPointToCoordinate(frame: PatchFrame, x: number, z: number): MarsCoordinate {
  return toCoordinate(frame, x / 1000, -z / 1000)
}

/**
 * The (latitude, longitude °E) of every vertex of a size × size grid over
 * the patch, row 0 at the north edge and column 0 at the west edge: the
 * order of the heights the elevation source returns and of PlaneGeometry's
 * vertices.
 */
export function patchGrid(frame: PatchFrame, size: number): Float64Array {
  const points = new Float64Array(size * size * 2)
  const step = PATCH_SIZE_KM / (size - 1)
  for (let row = 0; row < size; row++) {
    const y = PATCH_HALF_KM - row * step
    for (let col = 0; col < size; col++) {
      const p = toCoordinate(frame, col * step - PATCH_HALF_KM, y)
      const i = (row * size + col) * 2
      points[i] = p.latitude
      points[i + 1] = p.longitudeEast
    }
  }
  return points
}

/**
 * The latitude/longitude box an equirectangular image of the patch needs.
 * Longitudes are relative to the centre's, in (−180, 180], so a patch on
 * the 180°E line is one box, not two. A patch over a pole takes every
 * longitude and runs to that pole.
 */
export interface PatchBox {
  south: number
  north: number
  /** Relative to the centre longitude. */
  westRel: number
  eastRel: number
}

export function patchBox(frame: PatchFrame, points: Float64Array): PatchBox {
  let south = 90
  let north = -90
  let westRel = 180
  let eastRel = -180
  const lon0 = frame.centre.longitudeEast
  for (let i = 0; i < points.length; i += 2) {
    south = Math.min(south, points[i])
    north = Math.max(north, points[i])
    const rel = relativeLongitude(points[i + 1], lon0)
    westRel = Math.min(westRel, rel)
    eastRel = Math.max(eastRel, rel)
  }
  const inside = (pole: number) => {
    const o = toPatch(frame, { latitude: pole, longitudeEast: 0 })
    return Math.abs(o.xKm) <= PATCH_HALF_KM && Math.abs(o.yKm) <= PATCH_HALF_KM
  }
  if (inside(90)) return { south, north: 90, westRel: -180, eastRel: 180 }
  if (inside(-90)) return { south: -90, north, westRel: -180, eastRel: 180 }
  return { south, north, westRel, eastRel }
}

/**
 * Where a coordinate falls in an image of `box`: u from 0 at the west edge
 * to 1 at the east, v from 0 at the south edge to 1 at the north. The
 * ground's texture coordinates and the overhead map's marker use
 * this one mapping, so the marker sits on the pixels under the walker.
 */
export function boxUv(box: PatchBox, lon0: number, latitude: number, longitudeEast: number): { u: number; v: number } {
  return {
    u: (relativeLongitude(longitudeEast, lon0) - box.westRel) / (box.eastRel - box.westRel),
    v: (latitude - box.south) / (box.north - box.south),
  }
}

/** A box that runs to a pole and so covers every longitude (`patchBox`). */
export function isPolarBox(box: PatchBox): boolean {
  return box.westRel === -180 && box.eastRel === 180
}

/** `lon` minus `lon0`, in (−180, 180]. */
export function relativeLongitude(lon: number, lon0: number): number {
  const d = (((lon - lon0) % 360) + 360) % 360
  return d > 180 ? d - 360 : d
}
