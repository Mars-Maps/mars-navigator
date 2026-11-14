import { describe, expect, it } from 'vitest'
import { anchorPosition, forEachRock, rockCell, ROCK_TIERS, type RockPlace } from '../../src/features/mars-3d/surfaceView/rockLayout'
import { makeFrame, toCoordinate, toPatch } from '../../src/features/mars-3d/surfaceView/surfacePatch'

const anchor = makeFrame({ latitude: 12, longitudeEast: 200 })
/** The same place on Mars seen from the anchor's frame and from a patch rebuilt 6 km north-east. */
const later = makeFrame(toCoordinate(anchor, 4.2, 4.3))
const here = toCoordinate(anchor, 3.9013, 4.1017)

function rocksFrom(frame: ReturnType<typeof makeFrame>) {
  const at = toPatch(frame, here)
  const rocks = new Map<string, { lat: number; lon: number; r: number }>()
  const n = forEachRock(anchor, frame, at.xKm * 1000, at.yKm * 1000, 10_000, (rock: RockPlace) => {
    const c = toCoordinate(frame, rock.xM / 1000, rock.yM / 1000)
    rocks.set(`${rock.tier.seed}:${rock.i}:${rock.j}:${rock.k}`, { lat: c.latitude, lon: c.longitudeEast, r: rock.radiusM })
  })
  return { n, rocks }
}

describe('rockLayout', () => {
  it('lays the same stones at the same places on Mars from any patch frame', () => {
    const a = rocksFrom(anchor)
    const b = rocksFrom(later)
    expect(a.n).toBeGreaterThan(100)
    expect(b.n).toBe(a.n)
    expect([...b.rocks.keys()].sort()).toEqual([...a.rocks.keys()].sort())
    for (const [key, rock] of a.rocks) {
      const other = b.rocks.get(key)!
      // Within a centimetre: a swap moves nothing the eye can see.
      expect(Math.abs(other.lat - rock.lat) * 59_000).toBeLessThan(0.01)
      expect(Math.abs(other.lon - rock.lon) * 59_000).toBeLessThan(0.01)
      expect(other.r).toBe(rock.r)
    }
  })

  it('keeps every stone within its tier\'s radius of the walker', () => {
    const at = toPatch(later, here)
    forEachRock(anchor, later, at.xKm * 1000, at.yKm * 1000, 10_000, (rock) => {
      expect(Math.hypot(rock.xM - at.xKm * 1000, rock.yM - at.yKm * 1000)).toBeLessThanOrEqual(rock.tier.radius)
      expect(rock.radiusM).toBeGreaterThanOrEqual(rock.tier.minR)
      expect(rock.radiusM).toBeLessThanOrEqual(rock.tier.maxR)
    })
  })

  it('stops at the cap and reports the count', () => {
    let seen = 0
    const n = forEachRock(anchor, anchor, 0, 0, 25, (_rock, index) => {
      expect(index).toBe(seen)
      seen++
    })
    expect(n).toBe(25)
    expect(seen).toBe(25)
  })

  it('finds the walker\'s fine cell in anchor metres from any frame', () => {
    const at = toPatch(later, here)
    const a = anchorPosition(anchor, later, at.xKm * 1000, at.yKm * 1000)
    expect(a.xM).toBeCloseTo(3901.3, 3)
    expect(a.yM).toBeCloseTo(4101.7, 3)
    expect(rockCell(a.xM, a.yM)).toEqual({ ci: Math.floor(3901.3 / ROCK_TIERS[1].cell), cj: Math.floor(4101.7 / ROCK_TIERS[1].cell) })
  })
})
