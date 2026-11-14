import { beforeEach, describe, expect, it } from 'vitest'
import { searchBarEscape } from '../../src/features/mission-ui/searchBarEscape'
import { unavailable, type MarsCoordinate, type SurfacePoint } from '../../src/domain'
import {
  EMPTY_ROUTE,
  describeRoutePick,
  markerLabelAt,
  stopPickShifted,
  useMissionStore,
  useRoutePick,
  writeRouteSlot,
} from '../../src/state'

// Test fixtures only: invented points and descriptions, never shown in the app.
const A: MarsCoordinate = { latitude: 18.4447, longitudeEast: 77.4508 }
const B: MarsCoordinate = { latitude: 18.5, longitudeEast: 77.3 }
const C: MarsCoordinate = { latitude: 18.4, longitudeEast: 77.6 }

const draft = () => useMissionStore.getState().routeDraft
const pick = () => useRoutePick.getState()

describe('pick on the globe', () => {
  beforeEach(() => {
    useMissionStore.setState({ routeDraft: EMPTY_ROUTE, selectedPoint: null, viewMode: 'close-up' })
    useRoutePick.setState({ slot: null })
  })

  it('a pick fills its field, selects the point and ends the pick', () => {
    pick().startRoutePick('departure')
    expect(pick().slot).toBe('departure')
    pick().pickRoutePoint(A)
    expect(draft().departure).toEqual(A)
    expect(useMissionStore.getState().selectedPoint).toEqual(A)
    expect(pick().slot).toBeNull()
  })

  it('fills the destination, an existing stop, or adds a new stop', () => {
    pick().startRoutePick('destination')
    pick().pickRoutePoint(B)
    pick().startRoutePick('new-stop')
    pick().pickRoutePoint(C)
    expect(draft().stops).toEqual([C])
    pick().startRoutePick(0)
    pick().pickRoutePoint(A)
    expect(draft()).toEqual({ departure: null, destination: B, stops: [A] })
  })

  it('cancel leaves the field unchanged, and a click with no pick does nothing', () => {
    useMissionStore.getState().setDeparture(A)
    pick().startRoutePick('departure')
    pick().cancelRoutePick()
    expect(pick().slot).toBeNull()
    pick().pickRoutePoint(B)
    expect(draft().departure).toEqual(A)
    expect(useMissionStore.getState().selectedPoint).toBeNull()
  })

  it('a stop removed during its pick is not brought back', () => {
    pick().startRoutePick(2)
    pick().pickRoutePoint(A)
    expect(draft().stops).toEqual([])
  })

  describe("a stop's pick follows the stop, not its place in the list", () => {
    const D: MarsCoordinate = { latitude: 18.3, longitudeEast: 77.5 }
    beforeEach(() => {
      useMissionStore.setState({ routeDraft: { ...EMPTY_ROUTE, stops: [A, B, C] } })
    })

    it('removing an earlier stop cancels the pick, so the click fills nothing', () => {
      pick().startRoutePick(1)
      useMissionStore.getState().removeStop(0)
      expect(pick().slot).toBeNull()
      // The click after it is a plain click: what was stop 3 keeps its value.
      pick().pickRoutePoint(D)
      expect(draft().stops).toEqual([B, C])
    })

    it('dragging the list cancels the pick', () => {
      pick().startRoutePick(1)
      useMissionStore.getState().moveStop(1, 2)
      expect(pick().slot).toBeNull()
      expect(draft().stops).toEqual([A, C, B])
    })

    it('adding a stop or clearing the route cancels it', () => {
      pick().startRoutePick(0)
      useMissionStore.getState().addStop(D)
      expect(pick().slot).toBeNull()
      pick().startRoutePick(0)
      useMissionStore.getState().clearRoute()
      expect(pick().slot).toBeNull()
    })

    it('typing into the picked stop, or another field, keeps the pick', () => {
      pick().startRoutePick(1)
      useMissionStore.getState().updateStop(1, D)
      useMissionStore.getState().updateStop(0, C)
      useMissionStore.getState().setDeparture(A)
      expect(pick().slot).toBe(1)
      pick().pickRoutePoint(B)
      expect(draft().stops).toEqual([C, B, C])
    })

    it('the departure, destination and new-stop picks are left alone by stop changes', () => {
      for (const slot of ['departure', 'destination', 'new-stop'] as const) {
        pick().startRoutePick(slot)
        useMissionStore.getState().removeStop(0)
        expect(pick().slot).toBe(slot)
        pick().cancelRoutePick()
      }
    })

    it('stopPickShifted: same list, same length with an edit, a move, a length change', () => {
      const list = [A, B, C]
      expect(stopPickShifted(1, list, list)).toBe(false)
      expect(stopPickShifted(1, list, [A, D, C])).toBe(false)
      expect(stopPickShifted(1, list, [A, C, B])).toBe(true)
      expect(stopPickShifted(1, list, [B, A, C])).toBe(true)
      expect(stopPickShifted(1, list, [A, C])).toBe(true)
      // An index the list never had (the out-of-range case above) is no shift.
      expect(stopPickShifted(5, list, [A, D, C])).toBe(false)
      // An empty stop being picked: typing elsewhere keeps it, a drag moves it.
      expect(stopPickShifted(1, [A, null, C], [D, null, C])).toBe(false)
      expect(stopPickShifted(1, [A, null, C], [A, D, C])).toBe(false)
      expect(stopPickShifted(1, [A, null, C], [null, A, C])).toBe(true)
    })
  })

  it('leaves the draft alone while navigating, as Set point does', () => {
    useMissionStore.setState({ viewMode: 'navigation' })
    pick().startRoutePick('departure')
    pick().pickRoutePoint(A)
    expect(draft().departure).toBeNull()
    expect(pick().slot).toBeNull()
  })

  it('says what the next click does', () => {
    expect(describeRoutePick('departure')).toBe('Click the surface to set the departure')
    expect(describeRoutePick('destination')).toBe('Click the surface to set the destination')
    expect(describeRoutePick('new-stop')).toBe('Click the surface to add a stop')
    expect(describeRoutePick(1)).toBe('Click the surface to set stop 2')
  })
})

