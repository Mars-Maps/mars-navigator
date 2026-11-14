import { toCoordinate, toPatch, type PatchFrame } from './surfacePatch'

/**
 * Where the SIMULATED rocks lie: the stones are seeded on
 * cells of the frame of the drop point, the anchor, not of the current
 * ground patch, so a patch rebuild around the walker leaves every stone
 * where it was. Each stone is handed over in the current patch's metres
 * for drawing. Pure, so the hand-over across frames is tested.
 */
export const ROCK_TIERS = [
  { cell: 16, radius: 220, maxPerCell: 4, minR: 0.08, maxR: 1.5, power: 4, seed: 17 },
  { cell: 3, radius: 45, maxPerCell: 5, minR: 0.03, maxR: 0.22, power: 2.5, seed: 71 },
] as const

export type RockTier = (typeof ROCK_TIERS)[number]

/**
 * Slack for the cheap radius test on anchor metres. Within a patch the two
 * azimuthal-equidistant frames differ by a near-rigid motion; over a
 * tier's radius the distance error is well under a metre.
 */
const PREFILTER_MARGIN_M = 2

/** Integer cell hash → [0, 1); `k` picks independent values for one cell. */
export function rockHash(i: number, j: number, k: number, seed: number): number {
  let h = Math.imul(i, 0x8da6b343) ^ Math.imul(j, 0xd8163841) ^ Math.imul(k, 0xcb1ab31f) ^ seed
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

export interface RockPlace {
  tier: RockTier
  /** The stone's cell and index: its identity, the same from any frame. */
  i: number
  j: number
  k: number
  /** Metres east and north of the current patch's centre. */
  xM: number
  yM: number
  radiusM: number
}

/** The walker's place in the anchor's metres: the cell grid the stones live on. */
export function anchorPosition(anchor: PatchFrame, frame: PatchFrame, xM: number, yM: number): { xM: number; yM: number } {
  const a = toPatch(anchor, toCoordinate(frame, xM / 1000, yM / 1000))
  return { xM: a.xKm * 1000, yM: a.yKm * 1000 }
}

/** The cell of the fine tier the walker stands in, in anchor metres; stones are laid out again when it changes. */
export function rockCell(anchorXM: number, anchorYM: number): { ci: number; cj: number } {
  const cell = ROCK_TIERS[1].cell
  return { ci: Math.floor(anchorXM / cell), cj: Math.floor(anchorYM / cell) }
}

/**
 * Calls `visit` for every stone within its tier's radius of the walker, at
 * most `max` of them. `out` is reused for each stone; copy what you keep.
 */
export function forEachRock(
  anchor: PatchFrame,
  frame: PatchFrame,
  xM: number,
  yM: number,
  max: number,
  visit: (rock: RockPlace, index: number) => void,
): number {
  const at = anchorPosition(anchor, frame, xM, yM)
  const out: RockPlace = { tier: ROCK_TIERS[0], i: 0, j: 0, k: 0, xM: 0, yM: 0, radiusM: 0 }
  let n = 0
  for (const tier of ROCK_TIERS) {
    const c0i = Math.floor(at.xM / tier.cell)
    const c0j = Math.floor(at.yM / tier.cell)
    const span = Math.ceil(tier.radius / tier.cell)
    for (let di = -span; di <= span && n < max; di++) {
      for (let dj = -span; dj <= span && n < max; dj++) {
        const i = c0i + di
        const j = c0j + dj
        const count = Math.floor(rockHash(i, j, 0, tier.seed) ** 2 * (tier.maxPerCell + 1))
        for (let k = 1; k <= count && n < max; k++) {
          const ax = (i + rockHash(i, j, k * 7 + 1, tier.seed)) * tier.cell
          const ay = (j + rockHash(i, j, k * 7 + 2, tier.seed)) * tier.cell
          // Most candidates are outside the radius: drop them on anchor
          // metres, which match the patch's within centimetres this close,
          // before paying for the projection. The exact test follows.
          if (Math.hypot(ax - at.xM, ay - at.yM) > tier.radius + PREFILTER_MARGIN_M) continue
          // Anchor metres → the place on Mars → the current patch's metres.
          const local = toPatch(frame, toCoordinate(anchor, ax / 1000, ay / 1000))
          const lx = local.xKm * 1000
          const ly = local.yKm * 1000
          if (Math.hypot(lx - xM, ly - yM) > tier.radius) continue
          out.tier = tier
          out.i = i
          out.j = j
          out.k = k
          out.xM = lx
          out.yM = ly
          out.radiusM = tier.minR + (tier.maxR - tier.minR) * rockHash(i, j, k * 7 + 3, tier.seed) ** tier.power
          visit(out, n)
          n++
        }
      }
    }
  }
  return n
}
