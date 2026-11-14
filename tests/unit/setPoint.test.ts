import { beforeEach, describe, expect, it } from 'vitest'
import type { MarsCoordinate } from '../../src/domain'
import { setPointSlot, useMissionStore, type RouteDraft } from '../../src/state'

const store = useMissionStore
const a: MarsCoordinate = { latitude: -4.6, longitudeEast: 137.4 }
const b: MarsCoordinate = { latitude: 18.4, longitudeEast: 77.5 }
const c: MarsCoordinate = { latitude: 22.5, longitudeEast: 310 }
const anchor = { x: 400, y: 300 }

const draft = (departure: MarsCoordinate | null, destination: MarsCoordinate | null): RouteDraft => ({
  departure,
  destination,
  stops: [],
})

describe('setPointSlot', () => {
  it('fills the departure, then the destination, then asks', () => {
    expect(setPointSlot(draft(null, null))).toBe('departure')
    expect(setPointSlot(draft(a, null))).toBe('destination')
    expect(setPointSlot(draft(a, b))).toBe('choose')
  })

  it('fills an empty departure first even when the destination is set', () => {
    expect(setPointSlot(draft(null, b))).toBe('departure')
  })
})

describe('setPoint', () => {
  beforeEach(() => {
    store.setState({
      viewMode: 'close-up',
      routeDraft: draft(null, null),
      selectedPoint: null,
      setPointChooser: null,
    })
  })

  it('in navigation only selects: the hidden draft and the chooser stay as they are', () => {
    store.setState({ viewMode: 'navigation' })
    store.getState().setPoint(a, anchor)
    expect(store.getState().selectedPoint).toEqual(a)
    expect(store.getState().routeDraft).toEqual(draft(null, null))
    store.setState({ routeDraft: draft(a, b) })
    store.getState().setPoint(c, anchor)
    expect(store.getState().setPointChooser).toBeNull()
    expect(store.getState().routeDraft).toEqual(draft(a, b))
  })

  it('makes the first point the departure and the second the destination', () => {
    store.getState().setPoint(a, anchor)
    expect(store.getState().routeDraft).toEqual(draft(a, null))
    store.getState().setPoint(b, anchor)
    expect(store.getState().routeDraft).toEqual(draft(a, b))
    expect(store.getState().setPointChooser).toBeNull()
  })

  it('selects the point every time, so the point menu still opens', () => {
    store.getState().setPoint(a, anchor)
    expect(store.getState().selectedPoint).toEqual(a)
    store.setState({ routeDraft: draft(a, b) })
    store.getState().setPoint(c, anchor)
    expect(store.getState().selectedPoint).toEqual(c)
  })

  it('opens the chooser at the cursor once both ends are set, and changes no route field', () => {
    store.setState({ routeDraft: { departure: a, destination: b, stops: [c] } })
    store.getState().setPoint(c, anchor)
    expect(store.getState().setPointChooser).toEqual({ coordinate: c, anchor })
    expect(store.getState().routeDraft).toEqual({ departure: a, destination: b, stops: [c] })
  })

  it('keeps stops when it fills an end', () => {
    store.setState({ routeDraft: { departure: null, destination: b, stops: [c, null] } })
    store.getState().setPoint(a, anchor)
    expect(store.getState().routeDraft).toEqual({ departure: a, destination: b, stops: [c, null] })
  })

  it('closes an open chooser when a later Set point fills an end', () => {
    store.setState({ setPointChooser: { coordinate: c, anchor } })
    store.getState().setPoint(a, anchor)
    expect(store.getState().setPointChooser).toBeNull()
  })

  it('closeSetPointChooser cancels without touching the route', () => {
    store.setState({ routeDraft: draft(a, b) })
    store.getState().setPoint(c, anchor)
    store.getState().closeSetPointChooser()
    expect(store.getState().setPointChooser).toBeNull()
    expect(store.getState().routeDraft).toEqual(draft(a, b))
  })

  it('entering the surface view closes the chooser', () => {
    store.setState({ viewMode: 'close-up', routeDraft: draft(a, b) })
    store.getState().setPoint(c, anchor)
    store.getState().enterSurface(c)
    expect(store.getState().setPointChooser).toBeNull()
  })
})
