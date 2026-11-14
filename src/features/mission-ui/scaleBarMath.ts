/**
 * Scale bar maths. DERIVED, not measured.
 *
 * Method: the camera looks straight down at the view centre from `altitudeKm`
 * above the mean-radius sphere. A vertical field of view of `fovDeg` spans
 * 2 · altitude · tan(fov / 2) of ground over `heightPx` screen pixels, so one
 * pixel is that span divided by `heightPx`. Exact at the centre of the view
 * only: towards the limb perspective and the sphere's curvature make the
 * ground scale differ, and the sphere is a mean-radius model of Mars.
 * Latitude does not enter: on a sphere viewed straight down the scale at
 * the centre is the same at every latitude.
 */
export function kmPerPixel(altitudeKm: number, fovDeg: number, heightPx: number): number | null {
  if (!(altitudeKm > 0) || !(fovDeg > 0 && fovDeg < 180) || !(heightPx > 0)) return null
  return (2 * altitudeKm * Math.tan((fovDeg / 2) * (Math.PI / 180))) / heightPx
}

export interface ScaleBarLength {
  /** The rounded real length the bar stands for, km. */
  km: number
  /** Its drawn width, px, never more than the `maxPx` it was given. */
  widthPx: number
}

/**
 * The longest 1, 2 or 5 × 10ⁿ km that fits in `maxPx` at `kmPerPx`.
 * Null when there is nothing sensible to draw (bad scale, or `maxPx` so small
 * that even a tiny length would not fit).
 */
export function niceLength(kmPerPx: number | null, maxPx: number): ScaleBarLength | null {
  if (kmPerPx === null || !(kmPerPx > 0) || !(maxPx > 0)) return null
  const maxKm = kmPerPx * maxPx
  const decade = Math.floor(Math.log10(maxKm))
  // Largest first; a candidate equal to maxKm fits. The tolerance only
  // absorbs floating-point error in log10 at exact powers of ten.
  for (const d of [decade + 1, decade]) {
    for (const m of [5, 2, 1]) {
      const km = m * 10 ** d
      if (km <= maxKm * (1 + 1e-9)) return { km, widthPx: Math.min(maxPx, km / kmPerPx) }
    }
  }
  return null
}

/** "500 km", "2 km", "500 m": metres below 1 km so a close view never reads "0.5 km". */
export function formatLength(km: number): string {
  if (km >= 1) return `${Math.round(km).toLocaleString('en-US')} km`
  return `${Math.round(km * 1000)} m`
}
