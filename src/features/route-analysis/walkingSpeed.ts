/**
 * How fast a suited astronaut walks over sloping ground:
 * the shape of Tobler's hiking function, scaled so level ground is
 * walked at the pace NASA plans lunar EVAs with. Both are cited; neither is
 * a Mars measurement, and every figure derived from them says so.
 */

/** Tobler's hiking function, as printed (Figure II of the report). */
export const TOBLER_SOURCE =
  'Tobler, W. (1993), "Three presentations on geographical analysis and modeling", NCGIA Technical Report 93-1, hiking function W = 6·e^(−3.5·|S + 0.05|) km/h, fitted to Imhof (1950, pp. 217–220): Earth hikers, unsuited'

/** The one cited walking pace in a suit, with what it leaves out. */
export const SUITED_LEVEL_PACE = {
  kmh: 2,
  source:
    'NASA EVA-EXP-0075 (2020), Lunar Excursion Ranges, two notes on the 2 km walking range: "Assumes ~2 km/hr walking pace on relatively level regolith" and "Does not account for slope or obstacles (boulders)"',
} as const

/**
 * Tobler's walking speed, km/h, from the gradient `s` = rise over run
 * (uphill positive). Fastest, 6 km/h, on a slight descent of −0.05
 * (about −2.9°); about 5 km/h on the level.
 */
export function toblerKmh(s: number): number {
  return 6 * Math.exp(-3.5 * Math.abs(s + 0.05))
}

/** Tobler's level-ground speed, the divisor of the scaling. */
export const TOBLER_LEVEL_KMH = toblerKmh(0)

/**
 * The speed the fastest route walks at, km/h: Tobler's slope dependence
 * scaled so the level pace is `SUITED_LEVEL_PACE.kmh`. That is a project
 * derivation, stated wherever the figure is shown: Tobler's data are Earth
 * hikers and NASA's pace is a lunar planning figure with no slope term.
 */
export function suitedWalkingKmh(s: number): number {
  return (SUITED_LEVEL_PACE.kmh * toblerKmh(s)) / TOBLER_LEVEL_KMH
}

/** The fastest the model ever walks, km/h: on Tobler's −0.05 gradient. The search's heuristic needs it. */
export const SUITED_MAX_KMH = suitedWalkingKmh(-0.05)

/** The derivation, for a DERIVED method. */
export const WALKING_SPEED_METHOD = `Walking speed from the slope of each step: the shape of Tobler's hiking function (${TOBLER_SOURCE}) scaled so level ground is walked at ${SUITED_LEVEL_PACE.kmh} km/h (${SUITED_LEVEL_PACE.source}). A project combination of an Earth hiking model and a lunar planning figure, not a Mars measurement`
