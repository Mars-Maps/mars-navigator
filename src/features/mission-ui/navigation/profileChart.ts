import { isAvailable } from '../../../domain'
import type { HoveredRoutePoint } from '../../../state'
import type { ElevationProfileSample } from '../../route-analysis/elevationProfile'
import { slopeBand, slopeDegrees, type SlopeBand } from '../../route-analysis/profileSlope'

export interface ChartPoint {
  km: number
  m: number
}

/**
 * Runs of consecutive samples that have an elevation. An UNAVAILABLE sample
 * ends the run: the chart never joins across it or invents a value for it.
 */
export function splitAtGaps(samples: readonly ElevationProfileSample[]): ChartPoint[][] {
  const segments: ChartPoint[][] = []
  let current: ChartPoint[] = []
  for (const sample of samples) {
    const e = sample.elevationMeters
    if (isAvailable(e)) {
      current.push({ km: sample.distanceKm, m: e.value })
    } else if (current.length > 0) {
      segments.push(current)
      current = []
    }
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/** A run of consecutive stretches in one slope band, sharing its end points with its neighbours. */
export interface BandRun {
  band: SlopeBand | null
  points: ChartPoint[]
}

/**
 * A segment cut into runs by the band of each stretch between consecutive
 * points, so the chart draws each run in its band's colour. A run's
 * last point is the next run's first, so the line stays joined; a segment
 * of one point has no stretch and gives no run.
 */
export function splitByBand(segment: readonly ChartPoint[]): BandRun[] {
  const runs: BandRun[] = []
  for (let i = 1; i < segment.length; i++) {
    const a = segment[i - 1]
    const b = segment[i]
    const band = slopeBand(slopeDegrees(b.m - a.m, b.km - a.km))
    const last = runs.at(-1)
    if (last && last.band === band) last.points.push(b)
    else runs.push({ band, points: [a, b] })
  }
  return runs
}

/**
 * Lowest and highest elevation actually present in the segments, or null if
 * there are none. A loop, not Math.min(...spread), so length has no ceiling.
 */
export function elevationExtent(
  segments: readonly ChartPoint[][],
): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const segment of segments) {
    for (const p of segment) {
      if (p.m < min) min = p.m
      if (p.m > max) max = p.m
    }
  }
  return min === Infinity ? null : { min, max }
}

/**
 * Index of the sample nearest `km` along the route, or -1 if there are none.
 * Snaps to a real sample, gap or not; the chart never reads out a value
 * between two samples. A tie goes to the earlier sample.
 */
export function nearestSampleIndex(
  samples: readonly ElevationProfileSample[],
  km: number,
): number {
  let best = -1
  let bestDistance = Infinity
  for (let i = 0; i < samples.length; i++) {
    const d = Math.abs(samples[i].distanceKm - km)
    if (d < bestDistance) {
      best = i
      bestDistance = d
    }
  }
  return best
}

/**
 * Index of the sample under a pointer `offsetPx` from the chart's left edge,
 * on a chart `widthPx` wide that spans `totalDistanceKm`. -1 if the chart
 * has no width yet or there are no samples.
 */
export function sampleIndexAtPointer(
  samples: readonly ElevationProfileSample[],
  totalDistanceKm: number,
  offsetPx: number,
  widthPx: number,
): number {
  if (!(widthPx > 0)) return -1
  return nearestSampleIndex(samples, (offsetPx / widthPx) * totalDistanceKm)
}

/**
 * The route point a sample stands for: its coordinate and its
 * distance from the departure. A gap is still a place on the route, so it
 * has a point too, only no elevation.
 */
export function routePointOf(sample: ElevationProfileSample | null): HoveredRoutePoint | null {
  return sample ? { coordinate: sample.coordinate, distanceKm: sample.distanceKm } : null
}

/**
 * The sample an arrow key moves to, clamped to the route. With nothing
 * selected, → starts at the first sample and ← at the last. -1 if there are
 * no samples.
 */
export function stepIndex(index: number | null, delta: number, count: number): number {
  if (count === 0) return -1
  if (index === null) return delta < 0 ? count - 1 : 0
  return Math.min(count - 1, Math.max(0, index + delta))
}
