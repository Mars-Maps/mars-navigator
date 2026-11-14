import { describe, expect, it } from 'vitest'
import { CELSIUS_OFFSET_K, isAvailable, marsSolarTime, type MarsSolarTime } from '../../src/domain'
import {
  LAYER_BINS,
  LAYER_CURVE_STEPS,
  layerTemperaturesK,
  planTemperatureLayer,
  runLayerCurves,
  sampledCurveAt,
  seasonOf,
  temperatureLayerMethod,
  type ThermalInputGrid,
} from '../../src/features/route-analysis/temperatureLayer'
import { DEFAULT_CHOICES, MEAN_SURFACE_PRESSURE_PA, diurnalCurve, temperatureAtHour } from '../../src/features/route-analysis/thermalModel'
import { GRID_IMAGE_HEIGHT, GRID_IMAGE_WIDTH, gridImageRect, slices, workerCount } from '../../src/app/thermalGridLayer'

// Test fixture only: an invented 4 × 3 grid at 1 px/deg over 10–14°E, 2°N–1°S.
function grid(ti: number[], albedo: number[]): ThermalInputGrid {
  return {
    widthPx: 4,
    heightPx: 3,
    pxPerDeg: 1,
    westDeg: 10,
    northDeg: 2,
    thermalInertia: Float32Array.from(ti),
    albedo: Float32Array.from(albedo),
  }
}
const solarAt = (utc: number): MarsSolarTime => {
  const s = marsSolarTime(utc)
  if (!isAvailable(s)) throw new Error('fixture time')
  return s.value
}
const SOLAR = solarAt(Date.UTC(2026, 10, 10, 12))
const N = Number.NaN

describe('planTemperatureLayer', () => {
  it('gives cells with both inputs a run, shares one run within a bin, and skips cells with none', () => {
    const plan = planTemperatureLayer(
      grid([200, 205, N, 400, 200, 200, 200, 200, 50, 50, 50, 50], [0.2, 0.2, 0.2, 0.2, N, 0.2, 0.2, 0.2, 0.3, 0.3, 0.3, 0.3]),
      SOLAR,
    )
    // Row 0 (1.5°N): 200 and 205 share a bin; the NaN cell has none; 400 is its own.
    expect(plan.curveOf[0]).toBe(plan.curveOf[1])
    expect(plan.curveOf[2]).toBe(-1)
    expect(plan.curveOf[3]).not.toBe(plan.curveOf[0])
    // Row 1 (0.5°N) is in the 0° band, row 0 (1.5°N) in the 2° band: the same inputs, another run.
    expect(plan.curveOf[4]).toBe(-1)
    expect(plan.curveOf[5]).not.toBe(plan.curveOf[0])
    expect(plan.curveOf[6]).toBe(plan.curveOf[5])
    // Row 2 (0.5°S) is in the 0° band too, with another inertia and albedo: one run for its four cells.
    expect(new Set(Array.from(plan.curveOf.slice(8)))).toEqual(new Set([plan.curveOf[8]]))
    expect(plan.inputs).toHaveLength(4)
    for (const input of plan.inputs) {
      expect(input.surfacePressurePa).toBe(MEAN_SURFACE_PRESSURE_PA)
      expect(input.solarDeclinationDeg).toBe(plan.season.declinationDeg)
      expect(Number.isInteger(input.latitudeDeg / LAYER_BINS.latitudeDeg)).toBe(true)
    }
  })

  it('runs nothing poleward of the maps', () => {
    const polar: ThermalInputGrid = { ...grid([200, 200, 200, 200], [0.2, 0.2, 0.2, 0.2]), heightPx: 1, northDeg: 89 }
    const plan = planTemperatureLayer(polar, SOLAR)
    expect(Array.from(plan.curveOf)).toEqual([-1, -1, -1, -1])
    expect(plan.inputs).toHaveLength(0)
  })

  it('keeps one plan across a sol, since the season bin holds', () => {
    const a = seasonOf(solarAt(Date.UTC(2026, 10, 10, 0)))
    const b = seasonOf(solarAt(Date.UTC(2026, 10, 10, 20)))
    expect(a).toEqual(b)
    expect(seasonOf(solarAt(Date.UTC(2027, 3, 10)))).not.toEqual(a)
  })
})

