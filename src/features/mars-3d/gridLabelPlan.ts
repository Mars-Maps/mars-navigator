import { formatMarsCoordinate, type MarsCoordinate } from '../../domain'
import { GLOBE_RADIUS, KM_PER_SCENE_UNIT } from './constants'
import { GRID_LEVELS, levelFade } from './gridLines'

/**
 * Pure planning for the coordinate grid's degree labels, kept out of
 * the component so it can be tested without a renderer.
 *
 * Labels follow the lines the grid draws (gridLines.ts): only lines of a
 * fully visible level are labelled, and every Nth of them when every one
 * would put labels closer than LABEL_GAP_PX. Latitude labels sit along a
 * meridian left of the view's centre, longitude labels along a parallel
 * below it; the scene hides any that land off screen or over the horizon.
 */

/** Labels closer than this on screen would crowd, CSS pixels. */
export const LABEL_GAP_PX = 80

/** Label spacings to choose from, degrees: each divides 360, and those under 90 divide 90 too. */
const LABEL_STEPS = [1, 2, 5, 10, 30, 60, 90] as const

/** How far towards the view's edge the labels' meridian and parallel sit, as a share of the visible arc. */
const ANCHOR_SHARE = 0.6

/** Longitude labels never sit nearer a pole than this: meridians meet there. */
const MAX_ANCHOR_LATITUDE = 88

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** The finest grid spacing fully drawn at this camera altitude, degrees. */
export function drawnStepDeg(altitudeKm: number): number {
  let step = GRID_LEVELS[0].stepDeg
  for (const level of GRID_LEVELS) {
    if (levelFade(altitudeKm, level.maxAltitudeKm) === 1) step = level.stepDeg
  }
  return step
}

/**
 * The label spacing, degrees: the smallest multiple of the drawn spacing
 * whose labels are at least LABEL_GAP_PX apart, so a label is always on a
 * drawn line. The coarsest spacing when even that would crowd.
 */
export function labelStepDeg(pixelsPerDeg: number, drawnStep: number): number {
  for (const step of LABEL_STEPS) {
    if (step % drawnStep === 0 && step * pixelsPerDeg >= LABEL_GAP_PX) return step
  }
  return LABEL_STEPS[LABEL_STEPS.length - 1]
}

/**
 * Screen pixels one degree of surface spans at the view's centre, for a
 * camera `distanceRadii` globe radii from the centre, looking at it, with
 * `halfFovDeg` across half of `viewportPx`.
 */
export function pixelsPerDegree(distanceRadii: number, viewportPx: number, halfFovDeg: number): number {
  const altitude = Math.max(distanceRadii - 1, 1e-6)
  return (RAD / (altitude * Math.tan(halfFovDeg * RAD))) * (viewportPx / 2)
}

/**
 * The surface arc from the view's centre to the edge of a view `halfFovDeg`
 * across, degrees: where that edge's ray meets the globe, or the horizon
 * when it misses.
 */
export function visibleArcDeg(distanceRadii: number, halfFovDeg: number): number {
  const sinHit = distanceRadii * Math.sin(halfFovDeg * RAD)
  if (sinHit >= 1) return Math.acos(1 / distanceRadii) * DEG
  return Math.asin(sinHit) * DEG - halfFovDeg
}

/** Which lines are labelled, and where their labels sit. Lines are k × step for k from…to. */
export interface GridLabelView {
  latStep: number
  latFrom: number
  latTo: number
  lonStep: number
  lonFrom: number
  lonTo: number
  /** The meridian latitude labels sit on, °E. */
  lonAnchor: number
  /** The parallel longitude labels sit on, °N. */
  latAnchor: number
}

export function emptyGridLabelView(): GridLabelView {
  return { latStep: 0, latFrom: 0, latTo: -1, lonStep: 0, lonFrom: 0, lonTo: -1, lonAnchor: 0, latAnchor: 0 }
}

/** The camera as the labels need it. */
export interface GridLabelCamera {
  /** The point under the camera. */
  centre: MarsCoordinate
  /** Camera distance from the globe's centre, globe radii. */
  distanceRadii: number
  widthPx: number
  heightPx: number
  /** Vertical field of view, degrees. */
  fovDeg: number
}

/**
 * Fills `out` with the labelled lines and the labels' meridian and parallel.
 * Writes into `out` so a frame loop allocates nothing.
 */
