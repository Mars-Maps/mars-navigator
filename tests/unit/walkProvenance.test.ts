import { describe, expect, it } from 'vitest'
import { derived, simulated, unavailable, type MarsCoordinate, type WalkLeg } from '../../src/domain'
import { walkNoticeText, walkProvenance } from '../../src/features/mars-3d/surfaceView/walkProvenance'

// Test fixture only: invented legs, not a plan.
const LINE: MarsCoordinate[] = [
  { latitude: 18.4, longitudeEast: 77.4 },
  { latitude: 18.41, longitudeEast: 77.41 },
]
const leg = (path: WalkLeg['path']): WalkLeg => ({
  fromStopId: 'a',
  toStopId: 'b',
  path,
  distanceKm: unavailable('fixture'),
  steepestSlopeDeg: unavailable('fixture'),
  hazards: unavailable('fixture'),
})

describe('walkProvenance', () => {
  it('is SIMULATED when any leg is, named by its source, never DERIVED', () => {
    const p = walkProvenance([leg(derived(LINE, 'fixture router')), leg(simulated(LINE, 'Sample walk plan'))])
    expect(p).toEqual({ classification: 'SIMULATED', from: 'Sample walk plan', unrouted: 0 })
  })

  it('is DERIVED with each method once, counting unrouted legs', () => {
    const p = walkProvenance([
      leg(derived(LINE, 'fixture router')),
      leg(derived(LINE, 'fixture router')),
      leg(unavailable('blocked by a ridge')),
    ])
    expect(p).toEqual({ classification: 'DERIVED', from: 'fixture router', unrouted: 1 })
  })

  it('is UNAVAILABLE with the reasons when no leg has a path', () => {
    const p = walkProvenance([leg(unavailable('no heights')), leg(unavailable('no heights'))])
    expect(p).toEqual({ classification: 'UNAVAILABLE', from: 'no heights', unrouted: 2 })
  })
})

describe('walkNoticeText', () => {
  const walking = { kind: 'walking' as const, stopLabel: 'Stop 2', movedToStart: false }

  it('states the pace, and calls the line what it is', () => {
    expect(walkNoticeText(walking, 'DERIVED', 30)).toBe(
      'Walking to Stop 2 along the planned route at 30 m/s, sped up for the rehearsal: not a walking time. Any move key stops.',
    )
    expect(walkNoticeText(walking, 'SIMULATED', 30)).toContain('along the invented test line')
  })

  it('says when the walker was moved onto the route, not walked there', () => {
    expect(walkNoticeText({ ...walking, movedToStart: true }, 'DERIVED', 30)).toContain('moved onto its start, not walked there')
  })

  it('says a jump is not a walk', () => {
    expect(walkNoticeText({ kind: 'jumped', stopLabel: 'Stop 2' }, 'UNAVAILABLE', 30)).toBe('No planned path to Stop 2: moved there directly, not walked.')
  })
})
