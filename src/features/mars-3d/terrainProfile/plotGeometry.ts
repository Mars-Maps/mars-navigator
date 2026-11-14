import type { PlanePoint, TerrainSurface } from '../../route-analysis/terrainProfileGrid'

/**
 * The Terrain Profile 3D plot's geometry, pure and tested: the
 * heightfield's vertices, colours and triangles from a surface, the frame
 * and ticks of its axes, and the vertical exaggeration printed on it. Plot
 * space is km: x east, y up (height above the lowest sample, exaggerated),
 * z south, so north runs away from a camera south of the box.
 */

/** Exaggerations the plot picks from; ×1 is true scale. */
export const EXAGGERATIONS = [1, 2, 5, 10, 20, 50, 100] as const

/** The exaggerated relief aims at this share of the box's longer side, so a plain is not a sheet and a cliff is not a wall. */
const RELIEF_SHARE = 0.3

/**
 * The vertical exaggeration for a box `sizeKm` across with `reliefM` of
 * relief: the largest of EXAGGERATIONS that keeps the drawn relief within
 * RELIEF_SHARE of the longer side, never under ×1, so the ground is never
 * flattened, only stretched, and the figure printed is always one of a few
 * round numbers. Flat ground is drawn at ×1.
 */
export function verticalExaggeration(sizeKm: PlanePoint, reliefM: number): number {
  const target = RELIEF_SHARE * Math.max(sizeKm.x, sizeKm.y)
  const reliefKm = reliefM / 1000
  if (!(reliefKm > 0) || !(target > 0)) return 1
  let pick: number = EXAGGERATIONS[0]
  for (const e of EXAGGERATIONS) if (reliefKm * e <= target) pick = e
  return pick
}

export interface HeightfieldArrays {
  /** xyz per node, plot km; a hole sits at the floor, outside every triangle. */
  positions: Float32Array
  /** rgb per node: the height ramp inside the quadrilateral, dimmed outside. */
  colors: Float32Array
  /** Triangles, three node indices each; none touches a hole. */
  indices: Uint32Array
  /** The drawn relief, km (exaggerated). */
  heightKm: number
}

/**
 * The height ramp, sRGB 0–1, low to high: dark blue, blue, cyan, green,
 * yellow, orange, red. Many hues over the range, so small steps of height
 * read as different colours and the plot's resolution shows; the ends are
 * the usual lowest-blue, highest-red of an elevation map.
 */
export const HEIGHT_RAMP: readonly (readonly [number, number, number])[] = [
  [0.04, 0.09, 0.4],
  [0.1, 0.35, 0.85],
  [0.13, 0.75, 0.85],
  [0.25, 0.75, 0.3],
  [0.95, 0.85, 0.2],
  [0.95, 0.5, 0.1],
  [0.85, 0.12, 0.1],
]

/** The ramp's colour at `t` in [0, 1], interpolated between its stops. */
export function rampColor(t: number): [number, number, number] {
  const n = HEIGHT_RAMP.length - 1
  const x = Math.min(1, Math.max(0, t)) * n
  const i = Math.min(n - 1, Math.floor(x))
  const f = x - i
  const a = HEIGHT_RAMP[i]
  const b = HEIGHT_RAMP[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}
/** Nodes outside the quadrilateral keep this much of their colour, the rest the canvas's dark. */
const OUTSIDE_KEEP = 0.35
const CANVAS_RGB = [0.07, 0.075, 0.085] as const

/**
 * The heightfield for a surface at `exaggeration`: one vertex per node at
 * (xKm, (h − min) · e / 1000, −yKm), coloured by height; two triangles per
 * cell on the same diagonal as Three's PlaneGeometry, less any triangle
 * touching a hole, so a hole is a gap, not a dip to the floor.
 */
export function heightfieldArrays(surface: TerrainSurface, exaggeration: number): HeightfieldArrays {
  const { grid, heightsM, rangeM } = surface
  const { columns, rows, nodes } = grid
  const count = nodes.length
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const relief = rangeM.max - rangeM.min
  const scale = exaggeration / 1000
  for (let i = 0; i < count; i++) {
    const node = nodes[i]
    const h = heightsM[i]
    const hole = Number.isNaN(h)
    const t = hole || relief === 0 ? 0 : (h - rangeM.min) / relief
    positions[i * 3] = node.xKm
    positions[i * 3 + 1] = hole ? 0 : (h - rangeM.min) * scale
    positions[i * 3 + 2] = -node.yKm
    const ramp = rampColor(t)
    for (let k = 0; k < 3; k++) {
      colors[i * 3 + k] = node.inside ? ramp[k] : CANVAS_RGB[k] + (ramp[k] - CANVAS_RGB[k]) * OUTSIDE_KEEP
    }
  }
  const tris: number[] = []
  const solid = (i: number) => !Number.isNaN(heightsM[i])
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = r * columns + c // south-west
      const b = a + 1 // south-east
      const d = a + columns // north-west
      const e = d + 1 // north-east
      // Counter-clockwise seen from above (+y), so the face normal points up.
      if (solid(a) && solid(b) && solid(e)) tris.push(a, b, e)
      if (solid(a) && solid(e) && solid(d)) tris.push(a, e, d)
    }
  }
  return { positions, colors, indices: Uint32Array.from(tris), heightKm: relief * scale }
}

