import { describe, expect, it } from 'vitest'
import { generateGroundDetail } from '../../src/features/mars-3d/surfaceView/groundDetail'

describe('generateGroundDetail (SIMULATED ground texture)', () => {
  const size = 64
  const px = generateGroundDetail(1, size)

  it('is the same for the same seed and differs for another', () => {
    expect(generateGroundDetail(1, size)).toEqual(px)
    expect(generateGroundDetail(2, size)).not.toEqual(px)
  })

  it('uses the range in every channel, so it is not a flat colour', () => {
    for (let ch = 0; ch < 4; ch++) {
      let min = 255
      let max = 0
      for (let i = ch; i < px.length; i += 4) {
        min = Math.min(min, px[i])
        max = Math.max(max, px[i])
      }
      expect(max - min).toBeGreaterThan(60)
    }
  })

  it('tiles without a seam: opposite edges differ no more than neighbouring rows', () => {
    const at = (x: number, y: number) => px[(y * size + x) * 4]
    let edge = 0
    let inside = 0
    for (let y = 0; y < size; y++) {
      edge += Math.abs(at(size - 1, y) - at(0, y))
      inside += Math.abs(at(size / 2, y) - at(size / 2 + 1, y))
    }
    expect(edge).toBeLessThan(inside * 2.5)
  })
})
