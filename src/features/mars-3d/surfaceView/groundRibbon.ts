import { ribbon, type PlotVertex, type RibbonArrays } from '../terrainProfile/routeLine'
import { sampleHeight, type Heightfield } from './heightfield'

/**
 * The vertex pairs of `drapedSegments` joined back into polylines: a pair
 * that starts where the one before ended continues it, any other starts a
 * new one (a new leg, or the line re-entering the patch). The pairs repeat
 * the shared vertex exactly, so the test is equality. Pure.
 */
export function joinSegments(pairs: Float32Array): PlotVertex[][] {
  const out: PlotVertex[][] = []
  let line: PlotVertex[] = []
  for (let j = 0; j + 5 < pairs.length; j += 6) {
    const a: PlotVertex = [pairs[j], pairs[j + 1], pairs[j + 2]]
    const b: PlotVertex = [pairs[j + 3], pairs[j + 4], pairs[j + 5]]
    const last = line[line.length - 1]
    if (!last || last[0] !== a[0] || last[1] !== a[1] || last[2] !== a[2]) {
      if (line.length > 1) out.push(line)
      line = [a]
    }
    line.push(b)
  }
  if (line.length > 1) out.push(line)
  return out
}

/**
 * The polylines cut into dashes `dashM` long with `gapM` between, measured
 * along the line in 3D so a dash keeps its length on a slope. The pattern
 * runs on from one polyline to the next, as a dashed material's would; `phaseM`
 * shifts it, so two dashed lines on the same path can fill each other's
 * gaps. Each dash keeps the polyline's own vertices inside it, so it still
 * follows the ground. Pure.
 */
export function dashLines(
  lines: readonly (readonly PlotVertex[])[],
  dashM: number,
  gapM: number,
  phaseM = 0,
): PlotVertex[][] {
  const period = dashM + gapM
  const out: PlotVertex[][] = []
  let dash: PlotVertex[] | null = null
  const finish = () => {
    if (dash && dash.length > 1) out.push(dash)
    dash = null
  }
  let along = 0
  for (const line of lines) {
    finish()
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]
      const b = line[i]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      const at = (t: number): PlotVertex => {
        const f = len > 0 ? t / len : 0
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
      }
      let t = 0
      while (t < len) {
        const u = (((along + t + phaseM) % period) + period) % period
        const on = u < dashM
        // A hair past t at least, so rounding can never stall the walk.
        const next = Math.min(len, Math.max(t + 1e-6, t + (on ? dashM - u : period - u)))
        if (on) {
          if (!dash) dash = [at(t)]
          dash.push(at(next))
          if (next < len) finish()
        } else finish()
        t = next
      }
      along += len
    }
  }
  finish()
  return out
}

/**
 * A flat ribbon `widthM` wide along the polylines, lying on the surface
 * view's ground: `ribbon` from Terrain Profile 3D lays the
 * width across each step in the horizontal plane (x east, z south), then
 * every vertex, the two edges included, takes the drawn height under it
 * plus `liftM`, so the ribbon lies on a side slope instead of cutting into
 * it on one edge. Pure.
 */
export function groundRibbon(
  lines: readonly (readonly PlotVertex[])[],
  field: Heightfield,
  widthM: number,
  liftM: number,
): RibbonArrays {
  const r = ribbon(lines, widthM)
  const p = r.positions
  // Ground metres: z is south, the field's y is north.
  for (let i = 0; i < p.length; i += 3) p[i + 1] = sampleHeight(field, p[i], -p[i + 2]) + liftM
  return r
}
