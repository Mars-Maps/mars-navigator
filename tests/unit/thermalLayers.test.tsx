import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseThermalGrid } from '../../src/data/adapters/ThermalGridAdapter'
import {
  INERTIA_RAMP,
  TEMPERATURE_RAMP_C,
  TES_INERTIA_LAYER,
  gridValues,
  modelledTemperatureLayer,
} from '../../src/data/thermal/thermalLayers'
import { LayerLegendRamp } from '../../src/features/mission-ui/LayerLegendRamp'
import { LABEL_GAP_PERCENT, labelledStops, NO_RAMP_STOPS } from '../../src/features/mission-ui/legendLabels'
import { LayerMenuView } from '../../src/features/mission-ui/LayerMenu'
import { ThermalSettingsView } from '../../src/features/mission-ui/ThermalSettings'
import { unavailable } from '../../src/domain'
import { parseRamp } from '../../src/lib/colorRamp'

// Test fixture only: an invented 3 × 1 grid at 1 px/deg, not TES values.
const bytesOf = (values: number[]) => {
  const view = new DataView(new ArrayBuffer(values.length * 2))
  values.forEach((v, i) => view.setUint16(i * 2, v, true))
  return view.buffer
}
const sidecar = {
  grid: 'fixture',
  quantity: 'albedo',
  scale: 0.0001,
  validRange: [0, 1],
  widthPx: 3,
  heightPx: 1,
  pxPerDeg: 1,
  westDeg: 0,
  northDeg: 1,
  noData: 0,
  citation: 'Fixture citation',
  resampling: 'fixture',
  noDataRule: 'fixture rule',
}

