/**
 * Datum check: our elevation models' heights against the rovers' own
 * heights (`elev_geoid`, metres above the MOLA areoid) at every waypoint of
 * NASA's live rover feeds, through the app's own adapters, so the figures
 * are of what the app shows. A one-off report, not part of the app.
 *
 * Run: npm run datum-check (bundles this file, then runs it with Node).
 * The bundler is `rolldown`, reached as Vite 8's own dependency rather than
 * a direct one (no new dependency); if Vite stops shipping it, the npm
 * script needs another bundler.
 * Prints a Markdown table per rover and model to stdout. Differences are
 * model minus rover: positive means our model stands higher than the rover.
 * DERIVED: nearest-cell model heights (OFFICIAL, USGS) less feed heights
 * (OFFICIAL, NASA/JPL-Caltech), with no correction of either.
 */
import { isAvailable, type RoverId, type TraversePoint } from '../src/domain'
import { DemElevationAdapter } from '../src/data/adapters/ElevationAdapter'
import { loadRoverTraverse } from '../src/data/adapters/TraverseAdapter'
import { gridCovers } from '../src/data/elevation/demGrid'
import { ELEVATION_CHAIN, type DemSource } from '../src/data/elevation/demSources'

interface Row {
  rover: RoverId
  model: string
  cellM: string
  compared: number
  /** Waypoints outside a regional model's box. */
  outside: number
  /** Waypoints inside the box on a no-data cell. */
  noData: number
  median: number
  medianAbs: number
  p95Abs: number
  /** Share of compared waypoints within 0.5 m: near 1 suggests the feed's heights share this model's source. */
  within05: number
  worst: { diff: number; point: TraversePoint } | null
}

const ROVERS: readonly RoverId[] = ['perseverance', 'curiosity']

/** The value at fraction `q` of the sorted list, nearest rank: for an even count the median is the lower middle value. */
function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
}

async function compare(rover: RoverId, points: readonly TraversePoint[], source: DemSource): Promise<Row | string> {
  const pairs = new Float64Array(points.length * 2)
  points.forEach((p, i) => {
    pairs[i * 2] = p.coordinate.latitude
    pairs[i * 2 + 1] = p.coordinate.longitudeEast
  })
  const heights = await new DemElevationAdapter(source).elevationsAt(pairs, new AbortController().signal)
  if (!isAvailable(heights)) return `${source.label}: ${heights.reason}`
  const diffs: { diff: number; point: TraversePoint }[] = []
  points.forEach((point, i) => {
    const model = heights.value[i]
    if (Number.isFinite(model) && isAvailable(point.elevationMeters)) diffs.push({ diff: model - point.elevationMeters.value, point })
  })
  const sorted = diffs.map((d) => d.diff).sort((a, b) => a - b)
  const abs = diffs.map((d) => Math.abs(d.diff)).sort((a, b) => a - b)
  const worst = diffs.reduce<Row['worst']>((w, d) => (w === null || Math.abs(d.diff) > Math.abs(w.diff) ? d : w), null)
  return {
    rover,
    model: source.label,
    cellM: source.resolution.classification === 'UNAVAILABLE' ? '?' : source.resolution.value,
    compared: diffs.length,
    outside: points.filter((p) => !gridCovers(source, p.coordinate.latitude, p.coordinate.longitudeEast)).length,
    noData: points.filter((p, i) => gridCovers(source, p.coordinate.latitude, p.coordinate.longitudeEast) && !Number.isFinite(heights.value[i])).length,
    median: sorted.length ? quantile(sorted, 0.5) : NaN,
    medianAbs: abs.length ? quantile(abs, 0.5) : NaN,
    p95Abs: abs.length ? quantile(abs, 0.95) : NaN,
    within05: abs.length ? abs.filter((a) => a <= 0.5).length / abs.length : NaN,
    worst,
  }
}

const m = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : '–')

async function main() {
  const rows: Row[] = []
  const notes: string[] = []
  for (const rover of ROVERS) {
    const traverse = await loadRoverTraverse(rover, new AbortController().signal)
    if (!isAvailable(traverse)) {
      notes.push(`${rover}: ${traverse.reason}`)
      continue
    }
    const all = traverse.value.points
    const withHeight = all.filter((p) => isAvailable(p.elevationMeters))
    notes.push(
      `${rover}: ${all.length} waypoints read ${new Date(traverse.value.retrievedUtcMs).toISOString()} from ${traverse.value.source}, sols ${all[0]?.sol}–${all.at(-1)?.sol}; ${all.length - withHeight.length} without a height (-9999 or missing)`,
    )
    for (const source of ELEVATION_CHAIN) {
      const row = await compare(rover, withHeight, source)
      if (typeof row === 'string') notes.push(`${rover}: ${row}`)
      else {
        if (row.compared > 0) rows.push(row)
        notes.push(`${rover}, ${source.label}: ${row.compared} compared, ${row.outside} outside its box, ${row.noData} on no-data cells`)
      }
    }
  }
  console.log('| Rover | Model | Waypoints compared | Median (model − rover) | Median abs. | 95th pct abs. | Within 0.5 m | Worst (sol, site/drive) |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const r of rows) {
    const w = r.worst ? `${m(r.worst.diff)} m (sol ${r.worst.point.sol}, ${r.worst.point.rmc.site}/${r.worst.point.rmc.drive})` : '–'
    console.log(`| ${r.rover} | ${r.model} (${r.cellM}) | ${r.compared} | ${m(r.median)} m | ${m(r.medianAbs).replace('+', '')} m | ${m(r.p95Abs).replace('+', '')} m | ${Math.round(r.within05 * 100)}% | ${w} |`)
  }
  console.log('')
  for (const n of notes) console.log(`- ${n}`)
}

// A failure rejects the module, so Node exits non-zero.
await main()
