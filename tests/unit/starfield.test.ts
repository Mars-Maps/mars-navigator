import { describe, expect, it } from 'vitest'
import { generateStars } from '../../src/features/mars-3d/starPositions'

describe('generateStars', () => {
  it('honours the count and lays out xyz and rgb per star', () => {
    const { positions, colors } = generateStars(100, 60, 1)
    expect(positions.length).toBe(300)
    expect(colors.length).toBe(300)
  })

  it('puts every star at the requested radius', () => {
    const { positions } = generateStars(500, 60, 7)
    for (let i = 0; i < 500; i++) {
      const [x, y, z] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
      expect(Math.hypot(x, y, z)).toBeCloseTo(60, 4)
    }
  })

  it('is deterministic for a seed and differs for another', () => {
    const a = generateStars(50, 60, 42)
    const b = generateStars(50, 60, 42)
    const c = generateStars(50, 60, 43)
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
    expect(Array.from(a.positions)).not.toEqual(Array.from(c.positions))
  })

  it('is grey only, between dim and full white', () => {
    const { colors } = generateStars(500, 60, 3)
    for (let i = 0; i < 500; i++) {
      const [r, g, b] = [colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]]
      expect(r).toBe(g)
      expect(g).toBe(b)
      expect(r).toBeGreaterThanOrEqual(0.35)
      expect(r).toBeLessThanOrEqual(1)
    }
  })

  it('does not cluster at the poles: roughly a third of stars within |y| < radius/3', () => {
    // For a uniform sphere, P(|z| < 1/3) = 1/3.
    const { positions } = generateStars(3000, 60, 11)
    let near = 0
    for (let i = 0; i < 3000; i++) if (Math.abs(positions[i * 3 + 1]) < 20) near++
    expect(near / 3000).toBeGreaterThan(0.28)
    expect(near / 3000).toBeLessThan(0.39)
  })
})
