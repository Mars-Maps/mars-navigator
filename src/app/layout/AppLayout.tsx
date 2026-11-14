import type { ReactNode } from 'react'
import { useMissionStore } from '../../state'
import { BACKGROUND, COLUMNS, SCROLL_GROUPS, SLOTS, arrange, columnParts, visibleSlots, type SlotId } from './slots'

interface AppLayoutProps {
  /** Real panels by slot. A slot left out shows a labeled placeholder; null draws nothing there. */
  panels: Partial<Record<SlotId, ReactNode>>
  /** Overlays that belong to no slot, e.g. the context menu. Drawn last. */
  children?: ReactNode
}

/** What is invented on every screen, whatever the data: the rest carries its own mark. */
export const SIMULATED_ON_SCREEN = "the globe's spin speed and the surface view's look"

function Placeholder({ id }: { id: SlotId }) {
  const { label } = SLOTS[id]
  // The scene fills the screen, so its label sits at the top, clear of panels.
  const align = id === 'scene' ? 'items-start pt-20' : 'items-center'
  return (
    <div
      className={`flex h-full min-h-10 justify-center rounded-control border border-dashed border-line-strong px-3 py-2 text-caption text-ink-subtle ${align}`}
    >
      {label}
    </div>
  )
}

/**
 * The visible slots, placed. Takes the ids rather than reading the store so
 * a test can render any mode's set. Each carries its id as `data-slot`: the
 * movable plot measures the panels around it by that.
 */
export function SlotTree({
  visible,
  panels,
}: {
  visible: readonly SlotId[]
  panels: AppLayoutProps['panels']
}) {
  return arrange(visible).map((p) =>
    p.kind === 'slot' ? (
      <div key={p.id} className={`absolute ${SLOTS[p.id].position}`} data-slot={p.id}>
        {panels[p.id] === undefined ? <Placeholder id={p.id} /> : panels[p.id]}
      </div>
    ) : (
      // The column spans its region but lets pointer events through to
      // the globe; only its members catch them.
      <div
        key={`column:${p.column}`}
        className={`pointer-events-none absolute flex flex-col ${COLUMNS[p.column]}`}
      >
        {columnParts(p.ids).map((part) =>
          part.kind === 'slot' ? (
            <Member key={part.id} id={part.id} panels={panels} />
          ) : (
            // One box that scrolls, its members at their own heights.
            // It catches the pointer as a whole, so the wheel scrolls it
            // even between two panels.
            <div
              key={`scroll:${part.group}`}
              data-scroll-group={part.group}
              className={`pointer-events-auto ${SCROLL_GROUPS[part.group]}`}
            >
              {part.ids.map((id) => (
                <Member key={id} id={id} panels={panels} />
              ))}
            </div>
          ),
        )}
      </div>
    ),
  )
}

function Member({ id, panels }: { id: SlotId; panels: AppLayoutProps['panels'] }) {
  return <div className={`pointer-events-auto ${SLOTS[id].position}`} data-slot={id}>{panels[id] === undefined ? <Placeholder id={id} /> : panels[id]}</div>
}

export function AppLayout({ panels, children }: AppLayoutProps) {
  const viewMode = useMissionStore((s) => s.viewMode)
  const toolsHidden = useMissionStore((s) => s.toolsHidden)
  const toggleToolsHidden = useMissionStore((s) => s.toggleToolsHidden)

  // "Hide all tools" leaves the scene and the caption; the context menu brings the rest back.
  const visible = visibleSlots(viewMode, toolsHidden)

  return (
    <main
      className={`relative h-screen w-screen overflow-hidden text-ink transition-colors ${BACKGROUND[viewMode]}`}
    >
      <SlotTree visible={visible} panels={panels} />

      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">
        {/* A way back that does not depend on the scene's right-click. */}
        {toolsHidden && (
          <button
            type="button"
            onClick={toggleToolsHidden}
            className="rounded-control border border-line bg-surface/80 px-2 py-1 text-caption text-ink-muted transition-colors hover:text-ink"
          >
            Show tools
          </button>
        )}
        {/*
          Small, always on screen, on the panels'
          glass so it reads on any terrain: what is invented stays named while
          the caption is closed. A SIMULATED plan
          has its own banner.
        */}
        <p className="rounded-control border border-simulated/40 bg-surface/80 px-1.5 py-0.5 text-micro text-simulated backdrop-blur-glass">
          Simulated: {SIMULATED_ON_SCREEN}.
        </p>
      </div>

      {children}
    </main>
  )
}
