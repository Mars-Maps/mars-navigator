import { MarkedPoints } from './MarkedPoints'
import { ToolIcon } from './PlaceholderPanels'
import type { ToolDefinition } from './types'

/**
 * Marked points: the marked-points list, registered like any other
 * tool. Named as its panel and the menu's "Mark point" are, not
 * "Flag a point": a walk leg's slope and obstacle marks are its flags.
 */
export const flagTool: ToolDefinition = {
  id: 'flag',
  label: 'Marked points',
  hint: 'List, describe and unmark the points you marked',
  icon: (
    <ToolIcon>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.5 4L17 12H5" />
    </ToolIcon>
  ),
  Panel: MarkedPoints,
}
