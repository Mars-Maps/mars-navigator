import { isAvailable, type DataClassification, type MarsCoordinate, type SurfacePoint, type WalkPlan } from '../../../domain'
import { cssColor, ROUTE_PIN_COLOR, TRAVERSE_COLOR } from '../pinColors'
import { draftWaypoints, type WaypointDraft } from '../routeWaypoints'
import { coordinateToScreen, wrapLongitude, type MapSize, type MapView } from './overheadMapView'

/**
 * What the overhead map shows over the ground: the route draft's
 * departure, stops and destination, the marked points with their names,
 * and the line joining the waypoints in order along great circles, the
 * same line the globe draws (`greatCirclePath`). It is not a planned path,
 * and the map says so. A planned walk draws too, its legs as the planner gave
 * them. Pure maths and canvas calls, tested without a DOM.
 */

export type MapPinKind = keyof typeof ROUTE_PIN_COLOR

export interface MapPin {
  kind: MapPinKind
  coordinate: MarsCoordinate
  /** What the right-click menu and the expanded map call it. */
  name: string
  /** A marked point's own colour; otherwise its kind's. */
  color?: number
}

/** The draft's waypoints in travel order, then the marked points. */
export function mapPins(
  draft: WaypointDraft,
  markers: readonly SurfacePoint[],
  colorOf: (id: string) => number | undefined = () => undefined,
): MapPin[] {
  let stop = 0
  const pins: MapPin[] = draftWaypoints(draft).map((w) => {
    if (w.kind === 'departure') return { kind: 'departure', coordinate: w.coordinate, name: 'Departure' }
    if (w.kind === 'destination') return { kind: 'destination', coordinate: w.coordinate, name: 'Destination' }
    return { kind: 'stop', coordinate: w.coordinate, name: `Stop ${++stop}` }
  })
  markers.forEach((m, i) =>
    pins.push({ kind: 'marked', coordinate: m.coordinate, name: m.label ?? `Marked point ${i + 1}`, color: colorOf(m.id) }),
  )
  return pins
}

/** Track spacing, degrees: fine enough that straight pieces between samples stay on the great circle at any zoom. */
export const TRACK_STEP_DEG = 0.1
const SAME_POINT_RAD = 1e-9
const RAD = Math.PI / 180

type Vec = [number, number, number]
const toVec = (c: MarsCoordinate): Vec => {
  const lat = c.latitude * RAD
  const lon = c.longitudeEast * RAD
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
}
const toCoordinate = (v: Vec): MarsCoordinate => ({
  latitude: Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD,
  longitudeEast: wrapLongitude(Math.atan2(v[1], v[0]) / RAD),
})
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1], a[2])
  return [a[0] / l, a[1] / l, a[2] / l]
}

/**
 * The waypoints joined along great circles, sampled every `stepDeg`. As on
 * the globe, a repeated point adds nothing, and a leg between antipodes
 * goes through the north pole.
 */
export function greatCircleTrack(waypoints: readonly MarsCoordinate[], stepDeg = TRACK_STEP_DEG): MarsCoordinate[] {
  if (waypoints.length === 0) return []
  const out: MarsCoordinate[] = [waypoints[0]]
  let a = toVec(waypoints[0])
  for (let i = 1; i < waypoints.length; i++) {
    const b = toVec(waypoints[i])
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))))
    if (angle < SAME_POINT_RAD) continue
    let axis = cross(a, b)
    if (Math.hypot(...axis) < SAME_POINT_RAD) axis = cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])
    // a and ortho span the leg's plane: p(φ) = a cos φ + ortho sin φ.
    const ortho = norm(cross(norm(axis), a))
    const steps = Math.max(1, Math.ceil(angle / (stepDeg * RAD) - 1e-9))
    for (let s = 1; s <= steps; s++) {
      const phi = (angle * s) / steps
      out.push(
        s === steps
          ? waypoints[i]
          : toCoordinate([
              a[0] * Math.cos(phi) + ortho[0] * Math.sin(phi),
              a[1] * Math.cos(phi) + ortho[1] * Math.sin(phi),
              a[2] * Math.cos(phi) + ortho[2] * Math.sin(phi),
            ]),
      )
    }
    a = b
  }
  return out
}

/**
 * The track in window pixels, unbroken across 180°: each point takes the
 * copy of its longitude nearest the one before, so the line never jumps
 * the width of the planet. Draw it again a planet's width either side.
 */
export function trackOnScreen(view: MapView, size: MapSize, track: readonly MarsCoordinate[]): { x: number; y: number }[] {
  if (track.length === 0) return []
  const first = coordinateToScreen(view, size, track[0])
  const out = [first]
  let x = first.x
  for (let i = 1; i < track.length; i++) {
    let dLon = wrapLongitude(track[i].longitudeEast - track[i - 1].longitudeEast)
    if (dLon > 180) dLon -= 360
    x += dLon * view.pxPerDeg
    out.push({ x, y: size.height / 2 - (track[i].latitude - view.centre.latitude) * view.pxPerDeg })
  }
  return out
}

/** The pin's head: a circle this far above the tip, CSS px. */
const PIN_HEAD_UP_PX = 11
const PIN_HEAD_R_PX = 4.5
/** How near the pointer must be to a pin's tip or head to pick it, CSS px. */
export const PIN_HIT_PX = 8

/** The pin under a point in the window, the topmost (last drawn) first, or null. */
export function pinAt(view: MapView, size: MapSize, pins: readonly MapPin[], x: number, y: number): MapPin | null {
  for (let i = pins.length - 1; i >= 0; i--) {
    const tip = coordinateToScreen(view, size, pins[i].coordinate)
    if (Math.hypot(x - tip.x, y - tip.y) <= PIN_HIT_PX || Math.hypot(x - tip.x, y - (tip.y - PIN_HEAD_UP_PX)) <= PIN_HIT_PX) {
      return pins[i]
    }
  }
  return null
}

