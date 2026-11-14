import { describe, expect, it } from 'vitest'
import type { Classified, MapLayer, MarsSolarTime } from '../../src/domain'
import { captionAlerts, caveatAlert, opensCaption, isFailureAlert } from '../../src/features/mars-3d/captionAlerts'
import { GEOLOGY_LOADING_REASON } from '../../src/features/mars-3d/geologyLabel'
import { TRAVERSE_LOADING_REASON, retryingReason } from '../../src/features/mars-3d/traverseLabel'
import type { SurfaceImage } from '../../src/state'

// Test fixtures only: invented provenance, never shown in the app.
const SATELLITE: MapLayer = {
  id: 'satellite',
  label: 'Fixture satellite',
  classification: 'OFFICIAL',
  source: 'fixture-source',
  provider: 'fixture provider',
  licence: 'fixture-licence',
  caveat: 'fixture caveat',
  previewUrl: 'fixture-preview',
  legend: { kind: 'none', reason: 'fixture: no legend' },
}
const THERMAL: MapLayer = { ...SATELLITE, id: 'thermal', label: 'Fixture thermal', caveat: null }
const LAYERS = [SATELLITE, THERMAL]
// Fixture sun position: the numbers are never read by the alerts.
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
const NO_SUN: Classified<MarsSolarTime> = { classification: 'UNAVAILABLE', reason: 'fixture no sun' }

const ready = (
  layerId: MapLayer['id'],
  base: Extract<SurfaceImage, { status: 'ready' }>['base'] = { status: 'not-needed' },
): SurfaceImage => ({
  status: 'ready',
  layerId,
  image: {} as HTMLCanvasElement, // never read by the alerts
  sourceResolution: { classification: 'DERIVED', value: '100 m/px', method: 'fixture' },
  servedResolution: { classification: 'DERIVED', value: '1 km/px', method: 'fixture' },
  base,
})

const alerts = (
  input: Partial<Parameters<typeof captionAlerts>[0]> = {},
): string[] =>
  captionAlerts({
    surface: null,
    layers: LAYERS,
    activeLayerId: 'thermal',
    routeLine: false,
    sun: SUN,
    ...input,
  })

describe('captionAlerts', () => {
  it('is empty for a layer with no caveat, a sun position and no route line', () => {
    expect(alerts({ surface: ready('thermal') })).toEqual([])
  })

  it('reports a layer that failed to load', () => {
    const failed: SurfaceImage = { status: 'unavailable', layerId: 'thermal', reason: 'fixture' }
    expect(alerts({ surface: failed })).toEqual(['layer-unavailable:thermal'])
  })

  it('reports a base layer that could not be drawn under the gaps', () => {
    const surface = ready('thermal', { status: 'unavailable', reason: 'fixture base failed' })
    expect(alerts({ surface })).toEqual(['base-unavailable:thermal'])
    expect(alerts({ surface: ready('thermal', { status: 'drawn', layerId: 'satellite' }) })).toEqual([])
  })

  it('reports an unavailable sun position', () => {
    expect(alerts({ sun: NO_SUN })).toEqual(['sun-unavailable'])
  })

  it('reports the chosen layer\'s caveat while it loads too, so a reload is not new', () => {
    const loading: SurfaceImage = { status: 'loading', layerId: 'satellite' }
    expect(alerts({ activeLayerId: 'satellite', surface: loading })).toEqual([caveatAlert('satellite')])
    expect(alerts({ activeLayerId: 'satellite', surface: ready('satellite') })).toEqual([
      caveatAlert('satellite'),
    ])
  })

  it('has no caveat key before the catalogue arrives', () => {
    expect(alerts({ activeLayerId: 'satellite', layers: [] })).toEqual([])
  })

  it('reports a route line', () => {
    expect(alerts({ routeLine: true })).toEqual(['route-line'])
  })

  it('reports everything at once, one key each', () => {
    const failed: SurfaceImage = { status: 'unavailable', layerId: 'satellite', reason: 'fixture' }
    expect(
      alerts({ surface: failed, activeLayerId: 'satellite', sun: NO_SUN, routeLine: true }),
    ).toEqual(['layer-unavailable:satellite', 'sun-unavailable', caveatAlert('satellite'), 'route-line'])
  })
})

