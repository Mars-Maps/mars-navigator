import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Classified, GeologicUnitArea, MapLayer, MarsSolarTime, RoverTraverse, TraversePoint } from '../../src/domain'
import { SurfaceCaptionView } from '../../src/features/mars-3d/SurfaceCaption'
import type { SurfaceImage } from '../../src/state'

// Test fixtures only: invented provenance, never shown in the app.
const SATELLITE: MapLayer = {
  id: 'satellite',
  label: 'Fixture satellite',
  classification: 'OFFICIAL',
  source: 'fixture-source',
  provider: 'NASA Mars Trek',
  licence: 'fixture-licence',
  caveat: 'fixture caveat',
  previewUrl: 'fixture-preview',
  legend: { kind: 'none', reason: 'fixture: no legend' },
}
const THERMAL: MapLayer = {
  id: 'thermal',
  label: 'Fixture thermal',
  classification: 'OFFICIAL',
  source: 'fixture-source',
  provider: 'NASA Mars Trek',
  licence: 'fixture-licence',
  caveat: null,
  previewUrl: 'fixture-preview',
  legend: { kind: 'none', reason: 'fixture: no legend' },
}
const LAYERS = [SATELLITE, THERMAL]
// Fixture sun position: the numbers are never shown by the caption.
const SUN: Classified<MarsSolarTime> = {
  classification: 'DERIVED',
  method: 'fixture sun method',
  value: {
    marsSolDate: 0,
    coordinatedMarsTimeHours: 0,
    heliocentricDistanceAu: 1.52,
    solarLongitudeDeg: 0,
    equationOfTimeDeg: 0,
    subsolarPoint: { latitude: 0, longitudeEast: 0 },
  },
}

const ready = (base: Extract<SurfaceImage, { status: 'ready' }>['base']): SurfaceImage => ({
  status: 'ready',
  layerId: 'thermal',
  image: {} as HTMLCanvasElement, // never read by the caption
  sourceResolution: { classification: 'DERIVED', value: '100 m/px', method: 'fixture' },
  servedResolution: { classification: 'UNAVAILABLE', reason: 'fixture not served' },
  base,
})

const render = (
  surface: SurfaceImage | null,
  extra: Partial<{
    routeLine: boolean
    drawnPath: string
    detail: { classification: 'DERIVED'; value: string; method: string }
    sun: Classified<MarsSolarTime>
    sunShading: boolean
    geology: Classified<GeologicUnitArea[]>
    traverse: Classified<RoverTraverse>
  }> = {},
) =>
  renderToStaticMarkup(
    <SurfaceCaptionView
      surface={surface}
      layers={LAYERS}
      routeLine={extra.routeLine ?? false}
      drawnPath={extra.drawnPath ?? null}
      detail={extra.detail ?? null}
      sun={extra.sun ?? SUN}
      sunShading={extra.sunShading ?? true}
      geology={extra.geology ?? null}
      traverse={extra.traverse ?? null}
    />,
  )

