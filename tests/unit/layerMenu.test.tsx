import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LAYER_SOURCES } from '../../src/data/layers/layerSources'
import type { MapLayer, MapLayerId } from '../../src/domain'
import { LayerMenuView } from '../../src/features/mission-ui/LayerMenu'
import { shortTitle } from '../../src/features/mission-ui/layerTitle'

// Test fixtures only: invented provenance, never shown in the app.
const FIXTURE: MapLayer[] = [
  {
    id: 'satellite',
    label: 'Fixture satellite (test mosaic)',
    classification: 'SIMULATED',
    source: 'fixture-source-satellite',
    provider: 'fixture provider',
    licence: 'fixture-licence-satellite',
    caveat: 'fixture caveat, not true colour',
    previewUrl: 'https://example.test/preview-satellite.jpg',
    legend: { kind: 'none', reason: 'fixture: no legend' },
  },
  {
    id: 'elevation',
    label: 'Fixture elevation',
    classification: 'OFFICIAL',
    source: 'fixture-source-elevation',
    provider: 'fixture provider',
    licence: 'fixture-licence-elevation',
    caveat: null,
    previewUrl: null,
    legend: { kind: 'none', reason: 'fixture: no legend' },
  },
]

const render = (layers: MapLayer[], activeLayerId: MapLayerId = 'satellite') =>
  renderToStaticMarkup(
    <LayerMenuView layers={layers} activeLayerId={activeLayerId} onSelect={() => {}} />,
  )

const count = (html: string, needle: string) => html.split(needle).length - 1

describe('shortTitle', () => {
  it('keeps the word before the bracket, or the whole label', () => {
    expect(shortTitle('Satellite (Viking colour mosaic)')).toBe('Satellite')
    expect(shortTitle('Elevation')).toBe('Elevation')
  })
})

describe('LayerMenuView', () => {
  it('says the layers are not loaded instead of showing an empty grid', () => {
    const html = render([])
    expect(html).toContain('Layer data not loaded yet')
    // The title bar's minimise button only: no tile to pick.
    expect(count(html, '<button')).toBe(1)
    expect(html).toContain('aria-label="Minimise Layers"')
    expect(html).not.toContain('legend')
  })

  it('shows one tile per layer with its preview and short title, and nothing more', () => {
    const html = render(FIXTURE)
    // Two tiles and the title bar's minimise button.
    expect(count(html, '<button')).toBe(3)
    expect(count(html, 'aria-pressed=')).toBe(2)
    expect(html).toContain('src="https://example.test/preview-satellite.jpg"')
    expect(html).toContain('>Fixture satellite<')
    expect(html).toContain('>Fixture elevation<')
    // Provenance lives in the scene caption now, not here.
    expect(html).not.toContain('fixture-source-')
    expect(html).not.toContain('fixture-licence-')
    expect(html).not.toContain('Source:')
    expect(html).not.toContain('OFFICIAL')
  })

  it('keeps the full label as the accessible name and the caveat as the tooltip', () => {
    const html = render(FIXTURE)
    expect(html).toContain('aria-label="Fixture satellite (test mosaic)"')
    expect(html).toContain('title="fixture caveat, not true colour"')
    // Without a caveat the tooltip is the label, never "null".
    expect(html).toContain('title="Fixture elevation"')
    expect(html).not.toContain('null')
  })

  it('shows an empty tile, not a broken image, when there is no preview', () => {
    const html = render(FIXTURE)
    expect(count(html, '<img')).toBe(1)
    expect(html).toContain('No preview')
  })

  it('marks only the active layer as pressed and titles its legend', () => {
    const html = render(FIXTURE, 'elevation')
    expect(count(html, 'aria-pressed="true"')).toBe(1)
    expect(count(html, 'aria-pressed="false"')).toBe(1)
    expect(html).toContain('Fixture elevation legend')
    expect(html).not.toContain('Fixture satellite legend')
  })

  it('says the active layer is not loaded when it is not in the list', () => {
    const html = render(FIXTURE, 'thermal')
    expect(html).toContain('Selected layer “thermal” is not loaded')
    expect(html).not.toContain('legend')
    expect(html).not.toContain('aria-pressed="true"')
  })

  it('shows no not-loaded note when the active layer is in the list', () => {
    expect(render(FIXTURE, 'elevation')).not.toContain('is not loaded')
  })
})

describe('layer previews', () => {
  it('puts the greyed satellite preview under every other preview, not under itself', () => {
    const thermal: MapLayer = {
      ...FIXTURE[1],
      id: 'thermal',
      label: 'Fixture thermal',
      previewUrl: 'https://example.test/preview-thermal.png',
    }
    const html = render([FIXTURE[0], thermal])
    // Two tiles, three images: the thermal tile carries the base underneath.
    expect(count(html, '<img')).toBe(3)
    expect(count(html, 'src="https://example.test/preview-satellite.jpg"')).toBe(2)
    expect(html).toMatch(/src="https:\/\/example.test\/preview-satellite.jpg"[^>]*grayscale/)
  })

  it('shows no base under a layer that has no preview of its own', () => {
    const html = render(FIXTURE)
    expect(count(html, '<img')).toBe(1)
  })

  it('every source offers a zoom-1 Trek tile as its preview', () => {
    for (const s of Object.values(LAYER_SOURCES)) {
      expect(s?.layer.previewUrl).toMatch(/\/default028mm\/1\/0\/1\.(jpg|png)$/)
      expect(s?.layer.previewUrl).toContain(s?.trekLayer ?? '')
    }
  })
})
