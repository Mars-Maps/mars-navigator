import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { official, type MapLayer, type MissionSite } from '../../src/domain'
import { IntroPanelView, type IntroConstant } from '../../src/features/mission-ui/IntroPanel'
import { KEEPS_WELCOME_ATTRIBUTE } from '../../src/app/viewModeTriggers'

// Test fixtures only: invented figures and provenance, never shown in the app.
const CONSTANTS: Record<string, IntroConstant> = {
  distance: { label: 'Fixture distance', unit: 'million km', value: official(1.234, 'fixture-source-a') },
  day: { label: 'Fixture day', unit: 'h', value: official(5.6789, 'fixture-source-b'), note: 'fixture day note' },
  temperature: { label: 'Fixture temperature', unit: 'K', value: { classification: 'UNAVAILABLE', reason: 'fixture no value' } },
}
const LAYER: MapLayer = {
  id: 'satellite',
  label: 'Fixture mosaic',
  classification: 'OFFICIAL',
  source: 'fixture-layer-source',
  provider: 'fixture provider',
  licence: 'fixture-licence',
  caveat: 'fixture caveat',
  previewUrl: 'https://fixture.invalid/tile.jpg',
  legend: { kind: 'none', reason: 'fixture: no legend' },
}

const render = (picture: MapLayer | null = LAYER) =>
  renderToStaticMarkup(
    <IntroPanelView constants={CONSTANTS} picture={picture} onClose={() => undefined} />,
  )

// Test fixture only: an invented site, never shown in the app.
const SITE: MissionSite = {
  id: 'fixture',
  name: 'Fixture crater',
  mission: 'Fixture mission line.',
  centre: { latitude: 1, longitudeEast: 2 },
  bounds: { west: 1, east: 3, south: 0, north: 2 },
  map: { id: 'SIM 0000', title: 'Fixture map', scaleDenominator: 1, citation: 'fixture-map-citation' },
  source: 'fixture-site-source',
}

describe('IntroPanelView', () => {
  it('has the large title, the line and the close button', () => {
    const html = render()
    expect(html).toContain('>Mars</h1>')
    expect(html).toContain('Click anywhere or zoom in to start exploring')
    expect(html).toContain('aria-label="Close intro"')
  })

  it('shows every figure it is given, in order, exactly as given, with its classification', () => {
    const html = render()
    const order = ['Fixture distance', 'Fixture day', 'Fixture temperature'].map((l) => html.indexOf(l))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('1.234 million km')
    expect(html).toContain('5.6789 h')
    expect(html).toContain('fixture day note')
    expect(html.match(/OFFICIAL/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('shows an unavailable figure as unavailable, never as 0', () => {
    const html = render()
    expect(html).toContain('unavailable')
    expect(html).toContain('fixture no value')
    expect(html).not.toMatch(/>0 K</)
  })

  it('crops the base layer\'s preview tile round and says what it is', () => {
    const html = render()
    expect(html).toContain('src="https://fixture.invalid/tile.jpg"')
    expect(html).toContain('alt="Fixture mosaic, one map tile"')
    expect(html).toContain('title="fixture-layer-source · fixture-licence"')
    expect(html).toContain('Picture: one map tile, not a photo of the globe')
    // Where the tile is from is in the mark, with the layer's caveat.
    expect(html).toContain('One Mars Trek map tile, cropped round.')
    expect(html).toContain('fixture caveat')
  })

  it('shows a plain disc and no credit until there is a picture', () => {
    for (const picture of [null, { ...LAYER, previewUrl: null }]) {
      const html = render(picture)
      expect(html).not.toContain('<img')
      expect(html).not.toContain('Picture:')
    }
  })
})

describe('IntroPanelView site', () => {
  const renderSite = (ellipseReason: string | null = null, onStart?: () => void) =>
    renderToStaticMarkup(
      <IntroPanelView
        constants={CONSTANTS}
        picture={LAYER}
        site={SITE}
        ellipseReason={ellipseReason}
        onStart={onStart}
        onClose={() => undefined}
      />,
    )

  it('names the site, with its mission and source in the mark beside it, and offers to go there', () => {
    const html = renderSite(null, () => undefined)
    expect(html).toContain('>Fixture crater · the Mars 2020 landing site</span>')
    // A hover mark, not a paragraph and not a button: a click here leaves the welcome screen.
    expect(html).toContain('<span class="sr-only">Fixture mission line. fixture-site-source</span>')
    expect(html).toContain('title="fixture-site-source"')
    expect(html).toContain('>Go to Fixture crater</button>')
    expect(html).not.toContain('Landing ellipse not shown')
  })

  it('marks only the Go to button as leaving welcome itself, so its click lands', () => {
    const html = renderSite(null, () => undefined)
    const buttons = html.match(/<button[^>]*>/g) ?? []
    const keepers = buttons.filter((b) => b.includes(`${KEEPS_WELCOME_ATTRIBUTE}=""`))
    expect(keepers).toHaveLength(1)
    expect(html).toMatch(new RegExp(`${KEEPS_WELCOME_ATTRIBUTE}=""[^>]*>Go to Fixture crater</button>`))
    // Close and the rest of the intro still leave welcome on a click: "click anywhere".
    expect(buttons.find((b) => b.includes('Close intro'))).not.toContain(KEEPS_WELCOME_ATTRIBUTE)
  })

  it('says why the ellipse is missing, and shows no button without a way to start', () => {
    const html = renderSite('fixture reason')
    expect(html).toContain('Landing ellipse not shown: fixture reason')
    expect(html).not.toContain('Go to Fixture crater')
  })

  it('shows neither line nor button without a site', () => {
    expect(render()).not.toContain('landing site')
    expect(render()).not.toContain('Go to ')
  })
})