describe('runLayerCurves and the read-back', () => {
  const plan = planTemperatureLayer(grid([200, 200, 200, 200, N, N, N, N, N, N, N, N], [0.2, 0.2, 0.2, 0.2, N, N, N, N, N, N, N, N]), SOLAR)
  const curves = runLayerCurves(plan.inputs)

  it('samples each run to the layer step count and matches the model within a step', () => {
    expect(curves).toHaveLength(plan.inputs.length * LAYER_CURVE_STEPS)
    const full = diurnalCurve(plan.inputs[0], DEFAULT_CHOICES)
    for (const hour of [0, 3.25, 6, 12, 13.5, 18, 23.9]) {
      expect(sampledCurveAt(curves, 0, hour)).toBeCloseTo(temperatureAtHour(full, hour), 0)
    }
  })

  it('reads every cell at its own local time, NaN where there is no run', () => {
    const k = layerTemperaturesK(grid([200, 200, 200, 200, N, N, N, N, N, N, N, N], [0.2, 0.2, 0.2, 0.2, N, N, N, N, N, N, N, N]), plan, curves, SOLAR)
    expect(k[4]).toBeNaN()
    for (let i = 0; i < 4; i++) {
      expect(k[i] - CELSIUS_OFFSET_K).toBeGreaterThan(-140)
      expect(k[i] - CELSIUS_OFFSET_K).toBeLessThan(40)
    }
    // Four degrees of longitude apart: the columns read the curve at different hours, so they differ unless the curve is flat there.
    expect(new Set(Array.from(k.slice(0, 4))).size).toBeGreaterThan(1)
  })

  it('a slice of runs equals the same runs from a full run', () => {
    const three = planTemperatureLayer(grid([100, 300, 900, N], [0.1, 0.2, 0.3, N]), SOLAR)
    const all = runLayerCurves(three.inputs)
    const tail = runLayerCurves(three.inputs, 1, 3)
    expect(Array.from(tail)).toEqual(Array.from(all.slice(LAYER_CURVE_STEPS)))
  })

  it('names the model, the bins, the fixed pressure and the error, and never calls itself a measurement', () => {
    const method = temperatureLayerMethod(plan, SOLAR)
    expect(method).toMatch(/not a measurement/)
    expect(method).toContain(`${LAYER_BINS.latitudeDeg}° band`)
    expect(method).toContain(`${MEAN_SURFACE_PRESSURE_PA} Pa everywhere`)
    expect(method).toMatch(/± 10 K/)
    expect(method).toContain(`${plan.inputs.length} runs`)
    // Shown in the legend and caption: no tracker number a reader cannot look up.
    expect(method).not.toMatch(/#\d/)
  })
})

describe('the runs are shared between workers', () => {
  it('counts workers from the cores, within one and eight', () => {
    expect(workerCount(undefined)).toBe(2)
    expect(workerCount(1)).toBe(1)
    expect(workerCount(12)).toBe(8)
    expect(workerCount(0)).toBe(1)
  })

  it('slices cover every run once, in order, with no empty slice', () => {
    expect(slices(10, 4)).toEqual([{ from: 0, to: 3 }, { from: 3, to: 6 }, { from: 6, to: 9 }, { from: 9, to: 10 }])
    expect(slices(0, 4)).toEqual([])
    expect(slices(2, 8)).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }])
  })
})

describe('a grid is placed on the whole-globe image by its edges', () => {
  it('the global 2 px/deg grid fills the image', () => {
    expect(gridImageRect({ widthPx: 720, heightPx: 360, pxPerDeg: 2, westDeg: -180, northDeg: 90 })).toEqual({
      x: 0,
      y: 0,
      w: GRID_IMAGE_WIDTH,
      h: GRID_IMAGE_HEIGHT,
    })
  })

  it('a cut lands at its west and north edges, sized by its cells per degree', () => {
    // Fixture geometry: 10° × 10° from 70° E, 25° N at 20 px/deg.
    const rect = gridImageRect({ widthPx: 200, heightPx: 200, pxPerDeg: 20, westDeg: 70, northDeg: 25 })
    expect(rect.x).toBeCloseTo((250 / 360) * GRID_IMAGE_WIDTH)
    expect(rect.y).toBeCloseTo((65 / 180) * GRID_IMAGE_HEIGHT)
    expect(rect.w).toBeCloseTo((10 / 360) * GRID_IMAGE_WIDTH)
    expect(rect.h).toBeCloseTo((10 / 180) * GRID_IMAGE_HEIGHT)
  })
})