describe('SurfaceCaptionView', () => {
  it('says the day and night come from the sun model, DERIVED, with the method in the mark', () => {
    const html = render(null)
    expect(html).toContain('Day and night from the Mars24 sun position at the mission time')
    expect(html).toContain('>fixture sun method<')
    expect(html).toContain('DERIVED')
    expect(html).not.toContain('Sun position unavailable')
  })

  it('says the lighting is neutral when the sun position is unavailable, with the reason', () => {
    const html = render(null, { sun: { classification: 'UNAVAILABLE', reason: 'fixture no sun' } })
    expect(html).toContain('Sun position unavailable: fixture no sun; lit evenly, no day or night')
    expect(html).toContain('UNAVAILABLE')
    expect(html).not.toContain('Day and night from')
  })

  it('says how to hide the shading while it shows', () => {
    expect(render(null)).toContain('at the mission time; right-click to hide the shading')
  })

  it('says the globe is lit evenly while the shading is hidden, and how to show it', () => {
    const html = render(null, { sunShading: false })
    expect(html).toContain('Sun shading hidden: lit evenly. Right-click to show day and night')
    expect(html).not.toContain('Day and night from')
  })

  it('reports an unavailable sun position whether or not shading is on', () => {
    const html = render(null, { sun: { classification: 'UNAVAILABLE', reason: 'r' }, sunShading: false })
    expect(html).toContain('Sun position unavailable: r')
    expect(html).not.toContain('Sun shading hidden')
  })

  it('always labels the sped-up globe spin SIMULATED, whatever the surface state', () => {
    for (const surface of [null, { status: 'loading', layerId: 'satellite' } as const]) {
      const html = render(surface)
      expect(html).toContain('The globe turns faster than Mars does')
      expect(html).toContain('SIMULATED')
    }
  })

  it('names the loading layer, falling back to its id', () => {
    expect(render({ status: 'loading', layerId: 'satellite' })).toContain('Loading Fixture satellite…')
    expect(render({ status: 'loading', layerId: 'elevation' })).toContain('Loading elevation…')
    expect(render(null)).toContain('Loading surface layer…')
  })

  it('shows an unavailable layer with its reason and badge', () => {
    const html = render({ status: 'unavailable', layerId: 'thermal', reason: 'fixture reason' })
    expect(html).toContain('Fixture thermal unavailable: fixture reason')
    expect(html).toContain('UNAVAILABLE')
  })

  it('shows label, caveat only when present, licence and both resolutions when ready', () => {
    const html = render(ready({ status: 'not-needed' }))
    expect(html).toContain('Fixture thermal')
    expect(html).not.toContain(' — ') // thermal has no caveat
    expect(html).toContain('OFFICIAL')
    expect(html).toContain('NASA Mars Trek · fixture-licence · source 100 m/px, shown unavailable (fixture not served)')
    expect(html).not.toContain('Grey')
    expect(html).not.toContain('Detail tiles')
  })

  it('includes the caveat when the layer has one', () => {
    const html = renderToStaticMarkup(
      <SurfaceCaptionView
        surface={{ ...ready({ status: 'not-needed' }), layerId: 'satellite' }}
        layers={LAYERS}
        routeLine={false}
        detail={null}
        sun={SUN}
        sunShading
      />,
    )
    expect(html).toContain('Fixture satellite — fixture caveat')
  })

  it('names the greyed base layer, or says why gaps are unfilled', () => {
    expect(render(ready({ status: 'drawn', layerId: 'satellite' }))).toContain(
      'Grey Fixture satellite where this layer has no data',
    )
    const unfilled = render(ready({ status: 'unavailable', reason: 'base fixture reason' }))
    expect(unfilled).toContain('No-data areas unfilled: base fixture reason')
    // The badge; the served resolution's "unavailable (…)" is lower-case text.
    expect(unfilled).toContain('UNAVAILABLE')
    expect(render(ready({ status: 'not-needed' }))).not.toContain('UNAVAILABLE')
  })

  it('says a see-through grid layer lies over the grey base, and whose detail tiles are under it', () => {
    const canvas = {} as HTMLCanvasElement
    const draped = { ...ready({ status: 'drawn', layerId: 'satellite' }), drape: { under: canvas, over: canvas } } as SurfaceImage
    const html = render(draped, { detail: { classification: 'DERIVED', value: '463 m/px', method: 'fixture' } })
    expect(html).toContain('Grey Fixture satellite under this layer, seen through its colours, and alone where it has no data')
    // The shade is no longer the value alone: the caption says so.
    expect(html).toContain('shade can read up to about two legend')
    expect(html).toContain('Grey Fixture satellite detail tiles 463 m/px under it where loaded')
    expect(html).not.toContain('where this layer has no data')
    expect(html).not.toContain('Detail tiles 463')
  })

  it('adds the detail-tile line and the route-line note only when given', () => {
    const html = render(ready({ status: 'not-needed' }), {
      routeLine: true,
      detail: { classification: 'DERIVED', value: '325 m/px', method: 'fixture' },
    })
    expect(html).toContain('Detail tiles 325 m/px where loaded')
    expect(html).toContain('Route line joins your waypoints in order; not a planned path')
    expect(render(ready({ status: 'not-needed' }))).not.toContain('Route line')
  })

  it('names the drawn route\'s method instead of the note while navigating one', () => {
    const html = render(ready({ status: 'not-needed' }), {
      routeLine: true,
      drawnPath: 'fixture great-circle method',
    })
    // The apostrophe is HTML-escaped in static markup.
    expect(html).toMatch(/Route line is the selected route(&#x27;|')s path/)
    expect(html).toContain('fixture great-circle method')
    expect(html).toContain('DERIVED')
    expect(html).not.toContain('not a planned path')
    // No line at all without a route line, whatever the path says.
    expect(render(ready({ status: 'not-needed' }), { drawnPath: 'x' })).not.toContain('Route line')
  })

  it('renders nothing for a ready image whose layer is unknown, but keeps the spin label', () => {
    const html = renderToStaticMarkup(
      <SurfaceCaptionView
        surface={{ ...ready({ status: 'not-needed' }), layerId: 'elevation' }}
        layers={LAYERS}
        routeLine={false}
        detail={null}
        sun={SUN}
        sunShading
      />,
    )
    expect(html).not.toContain('NASA Mars Trek')
    expect(html).toContain('SIMULATED')
  })

  it('is a labelled aside', () => {
    expect(render(null)).toMatch(/^<aside aria-label="Surface provenance"/)
  })

  describe('minimized', () => {
    const collapsed = (open: boolean) =>
      renderToStaticMarkup(
        <SurfaceCaptionView
          surface={ready({ status: 'not-needed' })}
          layers={LAYERS}
          routeLine={false}
          detail={null}
          sun={SUN}
          sunShading
          collapsed={!open}
        />,
      )

    it('offers a minimize button when open', () => {
      const html = collapsed(true)
      expect(html).toContain('aria-label="Minimize surface provenance"')
      expect(html).toContain('aria-expanded="true"')
    })

    it('shrinks to the info button alone; the corner label keeps simulated data labelled', () => {
      const html = collapsed(false)
      expect(html).toMatch(/^<aside aria-label="Surface provenance"/)
      expect(html).toContain('aria-label="Show surface provenance"')
      expect(html).toContain('aria-expanded="false"')
      expect(html).not.toContain('SIMULATED')
      expect(html).not.toContain('tabindex') // no mark beside the button
      expect(html).not.toContain('NASA Mars Trek')
      expect(html).not.toContain('Day and night')
    })
  })
})

describe('SurfaceCaptionView geology', () => {
  // Fixture only: an invented square and citation, not the map's.
  const unit = {
    symbol: 'Jf',
    name: 'Jezero floor unit',
    map: { id: 'SIM 3464', title: 'fixture', scaleDenominator: 75000, citation: 'fixture citation' },
  }
  const ring = [
    { latitude: 18, longitudeEast: 77 },
    { latitude: 18, longitudeEast: 77.1 },
    { latitude: 18.1, longitudeEast: 77.1 },
  ]

  it('cites each map behind the shown units, OFFICIAL', () => {
    const html = render(null, {
      geology: { classification: 'OFFICIAL', value: [{ unit, rings: [ring] }], source: 'fixture' },
    })
    expect(html).toContain('Geologic units from USGS SIM 3464, 1:75,000')
    expect(html).toContain('OFFICIAL')
  })

  it('says why the units are missing instead of showing none', () => {
    const html = render(null, {
      geology: { classification: 'UNAVAILABLE', reason: 'fixture: service down' },
    })
    expect(html).toContain('Detailed geologic units not shown: fixture: service down')
    expect(html).toContain('UNAVAILABLE')
  })

  it('says nothing about geology while the layer is off', () => {
    expect(render(null)).not.toContain('eologic')
  })
})

describe('SurfaceCaptionView rover path', () => {
  it('says why no path is drawn instead of drawing none silently', () => {
    const html = render(null, {
      traverse: { classification: 'UNAVAILABLE', reason: 'fixture: feed down' },
    })
    expect(html).toContain("Rover&#x27;s driven path not shown: fixture: feed down")
    expect(html).toContain('UNAVAILABLE')
  })

  it('names the rover and the sols for a loaded path, OFFICIAL', () => {
    // Fixture only: two invented waypoints, not Perseverance's feed.
    const point = (sol: number): TraversePoint => ({
      sol,
      rmc: { site: 1, drive: sol },
      coordinate: { latitude: 18.4, longitudeEast: 77.4 },
      elevationMeters: { classification: 'UNAVAILABLE', reason: 'fixture' },
      tiltDegrees: { classification: 'UNAVAILABLE', reason: 'fixture' },
    })
    const html = render(null, {
      traverse: {
        classification: 'OFFICIAL',
        source: 'fixture feed',
        value: { rover: 'perseverance', source: 'fixture', retrievedUtcMs: 0, points: [point(3), point(9)] },
      },
    })
    expect(html).toContain('Perseverance&#x27;s path (solid line, straight between waypoints), sols 3–9')
  })
})