describe('the grid layers', () => {
  it('reads a grid as its quantity, NaN where it has none', () => {
    const grid = parseThermalGrid(sidecar, bytesOf([1500, 0, 2500]), 'albedo')
    const values = Array.from(gridValues(grid))
    expect(values[0]).toBeCloseTo(0.15, 6)
    expect(values[1]).toBeNaN()
    expect(values[2]).toBeCloseTo(0.25, 6)
  })

  it('the thermal inertia layer is OFFICIAL, cites the PDS grid and says the colours are ours', () => {
    expect(TES_INERTIA_LAYER.id).toBe('thermal')
    expect(TES_INERTIA_LAYER.classification).toBe('OFFICIAL')
    expect(TES_INERTIA_LAYER.source).toMatch(/Putzig.*10\.1016\/j\.icarus\.2007\.05\.013/)
    expect(TES_INERTIA_LAYER.provider).toMatch(/PDS/)
    expect(TES_INERTIA_LAYER.caveat).toMatch(/project's/)
    expect(TES_INERTIA_LAYER.legend.kind).toBe('ramp')
    if (TES_INERTIA_LAYER.legend.kind !== 'ramp') return
    expect(TES_INERTIA_LAYER.legend.unit).toBe('J m⁻² K⁻¹ s⁻½')
    expect(TES_INERTIA_LAYER.legend.note).toMatch(/this project's/)
    expect(TES_INERTIA_LAYER.legend.note).toMatch(/87°/)
  })

  it('the temperature layer is DERIVED, carries the method and the bound, never a measurement', () => {
    const layer = modelledTemperatureLayer('fixture method', 10)
    expect(layer.classification).toBe('DERIVED')
    expect(layer.source).toBe('fixture method')
    expect(layer.caveat).toMatch(/± 10 K/)
    expect(layer.caveat).toMatch(/never a measurement/)
    expect(layer.legend.kind).toBe('ramp')
    if (layer.legend.kind !== 'ramp') return
    expect(layer.legend.unit).toBe('°C')
    expect(layer.legend.classification).toBe('DERIVED')
    expect(layer.legend.source).toBe('fixture method')
  })

  it('both ramps rise and parse; the stops cover the common Mars range', () => {
    expect(() => parseRamp(INERTIA_RAMP)).not.toThrow()
    expect(() => parseRamp(TEMPERATURE_RAMP_C)).not.toThrow()
    expect(INERTIA_RAMP[0].value).toBeLessThanOrEqual(100)
    expect(INERTIA_RAMP.at(-1)?.value).toBeGreaterThanOrEqual(500)
    expect(TEMPERATURE_RAMP_C[0].value).toBeLessThanOrEqual(-120)
    expect(TEMPERATURE_RAMP_C.at(-1)?.value).toBeGreaterThanOrEqual(10)
  })
})

describe('the ramp legend', () => {
  it('draws the bar from the stops, labels each stop and the unit, and marks the classification', () => {
    if (TES_INERTIA_LAYER.legend.kind !== 'ramp') throw new Error('expected a ramp')
    const html = renderToStaticMarkup(<LayerLegendRamp legend={TES_INERTIA_LAYER.legend} />)
    expect(html).toContain('linear-gradient(to right, #cde2fb 0.0%')
    expect(html).toContain('>50<')
    expect(html).toContain('>800<')
    // 100 sits 6.7 % along the bar, on top of 50: its colour shows, its label does not.
    expect(html).not.toContain('>100<')
    expect(html).toContain('>200<')
    expect(html).toContain('J m⁻² K⁻¹ s⁻½')
    expect(html).toContain('OFFICIAL')
    expect(html).toContain('under 50 and over 800 take the end colours')
    expect(html).toContain("this project&#x27;s")
  })

  it('writes the ends always and drops a label that would overlap its neighbour', () => {
    const stops = [{ value: 0 }, { value: 5 }, { value: 50 }, { value: 95 }, { value: 100 }]
    expect(labelledStops(stops).map((l) => l.value)).toEqual([0, 50, 100])
    expect(labelledStops([{ value: 3 }]).map((l) => l.value)).toEqual([3])
    expect(labelledStops([])).toEqual([])
    expect(LABEL_GAP_PERCENT).toBeGreaterThan(5)
  })

  it('offers the scale as the picker tile\'s preview, an SVG data URL', () => {
    expect(TES_INERTIA_LAYER.previewUrl).toMatch(/^data:image\/svg\+xml,/)
    expect(decodeURIComponent(TES_INERTIA_LAYER.previewUrl ?? '')).toContain('stop-color="#0d366b"')
  })

  it('writes a true minus for a cold stop', () => {
    const layer = modelledTemperatureLayer('fixture method', 10)
    if (layer.legend.kind !== 'ramp') throw new Error('expected a ramp')
    const html = renderToStaticMarkup(<LayerLegendRamp legend={layer.legend} />)
    expect(html).toContain('>−130<')
    expect(html).toContain('>20<')
    expect(html).toContain('DERIVED')
  })

  // The type allows an empty list; the legend says so instead of throwing.
  it('with no stops, says no scale can be drawn and keeps its heading and note', () => {
    const layer = modelledTemperatureLayer('fixture method', 10)
    if (layer.legend.kind !== 'ramp') throw new Error('expected a ramp')
    const html = renderToStaticMarkup(<LayerLegendRamp legend={{ ...layer.legend, stops: [] }} />)
    expect(html).toContain(NO_RAMP_STOPS)
    expect(html).not.toContain('data-legend-ramp')
    expect(html).toContain('DERIVED')
    expect(html).toContain(layer.legend.note.replaceAll("'", '&#x27;'))
  })

  it('the layer menu shows it for a grid layer in place of the tile layer', () => {
    const html = renderToStaticMarkup(
      <LayerMenuView layers={[TES_INERTIA_LAYER]} activeLayerId="thermal" onSelect={() => {}} />,
    )
    expect(html).toContain('data-legend-ramp')
    expect(html).toContain('Apparent thermal inertia')
  })
})

describe('the thermal settings offer four variants', () => {
  const render = (variant: 'day' | 'night' | 'inertia' | 'temperature', progress: { done: number; total: number } | null = null) =>
    renderToStaticMarkup(<ThermalSettingsView variant={variant} onSelect={() => {}} localTime={unavailable('fixture')} progress={progress} />)

  it('marks the chosen variant pressed, and only that one', () => {
    const html = render('inertia')
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-pressed="true"[^>]*>Thermal inertia</)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Temperature \(modelled\)</)
  })

  it('reports the model runs while they go, and nothing once done', () => {
    expect(render('temperature', { done: 0, total: 0 })).toContain('Reading the TES grids')
    expect(render('temperature', { done: 1200, total: 6927 })).toContain('Running the temperature model: 1,200 of 6,927 runs')
    expect(render('temperature', null)).not.toContain('data-thermal-progress')
  })

  // The live region is there before its first words, so they are announced; it is empty and hidden when idle.
  it('keeps one status region mounted, empty and visually hidden when no model runs', () => {
    const idle = render('temperature', null)
    expect(idle).toMatch(/<p role="status" class="sr-only"><\/p>/)
    const running = render('temperature', { done: 0, total: 0 })
    expect(running).toMatch(/<p role="status" class="[^"]*text-caption[^"]*"><span data-thermal-progress="">Reading the TES grids…<\/span><\/p>/)
    expect(running.match(/role="status"/g)).toHaveLength(1)
  })
})
