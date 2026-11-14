import { beforeEach, describe, expect, it } from 'vitest'
import { derived, type MarsCoordinate } from '../../src/domain'
import { walkerPosition } from '../../src/features/mars-3d/surfaceView/walkerHeading'
import { useSurfaceHeading } from '../../src/state'

// Test fixtures only: invented positions, never shown in the app.
const HERE: MarsCoordinate = { latitude: 18.4447, longitudeEast: 77.4508 }
const store = () => useSurfaceHeading.getState()

describe('the walker in useSurfaceHeading', () => {
  beforeEach(() => store().clear())

  it('holds no position while nobody stands on the surface', () => {
    expect(store().position).toBeNull()
  })

  it('holds the position DERIVED, with the method', () => {
    store().setPosition(walkerPosition(HERE))
    const p = store().position
    expect(p?.classification).toBe('DERIVED')
    expect(p?.classification === 'DERIVED' && p.value).toEqual(HERE)
    expect(p?.classification === 'DERIVED' && p.method).toMatch(/ground patch/)
  })

  it('tells nobody when the walker stands still, and everybody when they move', () => {
    let notified = 0
    const stop = useSurfaceHeading.subscribe((next, previous) => {
      if (next.position !== previous.position) notified++
    })
    store().setPosition(walkerPosition(HERE))
    store().setPosition(walkerPosition({ ...HERE }))
    expect(notified).toBe(1)
    store().setPosition(walkerPosition({ ...HERE, latitude: 18.45 }))
    expect(notified).toBe(2)
    stop()
  })

  it('forgets the heading and the position together', () => {
    store().setHeading(derived(90, 'fixture'))
    store().setPosition(walkerPosition(HERE))
    store().clear()
    expect(store().heading).toBeNull()
    expect(store().position).toBeNull()
  })
})
