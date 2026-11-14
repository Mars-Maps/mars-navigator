import { EARTH_DAYS_PER_SOL } from '../../domain'

// The surface pressure lives in its own module so the shell's point menu can take it without the model.
export { MEAN_SURFACE_PRESSURE_PA, MEAN_SURFACE_PRESSURE_SOURCE, SURFACE_PRESSURE_METHOD, surfacePressurePa } from './surfacePressure'

/**
 * A one-dimensional surface heat balance for Mars: the model the
 * THEMIS team's KRC uses, reduced to what the astronaut's two numbers need,
 * how cold the night gets and when the day is warm enough to work.
 *
 * Sunlight, less what the dust takes and what the albedo reflects, warms a
 * surface that radiates to the sky and conducts into a ground whose
 * response is set by its thermal inertia. Albedo sets the mean, thermal
 * inertia the day–night swing. The sol is run to a repeating diurnal curve
 * at a fixed season; the curve is what the UI reads by local time.
 *
 * Kieffer, H. H. (2013), Thermal model for analysis of Mars infrared
 * mapping, J. Geophys. Res. Planets 118, 451–470, doi 10.1002/jgre.20073,
 * is the reference model. This is not KRC: it keeps its energy balance and
 * subsurface diffusion and replaces its atmosphere with the two choices
 * below. Pure, with no data knowledge: the shell binds the inputs.
 */

/** NASA NSSDCA Planetary Fact Sheet, Earth "Solar irradiance (W/m2): 1361.0"; Mars 586.2 at 1.524 AU, which 1361.0 / 1.52368² reproduces. Checked 2026-10-31. */
export const SOLAR_IRRADIANCE_1AU_W_M2 = 1361.0
export const SOLAR_IRRADIANCE_SOURCE =
  'https://nssdc.gsfc.nasa.gov/planetary/factsheet/ — Earth "Solar irradiance: 1361.0 W/m²", scaled by the inverse square of the Mars–Sun distance (Mars24); the sheet’s Mars 586.2 W/m² at 1.524 AU follows (checked 2026-10-31)'

/** Stefan–Boltzmann constant, W m⁻² K⁻⁴ (CODATA 2018, exact). */
export const STEFAN_BOLTZMANN = 5.670374419e-8

/**
 * CO2 saturation: ln P = a − b / T, P in pascals, T in kelvin. KRC's own
 * values (krc.mars.asu.edu, "Condensable Atmosphere", SatPrA and SatPrB,
 * page of 2020-04-14, "provided by HHK, most likely from the Mars book").
 * The surface cannot cool below the frost point: CO2 condenses there.
 */
export const CO2_SATURATION = { a: 27.9546, b: 3182.48 } as const
export const CO2_SATURATION_SOURCE =
  'KRC documentation, "Condensable Atmosphere" (krc.mars.asu.edu, 2020-04-14): ln P[Pa] = 27.9546 − 3182.48 / T[K]'

/** Seconds in a mean sol, from the Mars24 sol length. */
export const SOL_SECONDS = EARTH_DAYS_PER_SOL * 86400

/**
 * What the model chooses where no official source gives a value. Each is a project
 * choice, said so in the method, and set together with the validation:
 * none is a measurement.
 */
export interface ThermalModelChoices {
  /** Surface thermal emissivity, 0–1. */
  emissivity: number
  /** Dust optical depth in the visible, applied along the slant path. */
  opticalDepth: number
  /** Downwelling thermal radiation from the atmosphere, as a fraction of the sol's noon top-of-atmosphere insolation, held through the sol. */
  skyFraction: number
  /** Sols run before the one that is read, so the ground forgets its starting temperature. */
  spinUpSols: number
  /** Steps per sol; 1440 is one Mars minute. */
  stepsPerSol: number
  /** Subsurface cells, each 1.25 times thicker than the one above, the first a fifth of the diurnal skin depth. */
  layers: number
}

/**
 * The emissivity is a round figure for a dusty surface. The optical depth
 * and sky fraction were set on 2026-10-31 by the comparison with MEDA at
 * Jezero (tests/unit/thermalModelValidation.test.ts): the pair with the
 * smallest night and day errors over a grid of 0.3–0.6 and 6–12 %. They
 * are fitted, so the Jezero error is not independent of them; Gale
 * is the independent check. Twelve layers reach eleven skin depths; with
 * sixteen spin-up sols the curve is within 0.12 K of a 40-sol run.
 */
