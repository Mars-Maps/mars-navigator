import { describe, expect, it } from 'vitest'
import { labelPixel } from '../../src/features/mars-3d/SiteLabel'

describe('labelPixel', () => {
  it('keeps sub-pixel motion, so the label moves with the ring under it', () => {
    expect(labelPixel(970.7134)).toBe(970.71)
    expect(labelPixel(970.7134)).not.toBe(Math.round(970.7134))
    expect(labelPixel(970.81)).not.toBe(labelPixel(970.71))
  })

  it('gives one value for a scene settled up to float noise, so nothing is written', () => {
    expect(labelPixel(368.6512)).toBe(labelPixel(368.6512000001))
  })
})
