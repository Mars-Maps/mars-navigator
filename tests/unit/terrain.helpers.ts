import {
  MARS_MEAN_RADIUS_KM,
  official,
  unavailable,
  type Classified,
  type GeologicAreaFeature,
  type GeologicFeatures,
  type GeologicLineFeature,
  type GeologicPointFeature,
  type GeologicMap,
  type GeologicUnitArea,
  type MarsCoordinate,
} from '../../src/domain'
import type { RouteTerrain } from '../../src/features/route-analysis/strategies/types'

// Test fixtures only: an invented DEM and map lines near Jezero, never shown in the app.
export const START: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const RAD = Math.PI / 180
export const KM_PER_DEG_LAT = MARS_MEAN_RADIUS_KM * RAD
export const KM_PER_DEG_LON = KM_PER_DEG_LAT * Math.cos(START.latitude * RAD)
export const MAP: GeologicMap = { id: 'SIM 3464', title: 'Fixture map', scaleDenominator: 75000, citation: 'Fixture citation' }

/** The coordinate `x` km east and `y` km north of START. */
export const at = (x: number, y = 0): MarsCoordinate => ({
  latitude: START.latitude + y / KM_PER_DEG_LAT,
  longitudeEast: START.longitudeEast + x / KM_PER_DEG_LON,
})
/** Km east and north of START. */
export const xyOf = (c: MarsCoordinate) => ({
  x: (c.longitudeEast - START.longitudeEast) * KM_PER_DEG_LON,
  y: (c.latitude - START.latitude) * KM_PER_DEG_LAT,
})

/** A map line of `kind` through the given km offsets. */
export const line = (kind: string, ...pts: [number, number][]): GeologicLineFeature => ({
  kind,
  path: pts.map(([x, y]) => at(x, y)),
  map: MAP,
})

export interface FixtureOptions {
  cellKm?: number
  /** Whether the model counts as a site model (named so in the heights). */
  site?: boolean
  /** Read whole (the default), or by row ranges with the smaller search budget. */
  readsWhole?: boolean
  /** A second, coarser model answering where `z` has no height, as the global DEM does past a site model's edge. */
  coarser?: { cellKm: number; z: (x: number, y: number) => number }
  /** The cell the search lattice runs at, when not the first model's. */
  gridCellKm?: number
  /** The grid's cell in degrees, as a real model states it; absent, the lattice steps `cellKm` on the mean sphere. */
  cellDeg?: number
  /** Models named as failed to read (index into the fixture's models), with the heights that did come back. */
  failed?: { model: number; reason: string }[]
  lines?: GeologicLineFeature[]
  /** The map's point features (small craters) and area features (ridged ground); none by default. */
  mapPoints?: GeologicPointFeature[]
  mapAreas?: GeologicAreaFeature[]
  /** The map read fails with this reason. */
  mapFails?: string
  /** The elevation read fails with this reason. */
  demFails?: string
  /** The map's unit polygons; none by default. */
  units?: GeologicUnitArea[]
  /** The units read fails with this reason. */
  unitsFail?: string
}

/**
 * A terrain of one fixture model: `z` is the height in metres at km east
 * and north of START, NaN for no data. Records how many points each read
 * asked for.
 */
export function fixtureTerrain(z: (x: number, y: number) => number, options: FixtureOptions = {}) {
  const reads: number[] = []
  const boxes: { west: number; east: number; south: number; north: number }[] = []
  const cellKm = options.cellKm ?? 0.02
  const terrain: RouteTerrain & { reads: number[]; boxes: typeof boxes } = {
    grid: () => ({ cellKm: options.gridCellKm ?? cellKm, cellDeg: options.cellDeg, readsWhole: options.readsWhole ?? true }),
    reads,
    boxes,
    heights: (points, _signal, minCellKm) => {
      reads.push(points.length / 2)
      if (options.demFails) return Promise.resolve(unavailable(options.demFails))
      const h = new Float32Array(points.length / 2)
      const model = new Uint8Array(h.length)
      for (let i = 0; i < h.length; i++) {
        const { x, y } = xyOf({ latitude: points[i * 2], longitudeEast: points[i * 2 + 1] })
        // A model finer than the lattice is not read, as the chain does.
        h[i] = cellKm >= minCellKm ? z(x, y) : Number.NaN
        if (Number.isNaN(h[i]) && options.coarser && options.coarser.cellKm >= minCellKm) {
          h[i] = options.coarser.z(x, y)
          model[i] = 1
        }
      }
      const models = [{ cellKm, source: 'fixture DEM', site: options.site ?? true }]
      if (options.coarser) models.push({ cellKm: options.coarser.cellKm, source: 'fixture global DEM', site: false })
      return Promise.resolve(official({ heights: h, model, models, failed: options.failed }, 'fixture DEM'))
    },
    obstacles: (bounds) => {
      boxes.push(bounds)
      const features: Classified<GeologicFeatures> = options.mapFails
        ? unavailable(options.mapFails)
        : official({ points: options.mapPoints ?? [], lines: options.lines ?? [], areas: options.mapAreas ?? [] }, 'fixture map')
      return Promise.resolve(features)
    },
    units: () =>
      Promise.resolve(
        options.unitsFail ? unavailable<GeologicUnitArea[]>(options.unitsFail) : official(options.units ?? [], 'fixture units'),
      ),
  }
  return terrain
}