/**
 * The rover's driven path, under the route: solid in the traverse
 * colour over a dark edge, where the route is white and dotted. Waypoints
 * are joined straight, as on the globe; up to 0.40 km apart on the feed read 2026-11-01,
 * which shows on the 5 km map, so the map's caption says so.
 */
export function drawTraverse(
  ctx: CanvasRenderingContext2D,
  view: MapView,
  size: MapSize,
  path: readonly MarsCoordinate[],
): void {
  strokeLine(ctx, trackOnScreen(view, size, path), 360 * view.pxPerDeg, [
    { style: EDGE, width: 4.5, dash: [] },
    { style: cssColor(TRAVERSE_COLOR), width: 2.5, dash: [] },
  ])
}

/** What the map draws of a walk plan, and the mark its legend carries. */
export interface WalkOnMap {
  /** Each leg's own path. A leg with an UNAVAILABLE path, or under two points, has none: joining its stops would show a line nobody planned. */
  paths: readonly (readonly MarsCoordinate[])[]
  /** Every stop, in walking order, whether or not a line reaches it. */
  stops: readonly MarsCoordinate[]
  /**
   * The class and method or source of the first path drawn; null with none drawn. It speaks for
   * them all: a plan's legs share one class today, the planner's DERIVED or the sample's SIMULATED.
   */
  mark: { classification: Exclude<DataClassification, 'UNAVAILABLE'>; detail: string } | null
}

export const NO_WALK: WalkOnMap = { paths: [], stops: [], mark: null }

export function walkOnMap(plan: WalkPlan | null): WalkOnMap {
  if (plan === null) return NO_WALK
  const drawn = plan.legs.flatMap(({ path }) => (isAvailable(path) && path.value.length > 1 ? [path] : []))
  const first = drawn.at(0)
  return {
    paths: drawn.map((p) => p.value),
    stops: plan.stops.map((s) => s.coordinate),
    mark:
      first === undefined
        ? null
        : { classification: first.classification, detail: first.classification === 'DERIVED' ? first.method : first.source },
  }
}

/**
 * The planned walk, over the rover's path and under the pins: dashed
 * white as on the ground, where the route line is dotted and the rover solid.
 * Each stop is a white dot. Off-screen stops cost nothing, so none are skipped.
 */
export function drawWalk(ctx: CanvasRenderingContext2D, view: MapView, size: MapSize, walk: WalkOnMap): void {
  for (const path of walk.paths) {
    strokeLine(ctx, trackOnScreen(view, size, path), 360 * view.pxPerDeg, [
      { style: EDGE, width: 4, dash: [] },
      { style: '#ffffff', width: 2, dash: [7, 5] },
    ])
  }
  ctx.save()
  ctx.setLineDash([])
  ctx.lineWidth = 1.5
  ctx.strokeStyle = EDGE
  ctx.fillStyle = '#ffffff'
  for (const stop of walk.stops) {
    const { x, y } = coordinateToScreen(view, size, stop)
    ctx.beginPath()
    ctx.arc(x, y, STOP_R_PX, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

const EDGE = 'rgba(0, 0, 0, 0.6)'
const STOP_R_PX = 4

/** One line in each planet copy, every pass of it in turn: a dark edge first, then the line. */
function strokeLine(
  ctx: CanvasRenderingContext2D,
  line: readonly { x: number; y: number }[],
  planet: number,
  passes: readonly { style: string; width: number; dash: number[] }[],
): void {
  if (line.length < 2) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const n of [-1, 0, 1]) {
    for (const { style, width, dash } of passes) {
      ctx.strokeStyle = style
      ctx.lineWidth = width
      ctx.setLineDash(dash)
      ctx.beginPath()
      line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x + n * planet, p.y) : ctx.lineTo(p.x + n * planet, p.y)))
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** The route line, then the pins, then (expanded) the marked points' names. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  view: MapView,
  size: MapSize,
  pins: readonly MapPin[],
  track: readonly MarsCoordinate[],
  showNames: boolean,
): void {
  // Dark underneath, then a white dotted line, as the globe's trail.
  strokeLine(ctx, trackOnScreen(view, size, track), 360 * view.pxPerDeg, [
    { style: EDGE, width: 3.5, dash: [] },
    { style: '#ffffff', width: 1.5, dash: [1, 5] },
  ])
  for (const pin of pins) {
    const tip = coordinateToScreen(view, size, pin.coordinate)
    if (tip.x < -20 || tip.x > size.width + 20 || tip.y < -20 || tip.y > size.height + 20) continue
    drawPin(ctx, tip.x, tip.y, cssColor(pin.color ?? ROUTE_PIN_COLOR[pin.kind]))
    if (showNames && pin.kind === 'marked') {
      ctx.save()
      ctx.font = '11px system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
      ctx.strokeText(pin.name, tip.x + 8, tip.y - PIN_HEAD_UP_PX)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(pin.name, tip.x + 8, tip.y - PIN_HEAD_UP_PX)
      ctx.restore()
    }
  }
}

/** A teardrop pin with its tip on the point, in the role colour with a dark rim, as on the globe. */
function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const hy = y - PIN_HEAD_UP_PX
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - PIN_HEAD_R_PX * 0.8, hy + PIN_HEAD_R_PX * 0.6)
  ctx.arc(x, hy, PIN_HEAD_R_PX, Math.PI * 0.8, Math.PI * 0.2)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, hy, 1.5, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.fill()
  ctx.restore()
}
