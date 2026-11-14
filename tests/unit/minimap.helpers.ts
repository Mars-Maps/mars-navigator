export { boxUv, isPolarBox, makeFrame, patchBox, patchGrid } from '../../src/features/mars-3d/surfaceView/surfacePatch'
/** A coarse grid is enough for a box; the ground's 321 would only slow the test. */
export const GROUND_GRID_FOR_TESTS = 17
