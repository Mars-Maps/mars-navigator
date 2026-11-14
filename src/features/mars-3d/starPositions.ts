/**
 * Star positions for the decorative sky. SIMULATED: pseudo-random,
 * not a star catalogue. Pure, so it is testable without WebGL; the
 * component that draws it is Starfield.tsx.
 */

/** Far enough to sit behind everything, inside the camera's far plane. */
export const STARFIELD_RADIUS = 60
export const STAR_COUNT = 1500
/** Same seed every load: the sky never changes between sessions. */
export const STARFIELD_SEED = 20261018

export interface StarBuffers {
  /** xyz per star, all at `radius` from the origin. */
  positions: Float32Array
  /** rgb per star, grey (r = g = b) between STAR_DIM and 1. */
  colors: Float32Array
}

export const STAR_DIM = 0.35

/** mulberry32: small, deterministic, good enough for decoration. */
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

/**
 * Uniformly distributed points on a sphere (not clustered at the poles),
 * each with a grey brightness: most dim, a thin tail of bright ones.
 */
export function generateStars(
  count: number,
  radius: number,
  seed: number = STARFIELD_SEED,
): StarBuffers {
  const random = seeded(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: z uniform in [-1, 1], angle uniform in [0, 2π).
    const z = random() * 2 - 1
    const theta = random() * 2 * Math.PI
    const ring = Math.sqrt(1 - z * z)
    positions[i * 3] = radius * ring * Math.cos(theta)
    positions[i * 3 + 1] = radius * z
    positions[i * 3 + 2] = radius * ring * Math.sin(theta)
    const grey = STAR_DIM + (1 - STAR_DIM) * random() ** 2
    colors[i * 3] = grey
    colors[i * 3 + 1] = grey
    colors[i * 3 + 2] = grey
  }
  return { positions, colors }
}
