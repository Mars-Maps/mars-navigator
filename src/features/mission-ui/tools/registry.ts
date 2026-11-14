import { flagTool } from './flag'
import { measureTool } from './measure'
import { planWalkTool } from './planWalk'
import { roverPhotosTool } from './roverPhotos'
import { searchTool, terrainProfileTool } from './placeholders'
import { terrainProfile3dTool } from './terrainProfile3dTool'
import type { ToolDefinition } from './types'

/**
 * Every tool the dock shows, in dock order: Plan a walk and Rover
 * photos, the walk flow, then the map tools.
 * To add a tool, define
 * it (its own file, like `measure.tsx`) and add it here. Ids must be
 * unique — `tests/unit/toolRegistry.test.ts` checks.
 */
export const TOOL_REGISTRY: readonly ToolDefinition[] = [
  planWalkTool,
  roverPhotosTool,
  measureTool,
  flagTool,
  terrainProfileTool,
  terrainProfile3dTool,
  searchTool,
]

/** null for no id, or an id the registry does not know (a stale store value). */
export function findTool(id: string | null): ToolDefinition | null {
  if (id === null) return null
  return TOOL_REGISTRY.find((tool) => tool.id === id) ?? null
}
