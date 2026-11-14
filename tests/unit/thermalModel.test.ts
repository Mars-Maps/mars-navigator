import { describe, expect, it } from 'vitest'
import {
  co2FrostPointK,
  curveExtremes,
  DEFAULT_CHOICES,
  diurnalCurve,
  diurnalInputsProblem,
  MEAN_SURFACE_PRESSURE_PA,
  SOL_SECONDS,
  SOLAR_IRRADIANCE_1AU_W_M2,
  surfacePressurePa,
  temperatureAtHour,
  type DiurnalInputs,
} from '../../src/features/route-analysis/thermalModel'

/** The Jezero centre cell at a northern-spring instant: TES values, a mid-range distance. */
const JEZERO: DiurnalInputs = {
  latitudeDeg: 18.47,
  solarDeclinationDeg: 10,
  heliocentricDistanceAu: 1.6,
  thermalInertia: 246,
  albedo: 0.129,
  surfacePressurePa: 800,
}

describe('constants against their sources', () => {
  it("reproduces the fact sheet's Mars irradiance at its semi-major axis", () => {
    // Mars row "Solar irradiance (W/m2) 586.2"; "Semimajor axis (10^6 km) 227.956"; 1 AU = 149.598 × 10^6 km on the same sheet.
    const semiMajorAu = 227.956 / 149.598
    expect(SOLAR_IRRADIANCE_1AU_W_M2 / semiMajorAu ** 2).toBeCloseTo(586.2, 0)
  })

  it('puts the CO2 frost point near 148 K at the mean surface pressure, and lower at lower pressure', () => {
    expect(co2FrostPointK(MEAN_SURFACE_PRESSURE_PA)).toBeCloseTo(148.0, 0)
    expect(co2FrostPointK(400)).toBeLessThan(co2FrostPointK(800))
  })

  it("scales the mean pressure by the fact sheet's scale height", () => {
    expect(surfacePressurePa(0)).toBe(MEAN_SURFACE_PRESSURE_PA)
    expect(surfacePressurePa(11000)).toBeCloseTo(MEAN_SURFACE_PRESSURE_PA / Math.E, 6)
    expect(surfacePressurePa(-2569)).toBeGreaterThan(MEAN_SURFACE_PRESSURE_PA)
  })

  it('takes the sol length from Mars24', () => {
    expect(SOL_SECONDS).toBeCloseTo(88775.244, 2)
  })
})

