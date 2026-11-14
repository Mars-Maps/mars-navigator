import { derived, unavailable, type Classified } from './classification'
import type { MarsSolarTime } from './time'

/**
 * Mars time and sun position from a UTC instant — the Mars24 algorithm.
 *
 * Source: NASA GISS, "Mars24 Sunclock — Algorithm and Worked Examples"
 * (https://www.giss.nasa.gov/tools/mars24/help/algorithm.html, page version
 * 2025-01-07), after Allison & McEwen (2000), Planet. Space Sci. 48, 215–235,
 * and Allison (1997), Geophys. Res. Lett. 24, 1967–1970. Steps below are in
 * the GISS page's order. Every coefficient is copied from it; none is ours.
 *
 * This is an analytic series, not a numerical ephemeris. It is the method
 * NASA's own Mars24 clock uses, and good for lighting and local solar time —
 * which is why results are DERIVED and say "approximation", never OFFICIAL.
 */
export const MARS24_METHOD =
  'Mars24 analytic approximation (Allison & McEwen 2000, NASA GISS Mars24 ' +
  'algorithm) from the mission UTC time; not a numerical ephemeris'

/** Mean sol length in Earth days, as the GISS page gives it (1 sol = 88775.244 s). */
export const EARTH_DAYS_PER_SOL = 1.0274912517

const DEG = Math.PI / 180
const sinDeg = (d: number) => Math.sin(d * DEG)
const cosDeg = (d: number) => Math.cos(d * DEG)
const mod = (x: number, m: number) => ((x % m) + m) % m

/**
 * UTC instants where TAI − UTC changed, and its new value in seconds (IERS).
 * TT − UTC = TAI − UTC + 32.184 s. Last entry 2017-01-01; no leap second
 * has been added since. If IERS Bulletin C announces one, append it here.
 * One missing second shifts the sun by about 0.004° — invisible here, but
 * kept exact so the GISS worked example reproduces to its printed digits.
 */
const LEAP_SECOND_DATES: ReadonlyArray<readonly [date: string, taiMinusUtc: number]> = [
  ['1972-01-01', 10], ['1972-07-01', 11], ['1973-01-01', 12], ['1974-01-01', 13],
  ['1975-01-01', 14], ['1976-01-01', 15], ['1977-01-01', 16], ['1978-01-01', 17],
  ['1979-01-01', 18], ['1980-01-01', 19], ['1981-07-01', 20], ['1982-07-01', 21],
  ['1983-07-01', 22], ['1985-07-01', 23], ['1988-01-01', 24], ['1990-01-01', 25],
  ['1991-01-01', 26], ['1992-07-01', 27], ['1993-07-01', 28], ['1994-07-01', 29],
  ['1996-01-01', 30], ['1997-07-01', 31], ['1999-01-01', 32], ['2006-01-01', 33],
  ['2009-01-01', 34], ['2012-07-01', 35], ['2015-07-01', 36], ['2017-01-01', 37],
]
const LEAP_SECONDS = LEAP_SECOND_DATES.map(
  ([date, s]) => [Date.parse(`${date}T00:00:00Z`), s] as const,
)

/** TT − UTC in seconds at a UTC instant. */
function ttMinusUtcSeconds(utcMs: number, jdUt: number): number {
  if (utcMs < LEAP_SECONDS[0][0]) {
    // Before 1972 the GISS page gives this polynomial in Julian centuries.
    const t = (jdUt - 2451545.0) / 36525
    return 64.184 + 59 * t - 51.2 * t ** 2 - 67.1 * t ** 3 - 16.4 * t ** 4
  }
  let tai = LEAP_SECONDS[0][1]
  for (const [since, s] of LEAP_SECONDS) {
    if (utcMs >= since) tai = s
    else break
  }
  return tai + 32.184
}

/** Seven periodic perturbation terms, as tabulated on the GISS page. */
const PERTURBERS: ReadonlyArray<readonly [a: number, tau: number, phi: number]> = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
]

/**
 * Every intermediate of the algorithm. Exported from this file only, for the
 * tests; features use marsSolarTime(), which carries the classification.
 */
export interface Mars24Steps {
  jdUt: number
  ttMinusUtcSeconds: number
  jdTt: number
  /** Days since J2000 epoch, in TT. */
  deltaTJ2000: number
  meanAnomalyDeg: number
  fictitiousMeanSunDeg: number
  perturbersDeg: number
  equationOfCenterDeg: number
  solarLongitudeDeg: number
  equationOfTimeDeg: number
  marsSolDate: number
  meanSolarTimeHours: number
  /** As GISS gives it: degrees WEST, 0–360. */
  subsolarLongitudeWestDeg: number
  solarDeclinationDeg: number
  /** Mars–Sun distance, AU (GISS step D-2, AM2000 eq. 25 corrected). */
  heliocentricDistanceAu: number
}

