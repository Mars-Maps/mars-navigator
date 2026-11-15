import { describe, expect, it } from 'vitest'
import { SUITED_SLOPE_LIMIT, isAvailable, type RouteRequest } from '../../src/domain'
import { segmentCrossing } from '../../src/features/route-analysis/mappedObstacles'
import { FASTEST_PENDING_REASON, fastest, fastestStepHours, planFastest } from '../../src/features/route-analysis/strategies/fastest'
import { MAX_SEARCH_CELLS, searchLeg } from '../../src/features/route-analysis/terrainSearch'
import { SUITED_MAX_KMH } from '../../src/features/route-analysis/walkingSpeed'
import { KM_PER_DEG_LON, at, fixtureTerrain, line, xyOf } from './terrain.helpers'

const signal = new AbortController().signal
const request = (stops: [number, number][] = [], end: [number, number] = [1, 0]): RouteRequest => ({
  departure: at(0, 0),
  destination: at(...end),
  stops: stops.map(([x, y]) => at(x, y)),
})
const flat = () => 0
/** A 200 m wall across x = 0.5 km, between y = −0.49 and 0.49 km: its edges off the lattice's lines. */
const wall = (x: number, y: number) => (Math.abs(x - 0.5) < 0.09 && Math.abs(y) < 0.49 ? 200 : 0)
const OPTIONS = { cost: fastestStepHours, minCostPerKm: 1 / SUITED_MAX_KMH, blocked: 'the fixture' }

async function plan(z: (x: number, y: number) => number, req = request(), options = {}) {
  const terrain = fixtureTerrain(z, options)
  const option = await planFastest(req, terrain, signal)
  return { option, terrain }
}

/** The path's UNAVAILABLE reason; fails when a path was drawn. */
function reasonOf(option: Awaited<ReturnType<typeof plan>>['option']): string {
  if (isAvailable(option.path)) throw new Error('A path was drawn')
  return option.path.reason
}

function drawn(option: Awaited<ReturnType<typeof plan>>['option']) {
  if (!isAvailable(option.path) || !isAvailable(option.metrics.distanceKm) || !isAvailable(option.metrics.durationHours)) {
    throw new Error(`Not drawn: ${!isAvailable(option.path) ? option.path.reason : 'metric missing'}`)
  }
  return {
    path: option.path.value,
    xy: option.path.value.map((p) => xyOf(p.coordinate)),
    km: option.metrics.distanceKm.value,
    hours: option.metrics.durationHours.value,
    method: option.path.classification === 'DERIVED' ? option.path.method : '',
  }
}

describe('fastest plan() before the search', () => {
  it('says the route is being planned, with no path and no figures', () => {
    const option = fastest.plan(request())
    expect(option.path).toEqual({ classification: 'UNAVAILABLE', reason: FASTEST_PENDING_REASON })
    expect(option.metrics.distanceKm).toEqual({ classification: 'UNAVAILABLE', reason: FASTEST_PENDING_REASON })
    expect(option.metrics.durationHours).toEqual({ classification: 'UNAVAILABLE', reason: FASTEST_PENDING_REASON })
    expect(isAvailable(option.metrics.metabolicEnergyKcal)).toBe(false)
    expect(fastest.planOnTerrain).toBe(planFastest)
  })
})

