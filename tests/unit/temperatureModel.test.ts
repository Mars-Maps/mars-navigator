import { describe, expect, it } from 'vitest'
import { isAvailable, marsSolarTime, official, unavailable, type MarsCoordinate, type MarsSolarTime, type SurfaceThermalProperties } from '../../src/domain'
import {
  createTemperatureModel,
  CurveCache,
  TEMPERATURE_MODEL_REASONS,
  VALIDATED_ERROR,
} from '../../src/features/route-analysis/temperatureModel'
import { DEFAULT_CHOICES, diurnalCurve, type DiurnalInputs } from '../../src/features/route-analysis/thermalModel'

const JEZERO: MarsCoordinate = { latitude: 18.4447, longitudeEast: 77.4508 }
const cell: SurfaceThermalProperties = { thermalInertia: official(246, 'TES TI'), albedo: official(0.129, 'TES albedo') }
const solarAt = (utc: string): MarsSolarTime => {
  const s = marsSolarTime(Date.parse(utc))
  if (!isAvailable(s)) throw new Error(s.reason)
  return s.value
}

const model = createTemperatureModel({
  properties: () => cell,
  surfacePressurePa: () => official(800, 'test pressure'),
  error: { errorK: 7, basis: 'test basis' },
})

describe('createTemperatureModel', () => {
  it('gives a DERIVED kelvin estimate carrying the error, with every input and choice in the method', () => {
    const solar = solarAt('2026-10-31T14:00:00Z')
    const e = model(JEZERO, solar)
    expect(e.classification).toBe('DERIVED')
    if (e.classification !== 'DERIVED') return
    expect(e.value.temperatureK).toBeGreaterThan(150)
    expect(e.value.temperatureK).toBeLessThan(320)
    expect(e.value.errorK).toBe(7)
    expect(e.method).toContain('Model estimate, not a measurement')
    expect(e.method).toContain('Kieffer 2013')
    expect(e.method).toContain('thermal inertia 246')
    expect(e.method).toContain('TES TI')
    expect(e.method).toContain('albedo 0.129')
    expect(e.method).toContain('TES albedo')
    expect(e.method).toContain(`Ls ${solar.solarLongitudeDeg.toFixed(1)}°`)
    expect(e.method).toContain('surface pressure 800 Pa (test pressure')
    expect(e.method).toContain(`emissivity ${DEFAULT_CHOICES.emissivity}`)
    expect(e.method).toContain('Not modelled: slopes and shadows, dust storms')
    expect(e.method).toContain('Error ± 7 K: test basis')
  })

  it('reads the curve at the point’s local true solar time: a night instant is colder than a noon one', () => {
    // Jezero at 77.45°E: local noon is about 5 h 10 min before 0°E's, so these two UTC instants bracket its day and night.
    const estimates = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
      const e = model(JEZERO, solarAt(`2026-10-31T${String(h).padStart(2, '0')}:00:00Z`))
      if (e.classification !== 'DERIVED') throw new Error('expected DERIVED')
      return e.value.temperatureK
    })
    expect(Math.max(...estimates) - Math.min(...estimates)).toBeGreaterThan(40)
  })

  it('carries the validated error by default', () => {
    const byDefault = createTemperatureModel({ properties: () => cell, surfacePressurePa: () => official(800, 'p') })
    const e = byDefault(JEZERO, solarAt('2026-10-31T14:00:00Z'))
    expect(e.classification === 'DERIVED' && e.value.errorK).toBe(VALIDATED_ERROR.errorK)
    expect(e.classification === 'DERIVED' && e.method).toContain(VALIDATED_ERROR.basis)
  })

  it('is UNAVAILABLE poleward of the grids’ band, with the reason', () => {
    const e = model({ latitude: 88, longitudeEast: 10 }, solarAt('2026-10-31T14:00:00Z'))
    expect(e).toEqual({ classification: 'UNAVAILABLE', reason: TEMPERATURE_MODEL_REASONS.outsideBand })
  })

  it('is UNAVAILABLE without a property or a pressure, naming which and why', () => {
    const solar = solarAt('2026-10-31T14:00:00Z')
    const noInertia = createTemperatureModel({
      properties: () => ({ ...cell, thermalInertia: unavailable('no cell') }),
      surfacePressurePa: () => official(800, 'p'),
    })(JEZERO, solar)
    expect(noInertia).toEqual({ classification: 'UNAVAILABLE', reason: 'No thermal inertia at this point: no cell' })
    const noAlbedo = createTemperatureModel({
      properties: () => ({ ...cell, albedo: unavailable('no cell') }),
      surfacePressurePa: () => official(800, 'p'),
    })(JEZERO, solar)
    expect(noAlbedo).toEqual({ classification: 'UNAVAILABLE', reason: 'No albedo at this point: no cell' })
    const noPressure = createTemperatureModel({
      properties: () => cell,
      surfacePressurePa: () => unavailable('Reading the elevation here…'),
    })(JEZERO, solar)
    expect(noPressure).toEqual({ classification: 'UNAVAILABLE', reason: 'No surface pressure at this point: Reading the elevation here…' })
  })

  it('is UNAVAILABLE, not a throw, on a property the model cannot run on', () => {
    const bad = createTemperatureModel({
      properties: () => ({ ...cell, albedo: official(1.2, 'bad') }),
      surfacePressurePa: () => official(800, 'p'),
    })(JEZERO, solarAt('2026-10-31T14:00:00Z'))
    expect(bad.classification).toBe('UNAVAILABLE')
    expect(bad.classification === 'UNAVAILABLE' && bad.reason).toMatch(/albedo/)
  })

  it('runs at the band’s edge, −86.9°', () => {
    const e = model({ latitude: -86.9, longitudeEast: 0 }, solarAt('2026-10-31T14:00:00Z'))
    expect(e.classification).toBe('DERIVED')
  })
})

describe('CurveCache', () => {
  const inputs: DiurnalInputs = { latitudeDeg: 18.4, solarDeclinationDeg: 10, heliocentricDistanceAu: 1.6, thermalInertia: 246, albedo: 0.129, surfacePressurePa: 800 }

  it('returns the same run for inputs that round to the same key, and a new one otherwise', () => {
    const cache = new CurveCache(DEFAULT_CHOICES, 2)
    const a = cache.curveFor(inputs)
    expect(cache.curveFor({ ...inputs, latitudeDeg: 18.42, surfacePressurePa: 803 })).toBe(a)
    expect(cache.size).toBe(1)
    const b = cache.curveFor({ ...inputs, latitudeDeg: 30 })
    expect(b).not.toBe(a)
    expect(cache.size).toBe(2)
  })

  it('drops the least recently used run past its capacity', () => {
    const cache = new CurveCache(DEFAULT_CHOICES, 2)
    const a = cache.curveFor(inputs)
    cache.curveFor({ ...inputs, latitudeDeg: 30 })
    cache.curveFor(inputs) // a is recent again
    cache.curveFor({ ...inputs, latitudeDeg: 40 }) // evicts the 30° run
    expect(cache.size).toBe(2)
    expect(cache.curveFor(inputs)).toBe(a)
  })

  it('agrees with a direct run', () => {
    const cache = new CurveCache(DEFAULT_CHOICES)
    expect(cache.curveFor(inputs).temperaturesK).toEqual(diurnalCurve(inputs).temperaturesK)
  })
})
