import { useEffect, useRef } from 'react'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { formatMarsCoordinate, type MarsCoordinate } from '../../../domain'

/** Width of the menu at most, CSS px; the map keeps it inside its window. */
export const MAP_MENU_WIDTH_PX = 200
export const MAP_MENU_HEIGHT_PX = 96

/**
 * The overhead map's right-click menu: the picked coordinate and a
 * question, Teleport here or Cancel. Small, since it lives inside the map
 * window rather than over the screen. Focus starts on Teleport here; Esc
 * reaches it through the surface view's one Escape chain, not here.
 */
export function OverheadMapMenu({
  at,
  name,
  decimals,
  x,
  y,
  width,
  onTeleport,
  onCancel,
}: {
  at: MarsCoordinate
  /** A pin's name when the right-click was on one: its own coordinate, not read from the map. */
  name?: string
  decimals: number
  /** Top left inside the map window, CSS px, already kept inside it. */
  x: number
  y: number
  /** Narrower than MAP_MENU_WIDTH_PX in the small map. */
  width: number
  onTeleport: () => void
  onCancel: () => void
}) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  return (
    <div
      role="dialog"
      // Space and Enter press its buttons rather than move the walker.
      data-own-keys
      aria-label="Teleport here?"
      style={{ left: x, top: y, width }}
      className="absolute z-10 flex flex-col gap-1.5 rounded-control border border-line/60 bg-surface/95 p-2 text-caption text-ink-muted shadow-panel"
      // Its own clicks are not map clicks.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="flex items-center gap-1.5">
        <span className="font-mono text-ink select-text">{formatMarsCoordinate(at, decimals)}</span>
        {!name && (
          <ClassificationBadge
            classification="DERIVED"
            detail="Read from the map: the pointer's place in the layer's equirectangular grid, to about one screen pixel."
          />
        )}
      </p>
      <p>{name ? `Teleport to ${name}?` : 'Teleport here?'}</p>
      <div className="flex gap-1.5">
        <button
          ref={first}
          type="button"
          onClick={onTeleport}
          className="rounded-control border border-line px-2 py-0.5 text-ink transition-colors duration-(--duration-fast) hover:bg-surface-raised"
        >
          Teleport here
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-control px-2 py-0.5 text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