export function planGridLabels(cam: GridLabelCamera, out: GridLabelView): GridLabelView {
  const { latitude: lat0, longitudeEast: lon0 } = cam.centre
  const halfV = cam.fovDeg / 2
  const halfH = Math.atan(Math.tan(halfV * RAD) * (cam.widthPx / cam.heightPx)) * DEG
  const arcV = visibleArcDeg(cam.distanceRadii, halfV)
  // Either screen axis may run north-south once the view is turned, so the
  // lines are chosen from the wider arc; the scene drops those off screen.
  const arc = Math.max(arcV, visibleArcDeg(cam.distanceRadii, halfH))
  const offset = ANCHOR_SHARE * arcV

  const altitudeKm = (cam.distanceRadii - 1) * GLOBE_RADIUS * KM_PER_SCENE_UNIT
  const drawn = drawnStepDeg(altitudeKm)
  // Spacing measured at the view's centre, shrunk as the labels' line runs
  // away from it and the surface turns from the camera.
  const px = pixelsPerDegree(cam.distanceRadii, cam.heightPx, halfV) * Math.cos(offset * RAD)

  out.latAnchor = Math.max(-MAX_ANCHOR_LATITUDE, Math.min(MAX_ANCHOR_LATITUDE, lat0 - offset))
  out.lonAnchor = wrapLongitude(lon0 - Math.min(offset / Math.max(Math.cos(lat0 * RAD), 0.05), 90))

  out.latStep = labelStepDeg(px, drawn)
  // Parallels only, never the poles, which are points.
  const latLimit = Math.ceil(90 / out.latStep) - 1
  out.latFrom = Math.max(Math.ceil((lat0 - arc) / out.latStep), -latLimit)
  out.latTo = Math.min(Math.floor((lat0 + arc) / out.latStep), latLimit)

  // Meridians close up towards the poles, so their spacing is taken where the labels sit.
  const anchorCos = Math.max(Math.cos(out.latAnchor * RAD), 0.03)
  out.lonStep = labelStepDeg(px * anchorCos, drawn)
  const count = 360 / out.lonStep
  const half = arc / anchorCos
  out.lonFrom = Math.ceil((lon0 - half) / out.lonStep)
  out.lonTo = Math.floor((lon0 + half) / out.lonStep)
  if (half >= 180 || out.lonTo - out.lonFrom + 1 >= count) {
    out.lonFrom = 0
    out.lonTo = count - 1
  }
  return out
}

/** True when the two views label the same lines; the anchors may differ. */
export function sameLabelledLines(a: GridLabelView, b: GridLabelView): boolean {
  return (
    a.latStep === b.latStep &&
    a.latFrom === b.latFrom &&
    a.latTo === b.latTo &&
    a.lonStep === b.lonStep &&
    a.lonFrom === b.lonFrom &&
    a.lonTo === b.lonTo
  )
}

export interface GridLabel {
  /** Stable across views, so a line keeps its element while it stays labelled. */
  key: string
  kind: 'latitude' | 'longitude'
  /** The line's latitude °N, or longitude °E (0–360). */
  deg: number
  text: string
}

/** The labels a view asks for. Called only when the set changes, not every frame. */
export function gridLabels(view: GridLabelView): GridLabel[] {
  const out: GridLabel[] = []
  for (let k = view.latFrom; k <= view.latTo; k++) {
    const deg = k * view.latStep
    out.push({ key: `lat:${deg}`, kind: 'latitude', deg, text: gridLabelText('latitude', deg) })
  }
  for (let k = view.lonFrom; k <= view.lonTo; k++) {
    const deg = wrapLongitude(k * view.lonStep)
    out.push({ key: `lon:${deg}`, kind: 'longitude', deg, text: gridLabelText('longitude', deg) })
  }
  return out
}

/**
 * "18°N", "18°S" or "77°E": whole degrees, as the lines are, written by the
 * project's one coordinate format (formatMarsCoordinate).
 */
export function gridLabelText(kind: GridLabel['kind'], deg: number): string {
  const [lat, lon] = formatMarsCoordinate(
    kind === 'latitude' ? { latitude: deg, longitudeEast: 0 } : { latitude: 0, longitudeEast: deg },
    0,
  ).split(' ')
  return kind === 'latitude' ? lat : lon
}

function wrapLongitude(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360
  // −0 and float dust at the seam both print as 0°E.
  return wrapped >= 360 - 1e-9 ? 0 : wrapped + 0
}
