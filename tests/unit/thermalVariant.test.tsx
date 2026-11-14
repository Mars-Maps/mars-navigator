import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { describeThermalNight, readLayerCatalogue, withThermalVariant } from '../../src/app/surfaceLayers'
import { THERMAL_NIGHT_SOURCE } from '../../src/data/layers/layerSources'
import { LayerMenuView } from '../../src/features/mission-ui/LayerMenu'
import { useThermalVariant } from '../../src/state'

describe('the thermal variant store', () => {
  it('starts on Day, and only its setter changes it', () => {
    expect(useThermalVariant.getState().thermalVariant).toBe('day')
    useThermalVariant.getState().setThermalVariant('night')
    expect(useThermalVariant.getState().thermalVariant).toBe('night')
    useThermalVariant.getState().setThermalVariant('day')
  })
})

describe('withThermalVariant', () => {
  const day = readLayerCatalogue()

  it('the night mosaic passes the same checks as every layer source', () => {
    const night = describeThermalNight()
    expect(night.status).toBe('available')
    if (night.status === 'available') expect(night.source).toBe(THERMAL_NIGHT_SOURCE)
  })

  it('Day is the day catalogue itself', () => {
    expect(withThermalVariant(day, 'day')).toBe(day)
  })

  it('Night swaps the thermal entry and its menu layer, and leaves every other entry the same object', () => {
    const night = withThermalVariant(day, 'night')
    const thermal = night.byId.get('thermal')
    expect(thermal?.status === 'available' && thermal.source).toBe(THERMAL_NIGHT_SOURCE)
    expect(night.layers.find((l) => l.id === 'thermal')).toBe(THERMAL_NIGHT_SOURCE.layer)
    for (const id of ['satellite', 'elevation', 'geology'] as const) expect(night.byId.get(id)).toBe(day.byId.get(id))
    expect(night.layers.map((l) => l.id)).toEqual(day.layers.map((l) => l.id))
  })

  it('a night source that fails its check drops thermal from the menu and keeps the reason', () => {
    const night = withThermalVariant(day, 'night', { status: 'unavailable', id: 'thermal', reason: 'fixture reason' })
    expect(night.layers.some((l) => l.id === 'thermal')).toBe(false)
    expect(night.byId.get('thermal')).toEqual({ status: 'unavailable', id: 'thermal', reason: 'fixture reason' })
  })
})

describe('LayerMenuView shows the thermal settings it is given', () => {
  const { layers } = readLayerCatalogue()
  it('above the legend they choose, and nothing when none is given', () => {
    const settings = <p>fixture thermal settings</p>
    const html = renderToStaticMarkup(
      <LayerMenuView layers={layers} activeLayerId="thermal" onSelect={() => {}} thermal={settings} />,
    )
    const legendAt = html.indexOf('Thermal legend')
    expect(legendAt).toBeGreaterThan(-1)
    expect(html.indexOf('fixture thermal settings')).toBeLessThan(legendAt)
    // Still inside the lower section, under the tiles.
    expect(html.indexOf('fixture thermal settings')).toBeGreaterThan(html.lastIndexOf('</ul>'))
    expect(
      renderToStaticMarkup(<LayerMenuView layers={layers} activeLayerId="satellite" onSelect={() => {}} />),
    ).not.toContain('fixture thermal settings')
  })

  it('still shows them when thermal is selected but not in the list, so Day stays reachable', () => {
    const withoutThermal = layers.filter((l) => l.id !== 'thermal')
    const html = renderToStaticMarkup(
      <LayerMenuView layers={withoutThermal} activeLayerId="thermal" onSelect={() => {}} thermal={<p>fixture thermal settings</p>} />,
    )
    expect(html).toContain('is not loaded')
    expect(html).toContain('fixture thermal settings')
  })
})
