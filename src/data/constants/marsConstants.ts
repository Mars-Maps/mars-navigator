import { MARS_MEAN_RADIUS_KM, official, type Classified } from '../../domain'

/**
 * Mars reference figures for the intro panel.
 *
 * OFFICIAL — every value is copied from the NASA NSSDCA Mars Fact Sheet and
 * cites the row it came from. Values were checked against the page on
 * 2026-10-18. Do not add a figure from memory, a blog, a wiki or a model's
 * output: if it cannot be cited, it is UNAVAILABLE.
 *
 * Units are in each key and repeated in `unit` for display.
 *
 * These live in src/data because they come from an external source. Features
 * cannot import src/data, so the app shell passes them in as props.
 */

/** NASA Space Science Data Coordinated Archive, Mars Fact Sheet. */
export const MARS_FACT_SHEET_URL =
  'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html'

const factSheet = (row: string) => `${MARS_FACT_SHEET_URL} — "${row}"`

export interface MarsConstant {
  /** Human-readable name, for the panel. */
  label: string
  /** Display unit, matching the unit in the key. */
  unit: string
  value: Classified<number>
  /** Caveat the source states and the UI should show alongside the value. */
  note?: string
}

export const MARS_CONSTANTS = {
  meanRadiusKm: {
    label: 'Mean radius',
    unit: 'km',
    // Same value as the domain constant, so there is only one copy of it.
    value: official(MARS_MEAN_RADIUS_KM, factSheet('Volumetric mean radius (km)')),
  },
  surfaceGravityMps2: {
    label: 'Surface gravity',
    unit: 'm/s²',
    value: official(3.73, factSheet('Surface gravity (mean) (m/s2)')),
  },
  solarDayHours: {
    label: 'Length of day (sol)',
    unit: 'h',
    value: official(24.6597, factSheet('Length of day (hrs)')),
    note: 'Solar day. The sidereal rotation period is 24.6229 h.',
  },
  meanSurfaceTemperatureK: {
    label: 'Average temperature',
    unit: 'K',
    value: official(214, factSheet('Martian Atmosphere — Average temperature')),
    note: 'Approximate (~214 K, about −59 °C). Local temperatures vary widely.',
  },
  meanDistanceFromSunMillionKm: {
    label: 'Mean distance from the Sun',
    unit: 'million km',
    value: official(227.956, factSheet('Semimajor axis (10^6 km)')),
  },
  minDistanceFromEarthMillionKm: {
    label: 'Closest distance from Earth',
    unit: 'million km',
    value: official(54.6, factSheet('Distance from Earth — Minimum (10^6 km)')),
  },
  maxDistanceFromEarthMillionKm: {
    label: 'Farthest distance from Earth',
    unit: 'million km',
    value: official(401.4, factSheet('Distance from Earth — Maximum (10^6 km)')),
  },
} as const satisfies Record<string, MarsConstant>

export type MarsConstantId = keyof typeof MARS_CONSTANTS
