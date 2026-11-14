import type { ComponentType, ReactNode } from 'react'
import type { MissionState } from '../../../state'

/**
 * One entry in the tool registry. The dock renders every entry, so
 * adding a tool is one object in `registry.ts` and nothing else.
 *
 * The active tool's id is interface state the whole app reads
 * (`activeToolId` in the store); a scene or panel that behaves differently
 * while a tool is active compares against the tool's `id`.
 */
export interface ToolDefinition {
  /** Stable and unique across the registry; this is what the store holds. */
  id: string
  label: string
  /** One line of help, shown as the button's title. */
  hint: string
  /** A 24×24 line icon drawn with `currentColor`. */
  icon: ReactNode
  /**
   * What opens above the dock while the tool is active. A tool without a
   * panel is a pure mode — the scene reacts to `activeToolId` instead.
   */
  Panel?: ComponentType
  /**
   * Set when the shell renders the tool's panel and hands it to the dock
   * (`ToolDock`'s `panels`, keyed by `id`), because its body needs what
   * only the shell may compute, such as a route-analysis result or
   * the selected point's height, the walk planner, the
   * rover photos read from the feed, or heights on a grid.
   */
  panelFromShell?: true
  /**
   * Set while the tool's body is not built: a short note on when it will be,
   * such as "not scheduled". The dock opens a panel that says so and shows nothing
   * measured. Remove it when `Panel` arrives.
   */
  notBuilt?: string
  /**
   * Why the tool cannot be used right now, or null when it can. Read from
   * the store, so the button follows the state. A disabled tool stays
   * focusable and says why.
   */
  disabledReason?: (state: MissionState) => string | null
}

/** The tools marked `panelFromShell`; `tests/unit/toolDock.test.tsx` checks the registry agrees. */
export const SHELL_PANEL_TOOL_IDS = ['plan-walk', 'rover-photos', 'terrain-profile', 'terrain-profile-3d', 'search'] as const

/** `ToolDock`'s `panels`: one for each tool the shell renders a panel for. */
export type ShellPanels = Readonly<Record<(typeof SHELL_PANEL_TOOL_IDS)[number], ReactNode>>