describe('diurnalCurve', () => {
  const curve = diurnalCurve(JEZERO)

  it('runs one sample per step, every one a finite kelvin value above the frost floor', () => {
    expect(curve.temperaturesK).toHaveLength(DEFAULT_CHOICES.stepsPerSol)
    for (const t of curve.temperaturesK) {
      expect(Number.isFinite(t)).toBe(true)
      expect(t).toBeGreaterThanOrEqual(curve.frostPointK)
    }
    expect(curve.sunRises).toBe(true)
  })

  it('is coldest before dawn and warmest in the early afternoon, in a plausible range for Jezero', () => {
    const { minK, maxK } = curveExtremes(curve)
    // MEDA's ground brightness extremes at Jezero over sols 1–1859 are 177–299 K (medaJezero.ts).
    expect(minK).toBeGreaterThan(160)
    expect(minK).toBeLessThan(220)
    expect(maxK).toBeGreaterThan(240)
    expect(maxK).toBeLessThan(320)
    const n = curve.stepsPerSol
    const hourOf = (i: number) => ((i + 0.5) / n) * 24
    const argMin = curve.temperaturesK.indexOf(minK)
    const argMax = curve.temperaturesK.indexOf(maxK)
    expect(hourOf(argMin)).toBeGreaterThan(3)
    expect(hourOf(argMin)).toBeLessThan(7)
    expect(hourOf(argMax)).toBeGreaterThan(12)
    expect(hourOf(argMax)).toBeLessThan(15)
  })

  it('has settled: one more spin-up sol changes nothing a reader could see', () => {
    const longer = diurnalCurve(JEZERO, { ...DEFAULT_CHOICES, spinUpSols: DEFAULT_CHOICES.spinUpSols + 8 })
    let worst = 0
    for (let i = 0; i < curve.stepsPerSol; i++) {
      worst = Math.max(worst, Math.abs(curve.temperaturesK[i] - longer.temperaturesK[i]))
    }
    expect(worst).toBeLessThan(0.15)
  })

  it('depends on the thermal inertia, not on how the grid splits it into conductivity and capacity', () => {
    // Same inertia, a grid built from a different number of layers: the surface curve agrees.
    const other = diurnalCurve(JEZERO, { ...DEFAULT_CHOICES, layers: 16 })
    let worst = 0
    for (let i = 0; i < curve.stepsPerSol; i++) {
      worst = Math.max(worst, Math.abs(curve.temperaturesK[i] - other.temperaturesK[i]))
    }
    expect(worst).toBeLessThan(0.3)
  })

  it('swings less with a higher thermal inertia, about the same mean', () => {
    const rock = diurnalCurve({ ...JEZERO, thermalInertia: 1200 })
    const dust = diurnalCurve({ ...JEZERO, thermalInertia: 60 })
    const swing = (c: ReturnType<typeof diurnalCurve>) => {
      const { minK, maxK } = curveExtremes(c)
      return maxK - minK
    }
    expect(swing(rock)).toBeLessThan(swing(curve))
    expect(swing(dust)).toBeGreaterThan(swing(curve))
  })

  it('is colder with a higher albedo and warmer closer to the sun', () => {
    const bright = diurnalCurve({ ...JEZERO, albedo: 0.3 })
    const near = diurnalCurve({ ...JEZERO, heliocentricDistanceAu: 1.4 })
    expect(curveExtremes(bright).maxK).toBeLessThan(curveExtremes(curve).maxK)
    expect(curveExtremes(near).maxK).toBeGreaterThan(curveExtremes(curve).maxK)
  })

  it('holds a polar night at the CO2 frost point with the sun never up', () => {
    const night = diurnalCurve({ ...JEZERO, latitudeDeg: -85, solarDeclinationDeg: 20 })
    expect(night.sunRises).toBe(false)
    expect(night.noonInsolationWm2).toBe(0)
    for (const t of night.temperaturesK) expect(t).toBeCloseTo(night.frostPointK, 3)
  })

  it('rejects inputs it cannot run on, by name', () => {
    expect(diurnalInputsProblem({ ...JEZERO, thermalInertia: 0 })).toMatch(/thermal inertia/)
    expect(diurnalInputsProblem({ ...JEZERO, albedo: 1 })).toMatch(/albedo/)
    expect(diurnalInputsProblem({ ...JEZERO, surfacePressurePa: Number.NaN })).toMatch(/pressure/)
    expect(diurnalInputsProblem({ ...JEZERO, latitudeDeg: 91 })).toMatch(/latitude/)
    expect(diurnalInputsProblem(JEZERO)).toBeNull()
    expect(() => diurnalCurve({ ...JEZERO, heliocentricDistanceAu: -1 })).toThrow(RangeError)
  })
})

describe('temperatureAtHour', () => {
  const curve = diurnalCurve(JEZERO)

  it('returns the sample at a sample’s own hour and interpolates between two', () => {
    const n = curve.stepsPerSol
    expect(temperatureAtHour(curve, (0.5 / n) * 24)).toBeCloseTo(curve.temperaturesK[0], 5)
    const mid = (curve.temperaturesK[10] + curve.temperaturesK[11]) / 2
    expect(temperatureAtHour(curve, (11 / n) * 24)).toBeCloseTo(mid, 5)
  })

  it('wraps round midnight', () => {
    expect(temperatureAtHour(curve, 24)).toBeCloseTo(temperatureAtHour(curve, 0), 6)
    expect(temperatureAtHour(curve, -1)).toBeCloseTo(temperatureAtHour(curve, 23), 6)
  })
})
