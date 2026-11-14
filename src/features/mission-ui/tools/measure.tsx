import { MEASURE_TOOL_ID } from '../../../state'
import { MeasurePanel } from './MeasurePanel'
import { ToolIcon } from './PlaceholderPanels'
import type { ToolDefinition } from './types'

/**
 * Measure: click two points on the globe for the distance and
 * initial bearing between them. While it is active the scene's left click
 * sets the points (mars-3d reads `activeToolId`); the panel shows the result.
 */
export const measureTool: ToolDefinition = {
  id: MEASURE_TOOL_ID,
  label: 'Measure',
  hint: 'Measure the distance and bearing between two points: click A, then B',
  icon: (
    <ToolIcon>
      <path d="m3 17 14-14 4 4L7 21l-4-4Z" />
      <path d="m8 8 2 2M11 5l2 2M14 11l2 2M5 11l2 2" />
    </ToolIcon>
  ),
  Panel: MeasurePanel,
}
