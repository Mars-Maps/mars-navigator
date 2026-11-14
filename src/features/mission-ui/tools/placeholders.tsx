import { TERRAIN_PROFILE_TOOL_ID } from '../../../state'
import { ToolIcon } from './PlaceholderPanels'
import type { ToolDefinition } from './types'

/**
 * Two tools whose panels the shell renders:
 * Terrain Profile, from the heights between two points, and Search
 * & Go To, from the Gazetteer's place names. Marked points lives in
 * `flag.tsx` and Measure in `measure.tsx`. Compare, Mission
 * Timeline and the Site Inspector were removed from the dock.
 * Terrain Profile 3D is built and lives in
 * `terrainProfile3d.tsx`.
 */

export const terrainProfileTool: ToolDefinition = {
  id: TERRAIN_PROFILE_TOOL_ID,
  label: 'Terrain Profile',
  hint: 'Elevation along a line on the surface: click A, then B',
  icon: (
    <ToolIcon>
      <path d="M3 3v18h18" />
      <path d="m6 16 4-5 3 3 5-6" />
    </ToolIcon>
  ),
  // The shell computes the profile, so it renders `TerrainProfileView`.
  panelFromShell: true,
}

export const searchTool: ToolDefinition = {
  id: 'search',
  label: 'Search & Go To',
  hint: 'Find a place and fly there',
  icon: (
    <ToolIcon>
      <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z" />
      <circle cx="12" cy="10" r="2" />
    </ToolIcon>
  ),
  // The shell reads the place names and moves the camera.
  panelFromShell: true,
}