export const DEFAULT_CHOICES: ThermalModelChoices = {
  emissivity: 0.95,
  opticalDepth: 0.6,
  skyFraction: 0.08,
  spinUpSols: 16,
  stepsPerSol: 1440,
  layers: 12,
}

/** CO2 frost point at a surface pressure, kelvin. ~148 K at the mean pressure. */
export function co2FrostPointK(pressurePa: number): number {
  return CO2_SATURATION.b / (CO2_SATURATION.a - Math.log(pressurePa))
}

/**
 * Surface pressure at a height, pascals: the fact sheet's mean pressure
 * scaled by exp(−h / H) with its scale height. An annual mean: the
 * seasonal cycle moves it by about ±30 % and is not modelled, which moves
 * the frost point by under 2 K.
 */


/** What one diurnal run needs. Angles in degrees; the season enters through the declination and the distance. */
export interface DiurnalInputs {
  latitudeDeg: number
  /** The sun's declination at the instant, the subsolar latitude (Mars24). */
  solarDeclinationDeg: number
  /** Mars–Sun distance, AU (Mars24). */
  heliocentricDistanceAu: number
  /** Apparent thermal inertia, J m⁻² K⁻¹ s⁻¹ᐟ². */
  thermalInertia: number
  /** Bolometric albedo, 0–1. */
  albedo: number
  surfacePressurePa: number
}

/** The repeating diurnal surface temperature, kelvin, one sample per step from local true solar midnight. */
export interface DiurnalCurve {
  stepsPerSol: number
  temperaturesK: Float32Array
  /** The frost floor the run used, kelvin. */
  frostPointK: number
  /** False through a polar night: no step had the sun above the horizon. */
  sunRises: boolean
  /** Peak top-of-atmosphere insolation of the sol, W/m², 0 in polar night. */
  noonInsolationWm2: number
}

const DEG = Math.PI / 180
/** Volumetric heat capacity the grid is built with, J m⁻³ K⁻¹. For a uniform ground the surface temperature depends on the thermal inertia alone, not on how it splits into conductivity and capacity; a test checks that. */
const NOMINAL_HEAT_CAPACITY = 1e6
const LAYER_GROWTH = 1.25
const SKIN_DEPTH_FRACTION = 0.2

/** Why the inputs cannot run, or null when they can. */
export function diurnalInputsProblem(i: DiurnalInputs): string | null {
  if (!(Math.abs(i.latitudeDeg) <= 90)) return 'latitude must be within ±90°'
  if (!(Math.abs(i.solarDeclinationDeg) <= 90)) return 'solar declination must be within ±90°'
  if (!(i.heliocentricDistanceAu > 0)) return 'the Mars–Sun distance must be positive'
  if (!(i.thermalInertia > 0)) return 'thermal inertia must be positive'
  if (!(i.albedo >= 0 && i.albedo < 1)) return 'albedo must be within [0, 1)'
  if (!(i.surfacePressurePa > 0)) return 'surface pressure must be positive'
  return null
}

/**
 * Runs the sol to its repeating curve. Explicit finite differences on a
 * geometric grid: the surface has no heat capacity and its temperature
 * solves the balance ε σ T⁴ + conduction = absorbed sunlight + sky
 * radiation each step (Newton); it is held at the frost point when the
 * balance would take it lower. The bottom cell is insulated. With the
 * first cell a fifth of the skin depth the explicit step is stable at any
 * thermal inertia: the limit is a sol / 50π ≈ 565 s, the step ≈ 62 s.
 */
