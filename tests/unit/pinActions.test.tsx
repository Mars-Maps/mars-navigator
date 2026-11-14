import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { unavailable, type SurfacePoint } from '../../src/domain'
import { PIN_HEAD_UP_PX, PIN_HIT_PX, pinAtClick } from '../../src/features/mars-3d/pinHit'
import { OpenMenu } from '../../src/features/mission-ui/ContextMenu'
import { nearbyRoutePin, routePinName } from '../../src/features/mission-ui/nearbyMarker'
import { MARKER_COLORS, markerHex, withoutRouteEnd, type RouteDraft } from '../../src/state'
import { ROUTE_PIN_COLOR } from '../../src/features/mars-3d/pinColors'

const at = (latitude: number, longitudeEast: number) => ({ latitude, longitudeEast })

describe('withoutRouteEnd', () => {
  const draft: RouteDraft = {
    departure: at(18, 77),
    stops: [at(18.1, 77.1), null, at(18.5, 77.5)],
    destination: at(18.6, 77.6),
  }

  it('promotes the stop nearest the removed departure, and takes it out of the stops', () => {
    expect(withoutRouteEnd(draft, 'departure')).toEqual({
      departure: at(18.1, 77.1),
      stops: [null, at(18.5, 77.5)],
      destination: at(18.6, 77.6),
    })
  })

  it('promotes the stop nearest the removed destination, whatever its place in the order', () => {
    expect(withoutRouteEnd(draft, 'destination')).toEqual({
      departure: at(18, 77),
      stops: [at(18.1, 77.1), null],
      destination: at(18.5, 77.5),
    })
  })

  it('leaves the end empty when there is no valid stop to promote', () => {
    const bare = { departure: at(18, 77), stops: [null], destination: at(18.6, 77.6) }
    expect(withoutRouteEnd(bare, 'departure')).toEqual({ ...bare, departure: null })
  })

  it('returns the same draft when that end is not chosen', () => {
    const open = { ...draft, destination: null }
    expect(withoutRouteEnd(open, 'destination')).toBe(open)
  })
})

describe('marker colours', () => {
  it('starts every point lavender, the marked pins’ own colour, and reads a chosen one', () => {
    expect(markerHex({}, 'm1')).toBe(ROUTE_PIN_COLOR.marked)
    expect(markerHex({ m1: 'orange' }, 'm1')).toBe(0xfb923c)
  })

  it('offers no route role’s colour', () => {
    const roles = [ROUTE_PIN_COLOR.departure, ROUTE_PIN_COLOR.stop, ROUTE_PIN_COLOR.destination]
    for (const c of MARKER_COLORS) expect(roles).not.toContain(c.hex)
  })
})

describe('nearbyRoutePin', () => {
  const draft = { departure: at(18, 77), stops: [null, at(18.2, 77)], destination: at(19, 77) }

  it('finds the clicked pin, naming a stop by its row as the search bar does', () => {
    const pin = nearbyRoutePin(draft, at(18.2, 77), 1)
    expect(pin).toEqual({ kind: 'stop', index: 1, coordinate: at(18.2, 77) })
    expect(routePinName(pin!)).toBe('Stop 2')
    expect(routePinName(nearbyRoutePin(draft, at(18, 77), 1)!)).toBe('Departure')
  })

  it('finds nothing away from every pin, or before the camera has settled', () => {
    expect(nearbyRoutePin(draft, at(25, 77), 1)).toBeNull()
    expect(nearbyRoutePin(draft, at(18, 77), null)).toBeNull()
  })
})

describe('pinAtClick', () => {
  it('hits a pin on its tip, its head and the stem between', () => {
    const tips = [{ x: 100, y: 100 }]
    expect(pinAtClick({ x: 100, y: 100 }, tips)).toBe(0)
    expect(pinAtClick({ x: 100, y: 100 - PIN_HEAD_UP_PX }, tips)).toBe(0)
    expect(pinAtClick({ x: 104, y: 92 }, tips)).toBe(0)
  })

  it('misses beside the pin and skips pins that are not drawn', () => {
    expect(pinAtClick({ x: 100 + PIN_HIT_PX + 1, y: 100 }, [{ x: 100, y: 100 }])).toBe(-1)
    expect(pinAtClick({ x: 100, y: 100 }, [null])).toBe(-1)
  })

  it('takes the nearest when two pins overlap', () => {
    expect(pinAtClick({ x: 104, y: 100 }, [{ x: 100, y: 100 }, { x: 106, y: 100 }])).toBe(1)
  })
})

describe('the menu on a pin', () => {
  const anchor = { x: 10, y: 10 }
  const marked: SurfacePoint = { id: 'm1', coordinate: at(18, 77), elevationMeters: unavailable('fixture'), label: 'Delta' }

  it('offers Remove for a route pin, off with the reason while navigating', () => {
    const pin = { kind: 'departure' as const, coordinate: at(18, 77) }
    const html = renderToStaticMarkup(<OpenMenu menu={{ coordinate: at(18, 77), anchor }} nearRoute={pin} />)
    expect(html).toContain('data-item="Remove Departure"')
    const nav = renderToStaticMarkup(<OpenMenu menu={{ coordinate: at(18, 77), anchor }} nearRoute={pin} navigating />)
    expect(nav).toMatch(/data-item="Remove Departure"[^>]*aria-disabled="true"/)
    expect(nav).toContain('End navigation to change the route')
  })

  it('offers Rename, Unmark and the colours for a marked point', () => {
    const html = renderToStaticMarkup(<OpenMenu menu={{ coordinate: at(18, 77), anchor }} nearMarker={marked} />)
    expect(html).toContain('data-item="Rename Delta"')
    expect(html).toContain('data-item="Unmark Delta"')
    for (const c of MARKER_COLORS) expect(html).toContain(`aria-label="${c.label}"`)
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Lavender"/)
  })
})
