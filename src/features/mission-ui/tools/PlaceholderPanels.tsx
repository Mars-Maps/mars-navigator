import type { ReactNode } from 'react'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'

/**
 * The panel a tool opens while its body is not built, and the
 * icon frame every tool uses. The panel says the tool is not built yet and
 * makes no data claim. Components only, in their own file, so Fast Refresh
 * keeps working.
 */

export function PlaceholderPanel({ title, note }: { title: string; note: string }) {
  const { minimized, toggle, bodyId } = useMinimized()
  return (
    <Panel surface="glass" compact={minimized} className="w-full">
      <PanelHeader
        title={title}
        minimized={minimized}
        onToggleMinimized={toggle}
        bodyId={bodyId}
        spacing="mb-2"
      >
        <h2 className="text-heading font-semibold text-ink">{title}</h2>
      </PanelHeader>
      {!minimized && (
        <p id={bodyId} className="text-caption text-ink-subtle">
          Tool not built yet ({note}).
        </p>
      )}
    </Panel>
  )
}

/**
 * 24×24 line icon frame, same strokes as the icon panel's. In the dock it
 * grows with its button through `--dock-scale`; elsewhere it is 20 px.
 */
export function ToolIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[calc(1.25rem*var(--dock-scale,1))] transition-[width,height] duration-(--duration-fast) ease-(--ease-standard)"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}
