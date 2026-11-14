import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry, Points, Vector3 } from 'three'
import { GLOBE_RADIUS } from '../../src/features/mars-3d/constants'
import { coordinateToLocalPoint } from '../../src/features/mars-3d/projection'
import { placeRouteHoverMarker } from '../../src/features/mars-3d/RouteHoverMarker'

const makeMarker = () => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
  return new Points(geometry)
}
const AT = { latitude: 18.44, longitudeEast: 77.45 }

describe('placeRouteHoverMarker', () => {
  it('puts the marker on the point, just above the surface, with the route', () => {
    const marker = makeMarker()
    placeRouteHoverMarker(marker, AT, new Vector3())
    expect(marker.visible).toBe(true)
    const p = new Vector3().fromBufferAttribute(marker.geometry.getAttribute('position') as BufferAttribute, 0)
    const expected = coordinateToLocalPoint(AT, GLOBE_RADIUS * 1.002, new Vector3())
    expect(p.distanceTo(expected)).toBeLessThan(1e-5)
    expect(p.length()).toBeGreaterThan(GLOBE_RADIUS)
  })

  it('moves the one vertex in place, and tells the renderer', () => {
    const marker = makeMarker()
    const attribute = marker.geometry.getAttribute('position') as BufferAttribute
    const before = attribute.version
    placeRouteHoverMarker(marker, AT, new Vector3())
    placeRouteHoverMarker(marker, { latitude: 18.5, longitudeEast: 77.5 }, new Vector3())
    expect(marker.geometry.getAttribute('position')).toBe(attribute)
    expect(attribute.version).toBe(before + 2)
  })

  it('draws nothing for no point, then shows again', () => {
    const marker = makeMarker()
    placeRouteHoverMarker(marker, AT, new Vector3())
    placeRouteHoverMarker(marker, null, new Vector3())
    expect(marker.visible).toBe(false)
    placeRouteHoverMarker(marker, AT, new Vector3())
    expect(marker.visible).toBe(true)
  })
})