/** Where a tick sits and what it says. */
export interface Tick {
  /** Along the axis, in the axis's own unit. */
  at: number
  label: string
}

/** Tick steps, in the axis's unit, chosen so an axis has 2 to 6 ticks. */
// Down to 10 m: the contract allows corners metres apart.
const STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

/**
 * Round-number ticks between `from` and `to` inclusive: the smallest step
 * that gives at most `most` ticks, labelled with no trailing zeros. An
 * empty list for a span of nothing.
 */
export function axisTicks(from: number, to: number, most = 6): Tick[] {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  if (!(hi - lo > 0)) return []
  const step = STEPS.find((s) => Math.floor(hi / s) - Math.ceil(lo / s) + 1 <= most) ?? STEPS[STEPS.length - 1]
  const ticks: Tick[] = []
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9; k++) {
    const at = k * step
    ticks.push({ at: Math.abs(at) < 1e-12 ? 0 : at, label: tickLabel(at, step) })
  }
  return ticks
}

function tickLabel(value: number, step: number): string {
  const decimals = step < 1 ? Math.ceil(-Math.log10(step)) : 0
  const v = Math.abs(value) < 1e-12 ? 0 : value
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

/** A tick mark's length as a share of the box's longer side; the labels sit at the marks' outer ends. */
const TICK_SHARE = 0.03

/** The box's edges in plot space and the tick mark length, shared by the frame and the anchors. */
function box(surface: TerrainSurface) {
  const { originKm: o, sizeKm: s } = surface.grid
  return {
    x0: o.x,
    x1: o.x + s.x,
    z0: -o.y, // the south edge
    z1: -(o.y + s.y), // the north edge
    tick: TICK_SHARE * Math.max(s.x, s.y),
  }
}

/**
 * The box's frame as line segments, plot km: the floor's four edges, the
 * vertical axis at the south-west corner up to the drawn relief, and tick
 * marks pointing outward: the x ticks south off the south edge, the y ticks
 * east off the east edge, and the lowest and highest heights west off the
 * vertical axis.
 */
export function frameSegments(surface: TerrainSurface, heightKm: number): Float32Array {
  const { x0, x1, z0, z1, tick } = box(surface)
  const { originKm: o, sizeKm: s } = surface.grid
  const out: number[] = [
    x0, 0, z0, x1, 0, z0,
    x1, 0, z0, x1, 0, z1,
    x1, 0, z1, x0, 0, z1,
    x0, 0, z1, x0, 0, z0,
    x0, 0, z0, x0, heightKm, z0,
  ]
  for (const t of axisTicks(x0, x1)) out.push(t.at, 0, z0, t.at, 0, z0 + tick)
  for (const t of axisTicks(o.y, o.y + s.y)) out.push(x1, 0, -t.at, x1 + tick, 0, -t.at)
  for (const y of heightKm > 0 ? [0, heightKm] : [0]) out.push(x0, y, z0, x0 - tick, y, z0)
  return Float32Array.from(out)
}

/** A label's anchor in plot space, and its text. */
export interface Anchor {
  x: number
  y: number
  z: number
  text: string
  /** Which label it is: an x or y tick, the lowest or highest height, a corner number, or an axis name. */
  kind: 'x' | 'y' | 'zlow' | 'zhigh' | 'corner' | 'axis'
}

/** Corner numbers sit this share of the box's longer side outside their corner, so they never cover the ground there. */
const CORNER_OUT_SHARE = 0.05

/**
 * Every label the plot shows, in plot km, each at the outer end of its tick
 * mark: x ticks along the south edge, y ticks along the east edge, the
 * lowest and highest heights in metres at the floor and the top of the
 * vertical axis (the true extremes, as the profile chart labels them), the
 * corners numbered 1–4 in the order marked, just outside their corner at the
 * nearest node's height, and the axes' names past their ends.
 */
export function plotAnchors(surface: TerrainSurface, exaggeration: number, heightKm: number): Anchor[] {
  const { grid, heightsM, rangeM } = surface
  const { originKm: o, sizeKm: s } = grid
  const { x0, x1, z0, z1, tick } = box(surface)
  const out: Anchor[] = []
  for (const t of axisTicks(x0, x1)) out.push({ x: t.at, y: 0, z: z0 + tick, text: t.label, kind: 'x' })
  for (const t of axisTicks(o.y, o.y + s.y)) out.push({ x: x1 + tick, y: 0, z: -t.at, text: t.label, kind: 'y' })
  out.push({ x: x0 - tick, y: 0, z: z0, text: metres(rangeM.min), kind: 'zlow' })
  if (heightKm > 0) out.push({ x: x0 - tick, y: heightKm, z: z0, text: metres(rangeM.max), kind: 'zhigh' })
  const centre = { x: o.x + s.x / 2, y: o.y + s.y / 2 }
  const outKm = CORNER_OUT_SHARE * Math.max(s.x, s.y)
  grid.cornersKm.forEach((c, k) => {
    const i = nearestNode(surface, c)
    const h = heightsM[i]
    const y = Number.isNaN(h) ? heightKm : ((h - rangeM.min) * exaggeration) / 1000
    const away = Math.hypot(c.x - centre.x, c.y - centre.y) || 1
    const dx = ((c.x - centre.x) / away) * outKm
    const dy = ((c.y - centre.y) / away) * outKm
    out.push({ x: c.x + dx, y, z: -(c.y + dy), text: String(k + 1), kind: 'corner' })
  })
  out.push({ x: x1, y: 0, z: z0 + tick, text: 'x east, km', kind: 'axis' })
  out.push({ x: x1 + tick, y: 0, z: z1, text: 'y north, km', kind: 'axis' })
  out.push({ x: x0, y: heightKm, z: z0, text: `z, m (×${exaggeration})`, kind: 'axis' })
  return out
}

function metres(m: number): string {
  return `${Math.round(m).toLocaleString('en-US')} m`
}

/** The node nearest a point of the frame, by index. */
export function nearestNode(surface: TerrainSurface, p: PlanePoint): number {
  const { columns, rows, originKm, spacingKm } = surface.grid
  const c = Math.max(0, Math.min(columns - 1, Math.round((p.x - originKm.x) / spacingKm.x)))
  const r = Math.max(0, Math.min(rows - 1, Math.round((p.y - originKm.y) / spacingKm.y)))
  return r * columns + c
}

/** Where the camera starts: south-east of the box and above it, far enough to see it whole at `fovDeg`. */
export function cameraStart(surface: TerrainSurface, heightKm: number, fovDeg: number): { position: [number, number, number]; target: [number, number, number] } {
  const { originKm: o, sizeKm: s } = surface.grid
  const target: [number, number, number] = [o.x + s.x / 2, heightKm / 2, -(o.y + s.y / 2)]
  const radius = Math.hypot(s.x, s.y, heightKm) / 2
  // Seen obliquely the box projects well inside its bounding sphere, so the camera sits closer than the sphere's fit.
  const distance = (radius / Math.tan((fovDeg * Math.PI) / 360)) * 1.05
  const dir = [0.6, 0.5, 0.65] as const
  const len = Math.hypot(...dir)
  return {
    position: [target[0] + (dir[0] / len) * distance, target[1] + (dir[1] / len) * distance, target[2] + (dir[2] / len) * distance],
    target,
  }
}
