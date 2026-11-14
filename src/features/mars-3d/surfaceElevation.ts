import type { Classified } from '../../domain'

/**
 * Where the surface view gets ground heights. The scene asks for heights at
 * a list of coordinates and never learns where they come from, like
 * SurfaceDetail does for imagery.
 *
 * The app shell passes the elevation adapter in `src/data/`
 * to MarsGlobe as `elevation`, wrapped in this interface.
 * Without one, MarsGlobe falls back to the SIMULATED source in
 * `surfaceView/simulatedElevation.ts`, labelled as such; the view's caption
 * follows whatever classification and source it is given.
 */
export interface SurfaceElevation {
  /**
   * Heights in metres at each point. `points` holds (latitude, longitude °E)
   * pairs; the result has one height per pair, in the same order.
   *
   * The heights only need a common datum within one call (the view draws
   * them relative to each other); the source names its datum in `source`.
   * Interpolated values from a gridded product are DERIVED or OFFICIAL as
   * the adapter decides, with the method or source stated. UNAVAILABLE,
   * with a reason, when any point has no data: the view then refuses to
   * draw the ground rather than drawing it flat, which would read as zero.
   *
   * Never rejects. After `signal` aborts the result is ignored.
   */
  sample(points: Float64Array, signal: AbortSignal): Promise<Classified<Float32Array>>
}
