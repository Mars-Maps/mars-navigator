/**
 * Published constants for the sky seen from Mars (OFFICIAL, each block
 * cites its source) and one fitted model (DERIVED, method stated). Copied
 * exactly; do not round. Used by ephemeris.ts.
 */

export const DEG = Math.PI / 180
export const AU_KM = 149597870.7
/** J2000.0 as a Julian Date (TDB). */
export const J2000_JD = 2451545.0

/**
 * JPL, "Approximate Positions of the Planets", Table 1: Keplerian elements
 * and rates with respect to the mean ecliptic and equinox of J2000, valid
 * 1800 AD – 2050 AD (E. M. Standish).
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html
 * Each row: a (au), e, I, L, long. perihelion, long. ascending node (deg),
 * then the same per Julian century.
 */
export const PLANET_ELEMENTS_SOURCE =
  'JPL "Approximate Positions of the Planets", Table 1 (E. M. Standish), valid 1800–2050'
export const PLANET_ELEMENTS_VALID_JD = [2378496.5, 2469807.5] as const // 1800-01-01, 2050-01-01
export const OBLIQUITY_J2000_DEG = 23.43928

export type PlanetId =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'

export const PLANET_ELEMENTS: Record<PlanetId, readonly [readonly number[], readonly number[]]> = {
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  ],
  venus: [
    [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  ],
  // The table's row is the Earth–Moon barycentre; Earth itself is within
  // 4,700 km of it, under 15 arcseconds as seen from Mars.
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  ],
  saturn: [
    [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  ],
  uranus: [
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  ],
  neptune: [
    [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  ],
}

/**
 * Mars orientation, IAU WGCCRE 2015 report (Archinal et al. 2018), as
 * implemented in NAIF's planetary constants kernel pck00011.tpc:
 * https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc
 * Pole RA and Dec in degrees, T in Julian centuries TDB from J2000;
 * prime meridian W in degrees, d in days. Periodic terms: amplitude × sin
 * (RA, W) or × cos (Dec) of the angle A + B·T + C·T² (deg).
 */
export const MARS_ORIENTATION_SOURCE =
  'IAU WGCCRE 2015 (Archinal et al. 2018), NAIF pck00011.tpc'
export const MARS_POLE_RA = [317.269202, -0.10927547] as const
export const MARS_POLE_DEC = [54.432516, -0.05827105] as const
export const MARS_PM = [176.049863, 350.891982443297] as const
/** [amplitude deg, A deg, B deg/century, C deg/century²] */
export const MARS_RA_TERMS: readonly (readonly [number, number, number, number])[] = [
  [0.000068, 198.991226, 19139.4819985, 0],
  [0.000238, 226.292679, 38280.8511281, 0],
  [0.000052, 249.663391, 57420.7251593, 0],
  [0.000009, 266.18351, 76560.636795, 0],
  [0.419057, 79.398797, 0.5042615, 0],
]
export const MARS_DEC_TERMS: readonly (readonly [number, number, number, number])[] = [
  [0.000051, 122.433576, 19139.9407476, 0],
  [0.000141, 43.058401, 38280.8753272, 0],
  [0.000031, 57.663379, 57420.7517205, 0],
  [0.000005, 79.476401, 76560.6495004, 0],
  [1.591274, 166.325722, 0.5042615, 0],
]
export const MARS_PM_TERMS: readonly (readonly [number, number, number, number])[] = [
  [0.000145, 129.071773, 19140.0328244, 0],
  [0.000157, 36.352167, 38281.0473591, 0],
  [0.00004, 56.668646, 57420.929536, 0],
  [0.000001, 67.364003, 76560.2552215, 0],
  [0.000001, 104.79268, 95700.4387578, 0],
  [0.584542, 95.391654, 0.5042615, 0],
]

/**
 * Body radii, km: NAIF pck00011.tpc (BODYnnn_RADII). Sun: IAU nominal
 * solar radius. Phobos and Deimos are triaxial: the long axis points at
 * Mars, the short one along the orbit pole.
 */
export const RADII_SOURCE = 'NAIF pck00011.tpc body radii'
export const SUN_RADIUS_KM = 695700
export const PLANET_RADIUS_KM: Record<Exclude<PlanetId, 'mars'>, number> = {
  mercury: 2440.53,
  venus: 6051.8,
  earth: 6378.1366,
  jupiter: 71492,
  saturn: 60268,
  uranus: 25559,
  neptune: 24764,
}
export const PHOBOS_RADII_KM = [13.0, 11.4, 9.1] as const
export const DEIMOS_RADII_KM = [7.8, 6.0, 5.1] as const

/**
 * DERIVED: precessing-ellipse fits to JPL Horizons osculating elements of
 * Phobos (401) and Deimos (402), Mars-centred, ICRF, every 6 h from
 * 2024-01-01 to 2031-01-01 (ephemeris MAR099). The orbit pole circles a
 * fixed pole (RA, Dec) at a fixed tilt; node, longitude of periapsis and
 * mean longitude are linear in days from the epoch, measured in the frame
 * whose x-axis is that pole's equator node on the ICRF equator. Fit
 * residual against Horizons' positions over the window: Phobos 0.010° rms,
 * 0.032° max; Deimos 0.023° rms, 0.051° max. Not valid outside the window.
 */
export const MOON_FIT_METHOD =
  'Precessing-ellipse fit to JPL Horizons (MAR099) Phobos and Deimos elements, 2024–2030; within 0.05° of Horizons over that window'
export const MOON_FIT_EPOCH_JD = 2461000.5
export const MOON_FIT_VALID_JD = [2460310.5, 2462867.5] as const // 2024-01-01, 2031-01-01

export interface MoonFit {
  poleRaDeg: number
  poleDecDeg: number
  tiltDeg: number
  aKm: number
  e: number
  /** [deg at epoch, deg/day] */
  node: readonly [number, number]
  periapsis: readonly [number, number]
  meanLongitude: readonly [number, number]
}

export const PHOBOS_FIT: MoonFit = {
  poleRaDeg: 317.6424,
  poleDecDeg: 52.8752,
  tiltDeg: 1.07701,
  aKm: 9378.54,
  e: 0.015132,
  node: [8.80509, -0.436007102],
  periapsis: [180.572869, 0.435119924],
  meanLongitude: [7.65322954193, 1128.84494285],
}

export const DEIMOS_FIT: MoonFit = {
  poleRaDeg: 316.4342,
  poleDecDeg: 53.6036,
  tiltDeg: 1.65574,
  aKm: 23458.95,
  e: 0.000299,
  node: [244.587515, -0.019505265],
  periapsis: [73.297643, 0.014830038],
  meanLongitude: [207.895640753, 285.161802822],
}
