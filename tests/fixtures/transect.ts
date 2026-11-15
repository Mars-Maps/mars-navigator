import {
  DEFAULT_MISSION_SETTINGS,
  MARS_MEAN_RADIUS_KM,
  official,
  unavailable,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
  type MissionSettings,
} from '../../src/domain'
import { planProfile, type ElevationProfile } from '../../src/features/route-analysis/elevationProfile'
import { transectLine, type TransectLine } from '../../src/features/route-analysis/transectLine'
import { transectWalk } from '../../src/features/route-analysis/transectWalk'

// Test fixtures only: invented units and heights, never shown in the app.
export const START: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
export const KM_PER_DEG = (MARS_MEAN_RADIUS_KM * Math.PI) / 180
export const KM_PER_DEG_LON = KM_PER_DEG * Math.cos((START.latitude * Math.PI) / 180)
export const at = (x: number, y: number): MarsCoordinate => ({ latitude: START.latitude + y / KM_PER_DEG, longitudeEast: START.longitudeEast + x / KM_PER_DEG_LON })
export const xOf = (c: MarsCoordinate) => (c.longitudeEast - START.longitudeEast) * KM_PER_DEG_LON
export const MAP = { id: 'FIXTURE MAP', title: 'Fixture', scaleDenominator: 75000, citation: 'Fixture map citation' }
export const unit = (name: string, description?: string): GeologicUnit => ({ symbol: name.slice(0, 2), name, description, map: MAP })
/** A strip of one unit from `x0` to `x1` km east of the start, 4 km tall. */
export const strip = (name: string, x0: number, x1: number): GeologicUnitArea => ({
  unit: unit(name),
  rings: [[at(x0, -2), at(x1, -2), at(x1, 2), at(x0, 2)]],
})
/** West to east: rim, a middle unit, the fan, the floor the start stands on. Contacts at −3, −1.5 and −0.5 km. */
export const UNITS = [
  strip('Crater rim unit', -3.6, -3),
  strip('Upper etched unit', -3, -1.5),
  strip('Jezero fan 2 unit', -1.5, -0.5),
  strip('Jezero floor unit', -0.5, 3),
]
export const CONTACTS = [-3, -1.5, -0.5]
export const NEAREST_NOTE = "The line runs from the nearest outcrop of the map's crater rim unit, which may be the rim of a smaller crater, not the main crater's own"
export const settings = (over: Partial<MissionSettings> = {}): MissionSettings => ({ ...DEFAULT_MISSION_SETTINGS, ...over })

export function lineOf(start = START, units = UNITS, reachKm?: number): TransectLine {
  const line = transectLine(start, units, reachKm)
  if (line.classification === 'UNAVAILABLE') throw new Error(line.reason)
  return line.value
}
/** The profile along the line, the height at each point from `heightAt(x km east)`. */
export function profileOf(line: TransectLine, heightAt: (x: number) => number = () => -2500): ElevationProfile {
  const plan = planProfile(line.path)
  if (plan.classification === 'UNAVAILABLE') throw new Error(plan.reason)
  return {
    totalDistanceKm: plan.value.totalDistanceKm,
    samples: plan.value.points.map((p) => {
      const h = heightAt(xOf(p.coordinate))
      return { ...p, elevationMeters: Number.isNaN(h) ? unavailable<number>('fixture: no height') : official(h, 'fixture') }
    }),
  }
}
export function walkOf(line: TransectLine, s = settings(), heightAt?: (x: number) => number) {
  const walk = transectWalk(line, profileOf(line, heightAt), UNITS, s)
  if (walk.classification === 'UNAVAILABLE') throw new Error(walk.reason)
  return walk.value
}
