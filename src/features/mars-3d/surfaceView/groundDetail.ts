/**
 * SIMULATED ground detail for the surface view: one seamlessly tiling RGBA
 * image the ground shader samples at several scales, so the ground has
 * texture at distances the orbital imagery cannot resolve. Pure decoration,
 * labelled as such in the view; the real imagery still sets the colour at
 * large scale.
 *
 *   R  fine grit (multi-octave noise)
 *   G  blotchy patches (noise folded into ridges)
 *   B  pebbles: small dark specks, 1 where a pebble is
 *   A  broad soft variation (low-frequency noise)
 */
export const DETAIL_SEED = 4242
export const DETAIL_PX = 512

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

/** Tileable value noise summed over octaves of `cells` lattice size, 0–1. */
function fbm(rand: () => number, size: number, octaves: readonly (readonly [number, number])[]): Float32Array {
  const out = new Float32Array(size * size)
  let total = 0
  for (const [cells, amp] of octaves) {
    total += amp
    const lattice = new Float32Array(cells * cells)
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells
      const iy = Math.floor(fy)
      const ty = fy - iy
      const sy = ty * ty * (3 - 2 * ty)
      const y1 = (iy + 1) % cells
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const ix = Math.floor(fx)
        const tx = fx - ix
        const sx = tx * tx * (3 - 2 * tx)
        const x1 = (ix + 1) % cells
        const a = lattice[iy * cells + ix]
        const b = lattice[iy * cells + x1]
        const c = lattice[y1 * cells + ix]
        const d = lattice[y1 * cells + x1]
        out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy)
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

export function generateGroundDetail(seed = DETAIL_SEED, size = DETAIL_PX): Uint8Array {
  const rand = seeded(seed)
  const grit = fbm(rand, size, [
    [16, 0.2],
    [32, 0.25],
    [64, 0.25],
    [128, 0.3],
  ])
  const patches = fbm(rand, size, [
    [8, 0.5],
    [16, 0.3],
    [32, 0.2],
  ])
  const broad = fbm(rand, size, [
    [4, 0.6],
    [8, 0.4],
  ])

  // Pebbles: soft dark discs, wrapped at the edges so the tile stays seamless.
  const pebbles = new Float32Array(size * size)
  const count = Math.round((size * size) / 180)
  for (let k = 0; k < count; k++) {
    const cx = rand() * size
    const cy = rand() * size
    // Many tiny, few larger.
    const r = 0.8 + 3.2 * rand() ** 3
    const reach = Math.ceil(r + 1)
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(dx + (cx % 1) - 0.5, dy + (cy % 1) - 0.5)
        const v = Math.max(0, Math.min(1, r + 0.5 - d))
        if (v <= 0) continue
        const x = (((Math.floor(cx) + dx) % size) + size) % size
        const y = (((Math.floor(cy) + dy) % size) + size) % size
        const i = y * size + x
        pebbles[i] = Math.max(pebbles[i], v)
      }
    }
  }

  const pixels = new Uint8Array(size * size * 4)
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  for (let i = 0; i < size * size; i++) {
    // Stretch the noise around its mean so it uses the range.
    pixels[i * 4] = byte(0.5 + (grit[i] - 0.5) * 2.2)
    // Folded noise: soft ridges and hollows rather than round blobs.
    pixels[i * 4 + 1] = byte(1 - Math.abs(patches[i] - 0.5) * 2.4)
    pixels[i * 4 + 2] = byte(pebbles[i])
    pixels[i * 4 + 3] = byte(0.5 + (broad[i] - 0.5) * 2)
  }
  return pixels
}
