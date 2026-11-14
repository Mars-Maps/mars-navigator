/** A square grid of ground heights over one patch. */
export interface Heightfield {
  /** Row-major, row 0 at the north edge, column 0 at the west edge, metres. */
  heights: Float32Array
  /** Vertices per side. */
  size: number
  /** Metres between neighbouring vertices. */
  spacingM: number
}

/**
 * Height in metres at patch-local metres (x east, y north of the centre),
 * clamped at the edges. Interpolates on the same two triangles per cell as
 * Three's PlaneGeometry (diagonal from bottom-left to top-right), so a
 * point sampled here lies exactly on the drawn surface. Allocates nothing.
 */
export function sampleHeight(field: Heightfield, xM: number, yM: number): number {
  const { heights, size, spacingM } = field
  const halfM = ((size - 1) * spacingM) / 2
  const fc = Math.min(size - 1.000001, Math.max(0, (xM + halfM) / spacingM))
  const fr = Math.min(size - 1.000001, Math.max(0, (halfM - yM) / spacingM))
  const c = Math.floor(fc)
  const r = Math.floor(fr)
  const tx = fc - c
  const ty = fr - r
  const i = r * size + c
  const a = heights[i] // top-left
  const d = heights[i + 1] // top-right
  const b = heights[i + size] // bottom-left
  const cc = heights[i + size + 1] // bottom-right
  if (tx + ty <= 1) return a + (d - a) * tx + (b - a) * ty
  return cc + (b - cc) * (1 - tx) + (d - cc) * (1 - ty)
}