export function mars24Steps(utcMs: number): Mars24Steps {
  // Julian Date (UT).
  const jdUt = 2440587.5 + utcMs / 8.64e7
  // Julian Date (TT), and days since the J2000 epoch.
  const dt = ttMinusUtcSeconds(utcMs, jdUt)
  const jdTt = jdUt + dt / 86400
  const d = jdTt - 2451545.0

  // Mars mean anomaly, and angle of the fictitious mean sun.
  const m = 19.3871 + 0.52402073 * d
  const alphaFms = 270.3871 + 0.524038496 * d

  // Perturbers. 0.985626° = 360° / 365.25.
  let pbs = 0
  for (const [a, tau, phi] of PERTURBERS) {
    pbs += a * Math.cos(((0.985626 * d) / tau + phi) * DEG)
  }

  // Equation of center (ν − M).
  const nuMinusM =
    (10.691 + 3.0e-7 * d) * sinDeg(m) +
    0.623 * sinDeg(2 * m) +
    0.05 * sinDeg(3 * m) +
    0.005 * sinDeg(4 * m) +
    0.0005 * sinDeg(5 * m) +
    pbs

  // Areocentric solar longitude.
  const ls = mod(alphaFms + nuMinusM, 360)

  // Equation of time, degrees.
  const eot =
    2.861 * sinDeg(2 * ls) - 0.071 * sinDeg(4 * ls) + 0.002 * sinDeg(6 * ls) - nuMinusM

  // Mean solar time at the prime meridian. The bracketed term is the Mars Sol Date.
  const msd = (jdTt - 2451549.5) / EARTH_DAYS_PER_SOL + 44796.0 - 0.0009626
  const mst = mod(24 * msd, 24)

  // Subsolar longitude (°W) and solar declination.
  const subsolarWest = mod(mst * 15 + eot + 180, 360)
  const declination = Math.asin(0.42565 * sinDeg(ls)) / DEG + 0.25 * sinDeg(ls)

  // Heliocentric distance, AU: a series in the mean anomaly.
  const rm =
    1.52367934 *
    (1.00436 - 0.09309 * cosDeg(m) - 0.004336 * cosDeg(2 * m) - 0.00031 * cosDeg(3 * m) - 0.00003 * cosDeg(4 * m))

  return {
    jdUt,
    ttMinusUtcSeconds: dt,
    jdTt,
    deltaTJ2000: d,
    meanAnomalyDeg: m,
    fictitiousMeanSunDeg: alphaFms,
    perturbersDeg: pbs,
    equationOfCenterDeg: nuMinusM,
    solarLongitudeDeg: ls,
    equationOfTimeDeg: eot,
    marsSolDate: msd,
    meanSolarTimeHours: mst,
    subsolarLongitudeWestDeg: subsolarWest,
    solarDeclinationDeg: declination,
    heliocentricDistanceAu: rm,
  }
}

/** Mars time and the subsolar point for an instant. DERIVED, or UNAVAILABLE. */
export function marsSolarTime(utcMs: number): Classified<MarsSolarTime> {
  if (!Number.isFinite(utcMs)) {
    return unavailable('Mission time is not a valid instant')
  }
  const s = mars24Steps(utcMs)
  return derived(
    {
      marsSolDate: s.marsSolDate,
      coordinatedMarsTimeHours: s.meanSolarTimeHours,
      solarLongitudeDeg: s.solarLongitudeDeg,
      equationOfTimeDeg: s.equationOfTimeDeg,
      heliocentricDistanceAu: s.heliocentricDistanceAu,
      subsolarPoint: {
        latitude: s.solarDeclinationDeg,
        // West to east. mod keeps 0°W as 0°E, never 360°E.
        longitudeEast: mod(360 - s.subsolarLongitudeWestDeg, 360),
      },
    },
    MARS24_METHOD,
  )
}

/**
 * Local true solar time at a longitude, hours 0–24: local mean solar time
 * plus the equation of time, as on the GISS page.
 * Noon is when the sun crosses the meridian. Takes the project's °E.
 * Returns a bare number: the input is already DERIVED, and the caller keeps
 * that classification when it shows the result.
 */
export function localTrueSolarTimeHours(
  solar: MarsSolarTime,
  longitudeEast: number,
): number {
  const lmst = solar.coordinatedMarsTimeHours + longitudeEast / 15
  return mod(lmst + solar.equationOfTimeDeg / 15, 24)
}