describe('opensCaption', () => {
  const SAT_CAVEAT = caveatAlert('satellite')

  it('stays minimized on load when nothing is wrong', () => {
    expect(opensCaption([], [])).toBe(false)
  })

  it('stays minimized when the load-time layer\'s caveat arrives with the catalogue', () => {
    expect(opensCaption([], [SAT_CAVEAT])).toBe(false)
  })

  it('opens on load when something is already wrong', () => {
    expect(opensCaption([], ['layer-unavailable:satellite'])).toBe(true)
    expect(opensCaption([], [SAT_CAVEAT, 'sun-unavailable'])).toBe(true)
  })

  it('opens for a new error after the layer has loaded', () => {
    expect(opensCaption([SAT_CAVEAT], [SAT_CAVEAT, 'base-unavailable:satellite'])).toBe(true)
  })

  // Caveats and notes wait behind the info button; only a failure opens the caption.
  it('stays minimized when the user switches to a layer with a caveat', () => {
    expect(opensCaption([SAT_CAVEAT], [caveatAlert('geology')])).toBe(false)
  })

  it('stays minimized when the user comes back to the load-time layer', () => {
    expect(opensCaption([], [SAT_CAVEAT])).toBe(false)
  })

  it('stays minimized when a route line appears', () => {
    expect(opensCaption([SAT_CAVEAT], [SAT_CAVEAT, 'route-line'])).toBe(false)
  })

  it('opens for a failed rover path or geology read', () => {
    expect(opensCaption([SAT_CAVEAT], [SAT_CAVEAT, 'traverse-unavailable'])).toBe(true)
    expect(opensCaption([], ['geology-unavailable'])).toBe(true)
  })

  it('does not reopen for alerts already seen, or when one goes away', () => {
    expect(opensCaption(['layer-unavailable:satellite', 'route-line'], ['layer-unavailable:satellite', 'route-line'])).toBe(false)
    expect(opensCaption([SAT_CAVEAT, 'route-line'], [SAT_CAVEAT])).toBe(false)
  })

  it('reopens for the same error when it comes back after clearing', () => {
    expect(opensCaption([], ['layer-unavailable:thermal'])).toBe(true)
  })

  it('names exactly the failure keys', () => {
    for (const key of ['layer-unavailable:x', 'base-unavailable:x', 'sun-unavailable', 'traverse-unavailable', 'geology-unavailable']) {
      expect(isFailureAlert(key), key).toBe(true)
    }
    for (const key of [SAT_CAVEAT, 'route-line']) expect(isFailureAlert(key), key).toBe(false)
  })
})

describe('captionAlerts: the rover path', () => {
  it('alerts on a failed read that stands, not on one still loading, being retried, or none asked', () => {
    expect(alerts({ traverse: { classification: 'UNAVAILABLE', reason: 'fixture: HTTP 503' } })).toContain('traverse-unavailable')
    expect(alerts({ traverse: { classification: 'UNAVAILABLE', reason: TRAVERSE_LOADING_REASON } })).not.toContain('traverse-unavailable')
    // The first failures are retried after 5, 20 and 60 s; the caption lists them but does not open.
    expect(alerts({ traverse: { classification: 'UNAVAILABLE', reason: retryingReason('fixture: HTTP 503') } })).not.toContain('traverse-unavailable')
    expect(alerts({ traverse: null })).not.toContain('traverse-unavailable')
  })

  it('opens the caption when the read fails for good after loading, and not again on a repeat', () => {
    const loading = alerts({ traverse: { classification: 'UNAVAILABLE', reason: TRAVERSE_LOADING_REASON } })
    const retrying = alerts({ traverse: { classification: 'UNAVAILABLE', reason: retryingReason('fixture: HTTP 503') } })
    const failed = alerts({ traverse: { classification: 'UNAVAILABLE', reason: 'fixture: HTTP 503' } })
    expect(opensCaption(loading, retrying)).toBe(false)
    expect(opensCaption(retrying, failed)).toBe(true)
    expect(opensCaption(failed, failed)).toBe(false)
  })
})

describe('captionAlerts: the geologic units', () => {
  it('alerts on a failed read, not while loading', () => {
    expect(alerts({ geology: { classification: 'UNAVAILABLE', reason: 'fixture: HTTP 503' } })).toContain('geology-unavailable')
    expect(alerts({ geology: { classification: 'UNAVAILABLE', reason: GEOLOGY_LOADING_REASON } })).not.toContain('geology-unavailable')
    expect(alerts({ geology: null })).not.toContain('geology-unavailable')
  })
})
