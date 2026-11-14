import { ToolIcon } from './PlaceholderPanels'
import { TERRAIN_PROFILE_3D_TOOL_ID } from '../../../state'
import type { ToolDefinition } from './types'

/**
 * Terrain Profile 3D: click four corners on the globe for the ground
 * between them as a surface plot. While it is active the scene's left click
 * sets the corners (mars-3d reads `activeToolId`) and draws the region; the
 * shell computes the surface, so it renders `TerrainProfile3dView`. The
 * panel opens at any count and says what it needs, like Terrain Profile,
 * rather than a disabled button.
 */
export const terrainProfile3dTool: ToolDefinition = {
  id: TERRAIN_PROFILE_3D_TOOL_ID,
  label: 'Terrain Profile 3D',
  hint: 'The ground between four corners as a 3D surface: click them in order',
  icon: (
    <ToolIcon>
      <path d="M3 17 12 21l9-4" />
      <path d="M3 17V7l9-4 9 4v10" />
      <path d="M12 21V11" />
      <path d="m3 7 9 4 9-4" />
    </ToolIcon>
  ),
  panelFromShell: true,
}