describe('Escape inside the search bar during a pick', () => {
  it('cancels the pick first and leaves the bar as it is, open or closed', () => {
    expect(searchBarEscape(true, true)).toBe('cancel-pick')
    expect(searchBarEscape(true, false)).toBe('cancel-pick')
  })

  it('with no pick, closes an open bar and leaves a closed one to the shared rule', () => {
    expect(searchBarEscape(false, true)).toBe('close')
    expect(searchBarEscape(false, false)).toBeNull()
  })
})

describe('marked points into the route fields', () => {
  const markers: SurfacePoint[] = [
    { id: 'm1', coordinate: A, label: 'fixture-rim', elevationMeters: unavailable('fixture') },
    { id: 'm2', coordinate: B, elevationMeters: unavailable('fixture') },
  ]

  beforeEach(() => {
    useMissionStore.setState({ routeDraft: EMPTY_ROUTE, viewMode: 'close-up' })
  })

  it('a marker fills the field with its coordinate', () => {
    writeRouteSlot('departure', markers[0]!.coordinate)
    writeRouteSlot('new-stop', markers[1]!.coordinate)
    expect(draft()).toEqual({ departure: A, destination: null, stops: [B] })
  })

  it("the field's label is the marker's description while its value is the marker's", () => {
    expect(markerLabelAt(markers, A)).toBe('fixture-rim')
    expect(markerLabelAt(markers, { ...A })).toBe('fixture-rim')
    expect(markerLabelAt(markers, C)).toBeNull()
    expect(markerLabelAt(markers, B)).toBeNull()
    expect(markerLabelAt(markers, null)).toBeNull()
  })
})
