import type { GroundImagery } from '../surfaceDetail'
import type { HeightProvenance } from './groundPatch'

/** One ground mosaic's tiles over the patch: `loaded` is null until every load has settled. */
export interface GroundImageryStatus {
  imagery: GroundImagery
  zoom: number
  total: number
  loaded: number | null
}

/** What the surface view's caption is told about the ground under the walker. */
export type GroundStatus =
  | { kind: 'loading' }
  /** `ground`: the mosaics that touch the patch, coarsest first; empty when the layer is draped alone. */
  | { kind: 'ready'; provenance: HeightProvenance; ground: GroundImageryStatus[]; edge: string | null }
  | { kind: 'unavailable'; reason: string }

/** `ground` with mosaic `i`'s settled tile count, the others as they are, in any order of settling. */
export function withLoaded(ground: GroundImageryStatus[], i: number, loaded: number): GroundImageryStatus[] {
  return ground.map((g, j) => (j === i ? { ...g, loaded } : g))
}

/**
 * The line over the scene while the ground is not drawn yet: the
 * heights first, then, once the patch is built, its pictures until every
 * ground mosaic has settled. Until they do the ground is the dark no-data
 * fill, and the overhead map, which shows the same picture, is dark too.
 * Null when there is nothing left to wait for.
 */
export function loadingLine(status: GroundStatus): string | null {
  if (status.kind === 'loading') return 'Loading the ground…'
  if (status.kind === 'ready' && status.ground.some((g) => g.loaded === null)) return 'Loading the pictures…'
  return null
}

export function readyStatus(
  provenance: HeightProvenance,
  ground: GroundImageryStatus[],
  edge: string | null,
): GroundStatus {
  return { kind: 'ready', provenance, ground, edge }
}

/**
 * The caption's warning that the ground is smoother than its picture.
 * The imagery is orbital photographs with their shadows in the
 * pixels, finer than the mesh, so a crater from above can be flat ground
 * underfoot. Says so wherever the walker is: at Jezero the mesh takes the
 * 20 m CTX heights blended into the global model (the 1 m HiRISE model is
 * not read for it), still drawn at the mesh's spacing.
 */
export function reliefNote(spacingM: number): string {
  return `The ground's shape has one point every ${Math.round(spacingM)} m, and none finer than the cells of the height model named below. Craters and ridges smaller than a few hundred metres are shadows in the photographs, not in the ground: from above they look real, underfoot the ground's shape is smooth.`
}
