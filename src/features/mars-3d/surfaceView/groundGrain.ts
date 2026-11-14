/** Seeded generator for the grain, the same as the starfield's. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GRAIN_SEED = 20261023

/**
 * SIMULATED ground grain: a seamlessly tiling greyscale noise image, RGBA,
 * used as a bump map so the ground underfoot is not a smooth smear. Pure
 * decoration at a scale no data in the app resolves.
 */
export function generateGrain(seed = GRAIN_SEED, size = 256): Uint8Array {
  const rand = seeded(seed ^ 0x9e3779b9)
  const pixels = new Uint8Array(size * size * 4)
  const value = new Float32Array(size * size)
  // Octaves of wrapped value noise, so the left edge meets the right.
  for (const [cells, amp] of [
    [8, 0.45],
    [32, 0.3],
    [128, 0.25],
  ] as const) {
    const lattice = new Float32Array(cells * cells)
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells
      const iy = Math.floor(fy)
      const ty = fy - iy
      const sy = ty * ty * (3 - 2 * ty)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const ix = Math.floor(fx)
        const tx = fx - ix
        const sx = tx * tx * (3 - 2 * tx)
        const x1 = (ix + 1) % cells
        const y1 = (iy + 1) % cells
        const a = lattice[iy * cells + ix]
        const b = lattice[iy * cells + x1]
        const c = lattice[y1 * cells + ix]
        const d = lattice[y1 * cells + x1]
        value[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy)
      }
    }
  }
  for (let i = 0; i < value.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, value[i])) * 255)
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = v
    pixels[i * 4 + 3] = 255
  }
  return pixels
}
