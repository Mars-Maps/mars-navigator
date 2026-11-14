import { describe, expect, it } from 'vitest'
import { official, unavailable, type RoverTraverse, type TraversePoint } from '../../src/domain'
import { traverseCaption } from '../../src/features/mars-3d/traverseLabel'

// Test fixture only: invented sols and positions, not Perseverance's feed.
function point(sol: number): TraversePoint {
  return {
    coordinate: { latitude: 18.44, longitudeEast: 77.45 },
    sol,
    rmc: { site: 1, drive: sol },
    elevationMeters: official(-2500, 'test fixture'),
    tiltDegrees: unavailable('test fixture'),
  }
}

function traverse(points: TraversePoint[]): RoverTraverse {
  return { rover: 'perseverance', source: 'test fixture', retrievedUtcMs: Date.UTC(2026, 9, 30, 9, 5), points }
}

describe('traverseLabel: traverseCaption', () => {
  it('names the rover, the sol range and the read time, and says it is not a plan', () => {
    expect(traverseCaption(traverse([point(3), point(9)]))).toBe(
      "Perseverance's path (solid line, straight between waypoints), sols 3–9, NASA/JPL waypoints read 2026-10-30 09:05 UTC; not a planned route",
    )
  })

  it('says so when the feed has no waypoints', () => {
    expect(traverseCaption(traverse([]))).toContain('has no waypoints')
  })
})
