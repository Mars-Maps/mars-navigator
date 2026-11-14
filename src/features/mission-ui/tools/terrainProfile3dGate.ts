import type { MarsCoordinate, RouteStrategy } from '../../../domain'
import { TERRAIN_PROFILE_CORNERS, terrainProfileState, type TerrainProfileState } from '../../route-analysis/terrainProfile'
import type { TerrainSurface } from '../../route-analysis/terrainProfileGrid'
import { STRATEGY_LABEL } from '../navigation/labels'

/** The surface while its heights are being read: UNAVAILABLE, never a blank that reads as flat ground. */
export const SAMPLING_GRID_REASON = 'Sampling the ground between the corners…'

/**
 * Added to a first answer's method while the finer model is still being read:
 * the same words as `REFINING_NOTE` in the shell's `routeProfile.ts`
 * (a test keeps them equal), repeated here so the tool's lazy chunk does not
 * import that module and pull the profile chart out of the entry.
 */
export const REFINING_GRID_NOTE = 'refining with the finer elevation model, still being read'

/**
 * The tool's gate: the four-point contract (`terrainProfileState`)
 * applied to the clicked corners in click order, and the line the
 * panel says while it is not ready, in the contract's words with the count.
 * `line` is null when the corners are ready.
 */
export function terrainProfile3dGate(points: readonly MarsCoordinate[]): {
  state: TerrainProfileState
  line: string | null
} {
  const state = terrainProfileState(points)
  if (state.status === 'ready') return { state, line: null }
  const line =
    state.status === 'disabled' ? `${state.reason} (${points.length} of ${TERRAIN_PROFILE_CORNERS} set)` : state.reason
  return { state, line }
}

const n = (v: number) => Math.round(v).toLocaleString('en-US')

/**
 * The line under the plot: the lattice, where its heights came from, the
 * relief and the holes. The models' own provenance lines stay in the badge's
 * tooltip (the surface's method). Pure, for the view and its tests.
 */
export function surfaceCaption(surface: TerrainSurface): string {
  const { grid, shares, holes, rangeM } = surface
  const east = Math.round(grid.spacingKm.x * 1000)
  const north = Math.round(grid.spacingKm.y * 1000)
  // One figure when the two are within a tenth, both when the box is long and thin.
  const spacing =
    Math.abs(east - north) <= 0.1 * Math.max(east, north)
      ? `${n(Math.min(east, north))} m`
      : `${n(east)} m east and ${n(north)} m north`
  const from = shares.map((s) => `${n(s.count)} from the ${s.model.label}`).join(', ')
  const holesText = holes === 0 ? '' : ` ${n(holes)} ${holes === 1 ? 'node has' : 'nodes have'} no height: left as holes, never filled.`
  return (
    `${grid.columns} × ${grid.rows} heights about every ${spacing}: ${from}. ` +
    `Ground from ${n(rangeM.min)} m to ${n(rangeM.max)} m.${holesText}`
  )
}

/** Where the followed route stands to the plot's box: drawn across it, crossing only holes, outside it, or without a path to draw. */
export type RouteOnPlot = 'crosses' | 'holes' | 'outside' | 'no-path'

/**
 * The caption's line about the followed route while navigating: the
 * strategy by its name, and whether its path is drawn on the plot. A route
 * whose path is UNAVAILABLE has nothing to draw, as on the globe, and the
 * line says so rather than leaving the user to wonder.
 */
export function routeCaption(strategy: RouteStrategy, on: RouteOnPlot): string {
  const name = STRATEGY_LABEL[strategy]
  const route = `The ${name.charAt(0).toLowerCase()}${name.slice(1)} route`
  if (on === 'crosses') return `${route} is drawn where it crosses the box.`
  if (on === 'holes') return `${route} crosses the box only over ground with no height, so it is not drawn.`
  if (on === 'outside') return `${route} does not cross the box.`
  return `${route} has no path to draw.`
}
