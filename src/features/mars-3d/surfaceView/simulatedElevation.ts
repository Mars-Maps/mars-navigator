import { MARS_MEAN_RADIUS_KM, simulated, type Classified } from '../../../domain'
import type { SurfaceElevation } from '../surfaceElevation'

/**
 * SIMULATED ground heights for the surface view, used until a real
 * elevation source is connected (see surfaceElevation.ts). Invented: noise
 * hills and a scatter of craters. They are a fixed function of the place on
 * the planet, so the same spot always looks the same and patches built at
 * different times meet without a seam. Not the real shape of Mars anywhere.
 */
export const SIMULATED_ELEVATION_SOURCE =
  'Invented terrain (noise hills and craters from a fixed seed). No elevation data is connected yet, so this is not the real shape of the ground.'

const R = MARS_MEAN_RADIUS_KM
const RAD = Math.PI / 180
/** Points between yields, so building a patch never blocks a frame for long. */
const YIELD_EVERY = 4000

/** Integer lattice hash → [0, 1). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ seed
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

const fade = (t: number) => t * t * (3 - 2 * t)

/** Smooth 3D value noise, 0–1, at a point in km. */
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = fade(x - ix)
  const fy = fade(y - iy)
  const fz = fade(z - iz)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const corner = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed)
  return lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), fx), lerp(corner(0, 1, 0), corner(1, 1, 0), fx), fy),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), fx), lerp(corner(0, 1, 1), corner(1, 1, 1), fx), fy),
    fz,
  )
}

/** Wavelength km and amplitude m of each noise octave. */
const OCTAVES = [
  [600, 1800],
  [150, 600],
  [40, 220],
  [10, 70],
  [2.5, 18],
  [0.6, 5],
] as const

/**
 * Crater fields: one possible crater per cubic cell of `cellKm`, kept with
 * probability `chance`, radius between `minKm` and `maxKm`.
 */
const CRATER_LEVELS = [
  { cellKm: 24, chance: 0.5, minKm: 1.5, maxKm: 7, seed: 11 },
  { cellKm: 6, chance: 0.45, minKm: 0.3, maxKm: 1.4, seed: 23 },
  { cellKm: 1.5, chance: 0.35, minKm: 0.06, maxKm: 0.3, seed: 37 },
] as const

/** Depth as a fraction of diameter, roughly that of fresh simple craters. */
const DEPTH_PER_DIAMETER = 0.18

/** Height in metres at a point on the sphere given in km (|p| = R). */
export function simulatedHeightAt(px: number, py: number, pz: number): number {
  let h = 0
  for (let o = 0; o < OCTAVES.length; o++) {
    const [wave, amp] = OCTAVES[o]
    h += (valueNoise(px / wave, py / wave, pz / wave, 101 + o) - 0.5) * 2 * amp
  }
  for (const level of CRATER_LEVELS) {
    const s = level.cellKm
    const cx = Math.floor(px / s)
    const cy = Math.floor(py / s)
    const cz = Math.floor(pz / s)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const ix = cx + dx
          const iy = cy + dy
          const iz = cz + dz
          if (hash3(ix, iy, iz, level.seed) > level.chance) continue
          // Centre jittered in the cell, then dropped onto the surface. Only
          // cells the surface passes through make craters, so density stays even.
          let mx = (ix + hash3(ix, iy, iz, level.seed + 1)) * s
          let my = (iy + hash3(ix, iy, iz, level.seed + 2)) * s
          let mz = (iz + hash3(ix, iy, iz, level.seed + 3)) * s
          const len = Math.hypot(mx, my, mz)
          if (Math.abs(len - R) > s / 2) continue
          mx *= R / len
          my *= R / len
          mz *= R / len
          const radius =
            level.minKm + (level.maxKm - level.minKm) * hash3(ix, iy, iz, level.seed + 4) ** 2
          const r = Math.hypot(px - mx, py - my, pz - mz) / radius
          if (r > 2.2) continue
          const depth = 2 * radius * 1000 * DEPTH_PER_DIAMETER
          if (r < 1) h -= depth * (1 - r * r)
          h += 0.25 * depth * Math.exp(-((r - 1) * (r - 1)) / 0.08)
        }
      }
    }
  }
  return h
}

const yieldToFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export const simulatedElevation: SurfaceElevation = {
  async sample(points: Float64Array, signal: AbortSignal): Promise<Classified<Float32Array>> {
    const count = points.length / 2
    const heights = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      if (i % YIELD_EVERY === 0 && i > 0) {
        await yieldToFrame()
        if (signal.aborted) break
      }
      const lat = points[i * 2] * RAD
      const lon = points[i * 2 + 1] * RAD
      const ring = R * Math.cos(lat)
      heights[i] = simulatedHeightAt(ring * Math.cos(lon), ring * Math.sin(lon), R * Math.sin(lat))
    }
    return simulated(heights, SIMULATED_ELEVATION_SOURCE)
  },
}
