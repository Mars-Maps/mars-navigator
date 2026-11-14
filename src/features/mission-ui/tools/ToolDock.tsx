import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { useMissionStore } from '../../../state'
import { useEscapeLayer } from '../../../lib/useEscapeLayer'
import { nextActiveTool } from './activation'
import { focusAfterClose } from './dockFocus'
import { PlaceholderPanel } from './PlaceholderPanels'
import { findTool, TOOL_REGISTRY } from './registry'
import { nextToolbarIndex } from './toolbarKeys'
import type { ShellPanels, ToolDefinition } from './types'
import { useDockMagnifier } from './useDockMagnifier'

/**
 * Dock-style toolbar at the bottom centre of every globe mode,
 * with Plan a walk and the map tools. It renders
 * the registry and writes only `activeToolId`; whatever the active tool
 * changes elsewhere (the scene's pointer behaviour, a panel) reads the
 * store.
 *
 * Magnification works like the macOS dock: buttons grow with their nearness
 * to the cursor, so the bar widens and neighbours make room, while its
 * height stays put and the grown buttons rise above it (`useDockMagnifier`).
 * The design-system note says hover should not scale; the dock is the one
 * deliberate exception.
 *
 * Keyboard: one Tab stop, then ← → Home End between tools (ARIA toolbar).
 *
 * `panels` holds the bodies the shell renders, keyed by tool id, for tools
 * marked `panelFromShell`, the way the shell feeds the navigation
 * panels. Its type names every such tool, so a missing or misspelt key is
 * a compile error; without `panels` (tests) such a tool opens nothing.
 */
export function ToolDock({ panels }: { panels?: ShellPanels }) {
  const activeToolId = useMissionStore((s) => s.activeToolId)
  const setActiveTool = useMissionStore((s) => s.setActiveTool)
  const active = findTool(activeToolId)
  const { bar, buttons, barProps } = useDockMagnifier(TOOL_REGISTRY.length)
  // The dock's one Tab stop: the tool focused last, at first the active one.
  const [focusIndex, setFocusIndex] = useState(() =>
    Math.max(0, TOOL_REGISTRY.findIndex((tool) => tool.id === activeToolId)),
  )

  // Escape releases the active tool, when it is the top layer.
  useEscapeLayer(activeToolId !== null, () => setActiveTool(null))

  // No dock, no active tool: entering surface or "Hide all tools" unmounts
  // the dock and with it the Escape layer, so the tool is released here
  // rather than left active with nothing on screen to show or end it. Moves
  // between welcome, close-up and navigation keep the dock, and the tool
  // with it.
  useEffect(() => () => setActiveTool(null), [setActiveTool])

  // A panel closed from inside (a photo's Go to, Escape) gives focus back to
  // its tool's button rather than dropping it to the page (`focusAfterClose`).
  // Removing the focused element fires no blur, so the flag is still set then.
  const focusInPanel = useRef(false)
  const lastActive = useRef(activeToolId)
  useEffect(() => {
    const was = lastActive.current
    lastActive.current = activeToolId
    const back = focusAfterClose(was, activeToolId, focusInPanel.current)
    if (was !== activeToolId) focusInPanel.current = false
    if (back !== null) buttons.current[TOOL_REGISTRY.findIndex((tool) => tool.id === back)]?.focus()
  }, [activeToolId, buttons])

  const onToolbarKeyDown = (e: ReactKeyboardEvent) => {
    const next = nextToolbarIndex(e.key, focusIndex, TOOL_REGISTRY.length)
    if (next === null) return
    e.preventDefault()
    buttons.current[next]?.focus()
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {active && hasPanel(active) && (
        <div
          id={PANEL_ID}
          className="w-full"
          onFocus={() => {
            focusInPanel.current = true
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) focusInPanel.current = false
          }}
        >
          <ToolPanel tool={active} panels={panels ?? {}} />
        </div>
      )}

      <div
        ref={bar}
        role="toolbar"
        aria-label="Tools"
        onKeyDown={onToolbarKeyDown}
        {...barProps}
        className="flex h-[3.625rem] items-end gap-1 rounded-panel border border-line/60 bg-surface/70 px-2 pb-1 shadow-panel backdrop-blur-glass"
      >
        {TOOL_REGISTRY.map((tool, i) => (
          <ToolButton
            key={tool.id}
            tool={tool}
            pressed={tool.id === active?.id}
            tabStop={i === focusIndex}
            buttonRef={(el) => {
              buttons.current[i] = el
            }}
            onFocus={() => setFocusIndex(i)}
            onPress={() => setActiveTool(nextActiveTool(activeToolId, tool.id))}
          />
        ))}
      </div>
    </div>
  )
}

/** The body that opens above the dock for `tool`: its own, the shell's, or the not-built notice. */
export function ToolPanel({
  tool,
  panels,
}: {
  tool: ToolDefinition
  panels: Readonly<Partial<Record<string, ReactNode>>>
}) {
  if (tool.Panel) return <tool.Panel />
  if (tool.panelFromShell) return panels[tool.id] ?? null
  return <PlaceholderPanel title={tool.label} note={tool.notBuilt ?? ''} />
}

function ToolButton({
  tool,
  pressed,
  tabStop,
  buttonRef,
  onFocus,
  onPress,
}: {
  tool: ToolDefinition
  pressed: boolean
  tabStop: boolean
  buttonRef: Ref<HTMLButtonElement>
  onFocus: () => void
  onPress: () => void
}) {
  const disabledReason = useMissionStore(tool.disabledReason ?? noReason)
  const setActiveTool = useMissionStore((s) => s.setActiveTool)

  // A tool that becomes unusable while active is released, not left open
  // over state it cannot use.
  useEffect(() => {
    if (pressed && disabledReason) setActiveTool(null)
  }, [pressed, disabledReason, setActiveTool])

  const reasonId = `tool-${tool.id}-disabled`
  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={tabStop ? 0 : -1}
      aria-label={tool.label}
      title={disabledReason ?? tool.hint}
      aria-pressed={pressed}
      aria-disabled={disabledReason ? true : undefined}
      aria-describedby={disabledReason ? reasonId : undefined}
      aria-controls={pressed && hasPanel(tool) ? PANEL_ID : undefined}
      onFocus={onFocus}
      onClick={() => {
        if (!disabledReason) onPress()
      }}
      className={`flex size-[calc(2.5rem*var(--dock-scale,1))] shrink-0 items-center justify-center rounded-control transition-[width,height,color,background-color] duration-(--duration-fast) ease-(--ease-standard) ${
        disabledReason
          ? 'cursor-not-allowed text-ink-subtle/60'
          : pressed
            ? 'bg-accent/15 text-accent'
            : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
      }`}
    >
      {tool.icon}
      {disabledReason && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </button>
  )
}

function hasPanel(tool: ToolDefinition): boolean {
  return Boolean(tool.Panel || tool.panelFromShell || tool.notBuilt)
}

function noReason(): null {
  return null
}

const PANEL_ID = 'tool-dock-panel'
