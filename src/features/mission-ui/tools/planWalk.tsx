import { ToolIcon } from './PlaceholderPanels'
import type { ToolDefinition } from './types'

/**
 * Plan a walk: pick a science goal and get stops and legs. The shell
 * renders its panel, since it runs the planner and writes the walk plan.
 */
export const planWalkTool: ToolDefinition = {
  id: 'plan-walk',
  label: 'Plan a walk',
  hint: 'Pick a science goal and plan a walk with stops',
  icon: (
    <ToolIcon>
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="6" r="2" />
      <path d="M7 17c4-1 2-6 6-7s3-3 4-3" strokeDasharray="2 2" />
    </ToolIcon>
  ),
  panelFromShell: true,
}