export function diurnalCurve(inputs: DiurnalInputs, choices: ThermalModelChoices = DEFAULT_CHOICES): DiurnalCurve {
  const problem = diurnalInputsProblem(inputs)
  if (problem !== null) throw new RangeError(`diurnalCurve: ${problem}`)
  const { stepsPerSol: n, layers, emissivity: eps, opticalDepth: tau, skyFraction } = choices
  const dt = SOL_SECONDS / n

  // Sunlight absorbed at each step of the sol: it does not depend on temperature.
  const solar = SOLAR_IRRADIANCE_1AU_W_M2 / inputs.heliocentricDistanceAu ** 2
  const sinLat = Math.sin(inputs.latitudeDeg * DEG)
  const cosLat = Math.cos(inputs.latitudeDeg * DEG)
  const sinDec = Math.sin(inputs.solarDeclinationDeg * DEG)
  const cosDec = Math.cos(inputs.solarDeclinationDeg * DEG)
  const absorbed = new Float64Array(n)
  let noonInsolation = 0
  for (let i = 0; i < n; i++) {
    const hourAngle = (((i + 0.5) / n) * 24 - 12) * 15 * DEG
    const mu = sinLat * sinDec + cosLat * cosDec * Math.cos(hourAngle)
    if (mu <= 0) continue
    const topOfAtmosphere = solar * mu
    noonInsolation = Math.max(noonInsolation, topOfAtmosphere)
    // Direct beam through the dust, plus half of what the dust scattered, taken as reaching the ground.
    const direct = Math.exp(-tau / mu)
    absorbed[i] = (1 - inputs.albedo) * topOfAtmosphere * (direct + 0.5 * (1 - direct))
  }
  const skyRadiation = skyFraction * noonInsolation
  const frostPointK = co2FrostPointK(inputs.surfacePressurePa)

  // The grid, from the diurnal skin depth of this thermal inertia.
  const rhoC = NOMINAL_HEAT_CAPACITY
  const k = inputs.thermalInertia ** 2 / rhoC
  const kappa = k / rhoC
  const skinDepth = Math.sqrt((kappa * SOL_SECONDS) / Math.PI)
  const dz = new Float64Array(layers)
  for (let j = 0; j < layers; j++) dz[j] = skinDepth * SKIN_DEPTH_FRACTION * LAYER_GROWTH ** j
  // Conductance between the surface and cell 0, and between neighbouring cell centres, W m⁻² K⁻¹.
  const surfaceConductance = k / (dz[0] / 2)
  const conductance = new Float64Array(layers - 1)
  for (let j = 0; j < layers - 1; j++) conductance[j] = k / ((dz[j] + dz[j + 1]) / 2)

  // Start the ground at the sol's mean radiative balance, so the spin-up is short.
  let meanIn = skyRadiation
  for (let i = 0; i < n; i++) meanIn += absorbed[i] / n
  const start = Math.max(frostPointK, (meanIn / (eps * STEFAN_BOLTZMANN)) ** 0.25)
  const T = new Float64Array(layers).fill(start)
  let surface = start
  const out = new Float32Array(n)
  const flux = new Float64Array(layers)

  for (let sol = 0; sol <= choices.spinUpSols; sol++) {
    const record = sol === choices.spinUpSols
    for (let i = 0; i < n; i++) {
      const incoming = absorbed[i] + skyRadiation
      // Surface balance: ε σ Ts⁴ + g (Ts − T0) − incoming = 0, by Newton from the last Ts.
      for (let iter = 0; iter < 6; iter++) {
        const radiated = eps * STEFAN_BOLTZMANN * surface ** 4
        const f = radiated + surfaceConductance * (surface - T[0]) - incoming
        const df = (4 * radiated) / surface + surfaceConductance
        surface -= f / df
      }
      if (surface < frostPointK) surface = frostPointK
      if (record) out[i] = surface
      // Heat flows down the grid; the bottom is insulated.
      flux[0] = surfaceConductance * (surface - T[0])
      for (let j = 0; j < layers - 1; j++) flux[j + 1] = conductance[j] * (T[j] - T[j + 1])
      for (let j = 0; j < layers; j++) {
        const below = j === layers - 1 ? 0 : flux[j + 1]
        T[j] += (dt * (flux[j] - below)) / (rhoC * dz[j])
      }
    }
  }
  return { stepsPerSol: n, temperaturesK: out, frostPointK, sunRises: noonInsolation > 0, noonInsolationWm2: noonInsolation }
}

/** The curve's temperature at a local true solar time, hours 0–24, interpolated between its samples, which sit at the middle of each step. */
export function temperatureAtHour(curve: DiurnalCurve, localTrueSolarHours: number): number {
  const n = curve.stepsPerSol
  const position = (((localTrueSolarHours % 24) + 24) % 24) * (n / 24) - 0.5
  const i0 = Math.floor(position)
  const t = position - i0
  const a = curve.temperaturesK[((i0 % n) + n) % n]
  const b = curve.temperaturesK[(((i0 + 1) % n) + n) % n]
  return a + (b - a) * t
}

/** The curve's lowest and highest sample, kelvin. */
export function curveExtremes(curve: DiurnalCurve): { minK: number; maxK: number } {
  let minK = Infinity
  let maxK = -Infinity
  for (const t of curve.temperaturesK) {
    if (t < minK) minK = t
    if (t > maxK) maxK = t
  }
  return { minK, maxK }
}
