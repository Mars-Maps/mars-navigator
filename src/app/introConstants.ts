import { MARS_CONSTANTS, type MarsConstantId } from '../data/constants/marsConstants'

/**
 * The intro card's figures, in the intro design's order. The mean
 * radius and the two Earth distances stay in MARS_CONSTANTS, not shown here.
 */
export const INTRO_CONSTANT_IDS = [
  'meanDistanceFromSunMillionKm',
  'solarDayHours',
  'meanSurfaceTemperatureK',
  'surfaceGravityMps2',
] as const satisfies readonly MarsConstantId[]

export const INTRO_CONSTANTS = Object.fromEntries(
  INTRO_CONSTANT_IDS.map((id) => [id, MARS_CONSTANTS[id]]),
)
