import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RouteOption } from '../../src/domain'
import { groundPointToCoordinate, makeFrame, toPatch } from '../../src/features/mars-3d/surfaceView/surfacePatch'
import { OpenMenu } from '../../src/features/mission-ui/ContextMenu'
import { EMPTY_ROUTE, useMissionStore } from '../../src/state'

const at = (latitude: number, longitudeEast: number) => ({ latitude, longitudeEast })
const items = (html: string) => [...html.matchAll(/data-item="([^"]+)"/g)].map((m) => m[1])

describe('groundPointToCoordinate', () => {
  const frame = makeFrame(at(18.4, 77.5))

  it('is the patch centre at the scene origin', () => {
    expect(groundPointToCoordinate(frame, 0, 0)).toEqual(at(18.4, 77.5))
  })

  it('reads x as east and −z as north, in metres, the ground geometry’s axes', () => {
    const p = toPatch(frame, groundPointToCoordinate(frame, 1200, -800))
    expect(p.xKm).toBeCloseTo(1.2, 9)
    expect(p.yKm).toBeCloseTo(0.8, 9)
    const north = groundPointToCoordinate(frame, 0, -1000)
    expect(north.latitude).toBeGreaterThan(18.4)
    expect(north.longitudeEast).toBeCloseTo(77.5, 9)
  })
})

describe('the right-click menu on the surface ground', () => {
  const menu = { coordinate: at(18.4, 77.5), anchor: { x: 10, y: 10 } }

  it('offers only the point’s own items: Set point, Mark point, Copy coordinates', () => {
    expect(items(renderToStaticMarkup(<OpenMenu menu={menu} surface />))).toEqual(['Set point', 'Mark point', 'Copy coordinates'])
  })

  it('keeps the globe’s items on the globe', () => {
    expect(items(renderToStaticMarkup(<OpenMenu menu={menu} />))).toContain('Center view')
  })

  it('keeps the walker’s keys out of the menu', () => {
    expect(renderToStaticMarkup(<OpenMenu menu={menu} surface />)).toContain('data-own-keys')
  })
})

describe('Set point while a route is followed through the surface view', () => {
  beforeEach(() => useMissionStore.setState({ viewMode: 'close-up', routeDraft: EMPTY_ROUTE, activeRoute: null, selectedPoint: null }))

  it('puts the point into the draft when no route is followed', () => {
    useMissionStore.setState({ viewMode: 'surface' })
    useMissionStore.getState().setPoint(at(18, 77), { x: 0, y: 0 })
    expect(useMissionStore.getState().routeDraft.departure).toEqual(at(18, 77))
  })

  it('only selects the point while the followed route is kept, so the draft does not change behind it', () => {
    useMissionStore.setState({ viewMode: 'surface', activeRoute: { id: 'fastest' } as RouteOption })
    useMissionStore.getState().setPoint(at(18, 77), { x: 0, y: 0 })
    expect(useMissionStore.getState().routeDraft).toBe(EMPTY_ROUTE)
    expect(useMissionStore.getState().selectedPoint).toEqual(at(18, 77))
  })
})
