import { ToolIcon } from './PlaceholderPanels'
import type { ToolDefinition } from './types'

/**
 * Plan a walk: set a landing site on the map and get a walk
 * with stops and legs. The shell renders its panel, since it runs the
 * planner and writes the walk plan.
 *
 * The hint names the one place the tool works: a walk is planned on the
 * Jezero map sheet only, and the landing colours are drawn there and
 * nowhere else. The panel says the same and has the button that flies there.
 */
export const planWalkTool: ToolDefinition = {
  id: 'plan-walk',
  label: 'Plan a walk',
  hint: 'Jezero crater only: set a landing site in or around the crater and plan a walk with stops',
  icon: (
    <ToolIcon>
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="6" r="2" />
      <path d="M7 17c4-1 2-6 6-7s3-3 4-3" strokeDasharray="2 2" />
    </ToolIcon>
  ),
  panelFromShell: true,
}