describe('planFastest on a fixture DEM', () => {
  it('walks a flat leg straight, 1 km in half an hour at 2 km/h, DERIVED with the sources', async () => {
    const { option, terrain } = await plan(flat)
    const { xy, km, hours, method, path } = drawn(option)
    for (const p of xy) expect(Math.abs(p.y)).toBeLessThan(0.011)
    expect(xy[0]).toEqual({ x: 0, y: 0 })
    expect(xy.at(-1)?.x).toBeCloseTo(1, 6)
    expect(km).toBeCloseTo(1, 1)
    expect(hours).toBeCloseTo(0.5, 1)
    expect(method).toMatch(/A\* search over an 8-connected lattice of nearest-cell heights about one model cell apart \(20 m north–south, 19 m east–west/)
    expect(method).toMatch(/Tobler/)
    expect(method).toMatch(/EVA-EXP-0075/)
    expect(method).toMatch(/Heights: fixture DEM/)
    expect(method).toMatch(new RegExp(`over ${SUITED_SLOPE_LIMIT.deg}°`))
    for (const p of path) expect(p.elevationMeters).toEqual({ classification: 'OFFICIAL', value: 0, source: 'fixture DEM' })
    expect(option.points.map((p) => p.coordinate)).toEqual([at(0, 0), at(1, 0)])
    // The same path priced by the metabolic model too: about 46 kcal for a level kilometre.
    expect(option.metrics.metabolicEnergyKcal).toMatchObject({ classification: 'DERIVED' })
    if (isAvailable(option.metrics.metabolicEnergyKcal)) expect(option.metrics.metabolicEnergyKcal.value).toBeCloseTo(45.7, 0)
    expect(terrain.reads).toHaveLength(1)
    expect(terrain.reads[0]).toBeLessThan(MAX_SEARCH_CELLS)
  })

  it('walks a flat leg off the lattice headings up to about 9% longer at this latitude, and says so', async () => {
    const straight = Math.hypot(1, 0.577)
    const { km, hours, method } = drawn((await plan(flat, request([], [1, 0.577]))).option) // 30° off east
    expect(km).toBeGreaterThan(straight)
    expect(km).toBeLessThan(straight * 1.09)
    expect(hours).toBeCloseTo(km / 2, 1)
    expect(method).toMatch(/up to about 9% longer than the straight line/) // 8% on a square lattice; the columns are 5% closer here
    const diagonal = drawn((await plan(flat, request([], [1, 1]))).option)
    expect(diagonal.km).toBeCloseTo(Math.SQRT2, 1)
  })

  it('is slower uphill and faster on a slight descent, as the model says', async () => {
    const level = drawn((await plan(flat)).option).hours
    const uphill = drawn((await plan((x) => 176 * x)).option).hours // about 10°
    const descent = drawn((await plan((x) => -50 * x)).option).hours // Tobler's −0.05
    expect(uphill).toBeGreaterThan(level)
    expect(descent).toBeLessThan(level)
    expect(descent).toBeCloseTo(1 / SUITED_MAX_KMH, 1)
  })

  it('goes round a wall too steep to climb rather than over it', async () => {
    const { xy, km } = drawn((await plan(wall)).option)
    for (const p of xy) expect(wall(p.x, p.y)).toBe(0)
    expect(km).toBeGreaterThan(1.3)
    expect(km).toBeLessThan(2.5)
    // Every straight stretch between the path's turns stays off the wall too. A diagonal
    // step passes the shared corner of four cells, so the wall is checked half a cell in.
    const inner = (x: number, y: number) => (Math.abs(x - 0.5) < 0.08 && Math.abs(y) < 0.48 ? 200 : 0)
    for (let i = 1; i < xy.length; i++) {
      for (let t = 0; t <= 1; t += 0.05) {
        expect(inner(xy[i - 1].x + (xy[i].x - xy[i - 1].x) * t, xy[i - 1].y + (xy[i].y - xy[i - 1].y) * t)).toBe(0)
      }
    }
  })

  it('goes round a climbable ridge when the way round is quicker, and over one when it is not', async () => {
    // A ridge 1 km wide across the leg, 19° up and down, between y = −0.49 and 0.49 km: walkable, slow.
    const ridge = (x: number, y: number) => (Math.abs(x - 1) < 0.5 && Math.abs(y) < 0.49 ? 344 * (0.5 - Math.abs(x - 1)) : 0)
    const round = drawn((await plan(ridge, request([], [2, 0]))).option)
    for (const p of round.xy) expect(ridge(p.x, p.y)).toBe(0)
    // Diagonally to the ridge's end, along it, diagonally back: about 2.4 km.
    expect(round.km).toBeGreaterThan(2.3)
    // Straight over: 1 km flat at 2 km/h, then 0.5 km up and 0.5 km down at 19°: about 1.9 h.
    expect(round.hours).toBeLessThan(1.6)
    expect(round.hours).toBeGreaterThan(1)
    // The same ridge 20 km wide along y cannot be gone round within the box: the path climbs it.
    const wide = (x: number, y: number) => (Math.abs(x - 1) < 0.5 && Math.abs(y) < 10 ? 344 * (0.5 - Math.abs(x - 1)) : 0)
    const over = drawn((await plan(wide, request([], [2, 0]))).option)
    expect(Math.max(...over.path.map((p) => (isAvailable(p.elevationMeters) ? p.elevationMeters.value : 0)))).toBeGreaterThan(150)
    expect(over.hours).toBeGreaterThan(1.7)
    expect(over.hours).toBeLessThan(2.1)
  })

  it('finds no path through a band too steep to cross, and says what blocked it', async () => {
    const { option } = await plan((x) => (Math.abs(x - 0.5) < 0.1 ? 200 : 0))
    expect(isAvailable(option.path)).toBe(false)
    if (isAvailable(option.path)) return
    expect(option.path.reason).toMatch(/^No path within .* round the leg avoids ground steeper than 20°/)
    expect(option.path.reason).toMatch(/"crest of crater rim"/)
    expect(option.metrics.distanceKm).toEqual({ classification: 'UNAVAILABLE', reason: option.path.reason })
    expect(option.metrics.durationHours).toEqual({ classification: 'UNAVAILABLE', reason: option.path.reason })
  })

  it('never crosses a line the map marks as a crater rim, and goes through its gap', async () => {
    const rim = line('crest of crater rim', [0.507, -5], [0.507, 0.307])
    const { xy, km, method } = drawn((await plan(flat, request(), { lines: [rim] })).option)
    const a = xyOf(rim.path[0])
    const b = xyOf(rim.path[1])
    for (let i = 1; i < xy.length; i++) expect(segmentCrossing(xy[i - 1], xy[i], a, b)).toBeNull()
    expect(Math.max(...xy.map((p) => p.y))).toBeGreaterThan(0.307)
    expect(km).toBeGreaterThan(1.1)
    expect(method).toMatch(/Steps crossing a line the map marks as/)
  })

  it('is blocked by a rim line with no gap, even one along the lattice itself, but not by a line of a kind that is no obstacle', async () => {
    const across = (kind: string, x = 0.507) => line(kind, [x, -5], [x, 5])
    const blocked = (await plan(flat, request(), { lines: [across('crest of crater rim')] })).option
    expect(isAvailable(blocked.path)).toBe(false)
    const onLattice = (await plan(flat, request(), { lines: [across('crest of crater rim', 0.5)] })).option
    expect(isAvailable(onLattice.path)).toBe(false)
    const open = drawn((await plan(flat, request(), { lines: [across('lineament')] })).option)
    expect(open.km).toBeCloseTo(1, 1)
  })

  it('plans on when the map cannot be read, and says the lines were not kept off the path', async () => {
    const { method } = drawn((await plan(flat, request(), { mapFails: 'Map service down' })).option)
    expect(method).toMatch(/Mapped lines were not kept off the path \(leg 1: Map service down\)/)
  })

  it('refuses a stop where no model has a height, departure or destination', async () => {
    const dest = await plan((x) => (x > 0.8 ? Number.NaN : 0))
    expect(reasonOf(dest.option)).toBe('No elevation model has a height at the destination, so there is no ground to search from')
    const dep = await plan((x) => (x < 0.2 ? Number.NaN : 0))
    expect(reasonOf(dep.option)).toMatch(/^No elevation model has a height at the departure/)
  })

  it('searches the global model where there is no site model, at its own cell and budget', async () => {
    const { km, hours, method, path } = drawn((await plan(flat, request([], [5, 0]), { site: false, cellKm: 0.2, readsWhole: false })).option)
    // Each stop snaps to a node up to half a 200 m cell away, so within a few hundred metres.
    expect(km).toBeCloseTo(5, 0)
    expect(hours).toBeCloseTo(2.5, 0)
    expect(method).toMatch(/about one model cell apart \(200 m north–south, 190 m east–west/)
    expect(method).toMatch(/Heights: fixture DEM/)
    expect(path.every((p) => isAvailable(p.elevationMeters))).toBe(true)
  })

  it('coarsens the lattice for a leg too long for the budget, and says so', async () => {
    const terrain = fixtureTerrain(flat, { site: false, cellKm: 0.2, readsWhole: false })
    const option = await planFastest(request([], [300, 300]), terrain, signal)
    const { km, hours, method } = drawn(option)
    expect(terrain.reads[0]).toBeLessThanOrEqual(60_000)
    expect(method).toMatch(/every 7 model cells \(1\.4 km north–south, 1\.3 km east–west at this latitude; the leg is too long for a finer search\), so a slope is a mean over that/)
    const straight = Math.hypot(300, 300)
    expect(km).toBeGreaterThan(straight)
    expect(km).toBeLessThan(straight * 1.09)
    expect(hours).toBeCloseTo(km / 2, 0)
  })

  it('caps the rows of a leg on a model read by row ranges, one request each', async () => {
    const terrain = fixtureTerrain(flat, { site: false, cellKm: 0.2, readsWhole: false })
    const { km, method } = drawn(await planFastest(request([], [0, 300]), terrain, signal))
    // Due north the box is a dozen nodes wide, so 1,500 rows would fit the node budget but not the row cap.
    expect(terrain.reads[0]).toBeLessThanOrEqual(60_000)
    expect(method).toMatch(/every 7 model cells/)
    expect(Number(/\d+ by (\d+) nodes/.exec(method)?.[1])).toBeLessThanOrEqual(250)
    expect(Math.abs(km - 300)).toBeLessThan(1.5)
  })

  it('does not walk ground only a model coarser than the lattice covers', async () => {
    // A 20 m site model ending at x = 0.5 km with a ridge across it; flat 200 m ground beyond, as the global DEM past a site model's edge.
    const edged = (x: number, y: number) => (x > 0.5 ? Number.NaN : y >= 0.4 && y < 0.44 ? 100 : 0)
    const leg = request([], [0, 0.8])
    const blocked = await plan(edged, leg, { coarser: { cellKm: 0.2, z: flat } })
    expect(reasonOf(blocked.option)).toMatch(/^No path within/)
    // A model as fine as the lattice is ground: the path goes round the wall's end on it.
    const { km, xy } = drawn((await plan(edged, leg, { coarser: { cellKm: 0.02, z: flat } })).option)
    expect(km).toBeGreaterThan(1.2)
    expect(xy.some((p) => p.x > 0.5)).toBe(true)
  })

  it('walks a leg on the global cell on the global model alone, never stepping between models', async () => {
    // A 20 m site model ending at x = 0.5 km; the global model 60 m higher everywhere, as the two differ at the CTX edge.
    const site = (x: number) => (x > 0.5 ? Number.NaN : 0)
    const terrain = fixtureTerrain(site, { coarser: { cellKm: 0.2, z: () => 60 }, gridCellKm: 0.2, readsWhole: false })
    const { km, hours, path } = drawn(await planFastest(request([], [1, 0]), terrain, signal))
    for (const p of path) expect(p.elevationMeters).toEqual({ classification: 'OFFICIAL', value: 60, source: 'fixture global DEM' })
    // What the coarse lattice costs: the stops snap to nodes up to half a cell off and the joins add up, 1.28 km for a 1 km leg.
    expect(km).toBeCloseTo(1.28, 1)
    expect(hours).toBeCloseTo(0.64, 1)
  })

  it("plans a leg across 0/360°E, the plane's origin between its ends", async () => {
    const leg = { departure: { latitude: 18.44, longitudeEast: 359.99 }, destination: { latitude: 18.44, longitudeEast: 0.01 }, stops: [] }
    const { km, path } = drawn((await plan(flat, leg)).option)
    expect(km).toBeCloseTo(0.02 * KM_PER_DEG_LON, 1)
    for (const p of path) expect(p.coordinate.longitudeEast).toBeGreaterThanOrEqual(0)
    for (const p of path) expect(p.coordinate.longitudeEast).toBeLessThan(360)
  })

  it('refuses a leg spanning more latitude than one plane holds', async () => {
    const far = await plan(flat, request([], [0, 1000]), { site: false, cellKm: 0.2, readsWhole: false })
    expect(reasonOf(far.option)).toMatch(
      /^The leg spans too much latitude for one search plane: east–west distances at its ends would be off by up to \d+%\. Add a stop between$/,
    )
  })

  it('refuses a leg ending near a pole, where the plane is not usable', async () => {
    const polar = { departure: at(0, 0), destination: { latitude: 87, longitudeEast: 77.45 }, stops: [] }
    expect(reasonOf(await planFastest(polar, fixtureTerrain(flat), signal))).toMatch(/^A leg ending within 5° of a pole is not searched/)
  })

  it('says when the model could not be read, and when there is no model to search', async () => {
    const failed = await plan(flat, request(), { demFails: 'S3 refused' })
    expect(reasonOf(failed.option)).toBe('The elevation model could not be read: S3 refused')
    const none = await plan(flat, request(), { cellKm: 0 })
    expect(reasonOf(none.option)).toMatch(/^No elevation model can be searched here/)
  })

  it('walks the stops in order, each once, summing the legs', async () => {
    const { option } = await plan(flat, request([[1, 0]], [1, 1]))
    const { xy, km, hours, path } = drawn(option)
    const stops = path.filter((p) => p.coordinate.latitude === at(1, 0).latitude && p.coordinate.longitudeEast === at(1, 0).longitudeEast)
    expect(stops).toHaveLength(1)
    expect(xy[0]).toEqual({ x: 0, y: 0 })
    expect(xy.at(-1)?.y).toBeCloseTo(1, 6)
    expect(km).toBeCloseTo(2, 1)
    expect(hours).toBeCloseTo(1, 1)
    expect(new Set(path.map((p) => p.id)).size).toBe(path.length)
    const method = isAvailable(option.path) && option.path.classification === 'DERIVED' ? option.path.method : ''
    expect(method).toMatch(/^Per leg: .* \/ A\* search/)
  })

  it('names the leg that failed when there is more than one', async () => {
    const { option } = await plan((x) => (x > 1.5 ? Number.NaN : 0), request([[1, 0]], [2, 0]))
    expect(reasonOf(option)).toMatch(/^Leg 2 of 2: No elevation model has a height at the destination/)
  })
})

describe('searchLeg limits', () => {
  it('fits a leg to the cell budget by sampling every few cells, never by refusing it', async () => {
    const terrain = fixtureTerrain(flat)
    const leg = await searchLeg(at(0, 0), at(1, 0), terrain, { ...OPTIONS, maxCells: 1000 }, signal)
    expect(leg.classification).toBe('DERIVED')
    if (leg.classification !== 'DERIVED') return
    expect(terrain.reads[0]).toBeLessThanOrEqual(1000)
    expect(leg.value.method).toMatch(/every 5 model cells \(100 m north–south, 95 m east–west/)
    expect(leg.value.distanceKm).toBeCloseTo(1, 1)
  })

  it('asks the map for the box round the leg, and stops at once when cancelled', async () => {
    const terrain = fixtureTerrain(flat)
    await searchLeg(at(0, 0), at(1, 0), terrain, OPTIONS, signal)
    expect(terrain.boxes).toHaveLength(1)
    const box = terrain.boxes[0]
    expect(box.west).toBeLessThan(at(0, 0).longitudeEast)
    expect(box.east).toBeGreaterThan(at(1, 0).longitudeEast)
    expect(box.south).toBeLessThan(at(0, -0.9).latitude)
    expect(box.north).toBeGreaterThan(at(0, 0.9).latitude)
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(searchLeg(at(0, 0), at(1, 0), terrain, OPTIONS, cancelled.signal)).rejects.toThrow('Cancelled')
    expect(terrain.reads).toHaveLength(1)
  })
})

describe('the search lattice on a model stated on the Mars 2000 sphere', () => {
  // A 20 m cell on the 3,396.19 km sphere, as the Jezero CTX model states it.
  const CELL_DEG = (0.02 / 3396.19) * (180 / Math.PI)
  const KM_PER_DEG_LAT = (3389.5 * Math.PI) / 180

  /** The model row under each lattice row of a 10 km leg north, south to north. */
  async function modelRows(cellDeg?: number): Promise<number[]> {
    const ys = new Set<number>()
    const { option } = await plan(
      (_x, y) => {
        ys.add(Math.round(y * 1e7) / 1e7)
        return 0
      },
      request([], [0, 10]),
      { cellDeg },
    )
    drawn(option)
    return [...ys].sort((p, q) => p - q).map((y) => Math.floor(y / KM_PER_DEG_LAT / CELL_DEG))
  }
  const steps = (rows: number[]) => rows.slice(1).map((row, i) => row - rows[i])

  it('steps one model cell at a time, so no step spans two cells of ground', async () => {
    const rows = await modelRows(CELL_DEG)
    expect(rows.length).toBeGreaterThan(700)
    expect(new Set(steps(rows))).toEqual(new Set([1]))
  })

  it('without the cell in degrees steps 20 m on the mean sphere, which skips a model row every 507', async () => {
    expect(steps(await modelRows())).toContain(2)
  })
})

describe('a stop with no height after a model failed to read', () => {
  it('says the read failed, not that no model covers the stop', async () => {
    const failed = [{ model: 0, reason: 'CTX DTM mosaic of Jezero, 20 m: HTTP 503' }]
    const { option } = await plan((x) => (x < 0.2 ? Number.NaN : 0), request(), { failed })
    expect(reasonOf(option)).toBe(
      'No usable height at the departure: an elevation model could not be read (CTX DTM mosaic of Jezero, 20 m: HTTP 503)',
    )
  })

  it('does not blame a coarser model the lattice could not have stood on', async () => {
    // The site model has no data at the departure; the global model, which failed, is too coarse for a 20 m lattice.
    const failed = [{ model: 1, reason: 'HRSC–MOLA blended DEM v2, 200 m: HTTP 503' }]
    const coarser = { cellKm: 0.2, z: () => Number.NaN }
    const { option } = await plan((x) => (x < 0.2 ? Number.NaN : 0), request(), { failed, coarser })
    expect(reasonOf(option)).toMatch(/^No elevation model has a height at the departure/)
  })
})
