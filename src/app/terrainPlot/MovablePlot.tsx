import { useRef, type CSSProperties, type ReactNode } from 'react'
import { useMovablePlot } from './useMovablePlot'

const HANDLE_HELP = 'Move the plot: drag this bar, or use the arrow keys. Home or a double-click puts it back.'

/**
 * The Terrain Profile 3D plot's box on the screen: a handle bar and, under
 * it, whatever the tool shows (the plot or its frame, the notes). The user
 * moves the box by the handle; dragging inside the plot still orbits it.
 * `useMovablePlot` decides where it is drawn: the user's place, the default
 * one, or out of the way of an open menu. The box sets `--plot-h`, the
 * plot's height, which the canvas and the frame both take.
 *
 * `children` gets whether the box is at a compact size, for the tool to
 * fold its notes.
 */
export function MovablePlot({ children }: { children: (compact: boolean) => ReactNode }) {
  const box = useRef<HTMLElement>(null)
  const { place, width, plotHeight, compact, dragging, move } = useMovablePlot(box)
  return (
    <section
      ref={box}
      aria-label="Terrain Profile 3D plot"
      data-terrain-plot=""
      style={{ left: place.x, top: place.y, width, '--plot-h': `${plotHeight}px` } as CSSProperties}
      className={`absolute flex flex-col gap-1 ${dragging ? '' : 'transition-[left,top] duration-200 motion-reduce:transition-none'}`}
    >
      <button
        type="button"
        aria-label={HANDLE_HELP}
        title={HANDLE_HELP}
        onPointerDown={move.onPointerDown}
        onPointerMove={move.onPointerMove}
        onPointerUp={move.onPointerUp}
        onPointerCancel={move.onPointerCancel}
        onDoubleClick={move.onDoubleClick}
        onKeyDown={move.onKeyDown}
        className="flex h-7 w-full cursor-grab touch-none select-none items-center gap-1.5 rounded-control border border-line bg-surface/80 px-2 text-caption text-ink-muted backdrop-blur-glass transition-colors duration-(--duration-fast) hover:text-ink active:cursor-grabbing"
      >
        <GripIcon />
        <span className="text-ink">3D plot</span>
        <span className="ml-auto">drag to move</span>
      </button>
      {children(compact)}
    </section>
  )
}

function GripIcon() {
  return (
    <svg viewBox="0 0 12 16" className="h-3.5 w-2.5 shrink-0" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1.4" />
      <circle cx="9" cy="3" r="1.4" />
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="9" cy="8" r="1.4" />
      <circle cx="3" cy="13" r="1.4" />
      <circle cx="9" cy="13" r="1.4" />
    </svg>
  )
}
