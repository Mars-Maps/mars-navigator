import { ToolIcon } from './PlaceholderPanels'
import type { ToolDefinition } from './types'

/**
 * Rover photos: real Perseverance photos along the path, oldest sol
 * first. The shell renders its panel, since only the shell may read the
 * raw-image feed and join it to the rover's path.
 */
export const roverPhotosTool: ToolDefinition = {
  id: 'rover-photos',
  label: 'Rover photos',
  hint: 'Real rover photos along the path and near each stop',
  icon: (
    <ToolIcon>
      <path d="M4 8h3l2-3h6l2 3h3v11H4Z" />
      <circle cx="12" cy="13" r="3.5" />
    </ToolIcon>
  ),
  panelFromShell: true,
}
