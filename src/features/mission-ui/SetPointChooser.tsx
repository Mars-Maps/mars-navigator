import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { formatMarsCoordinate } from '../../domain'
import { useMissionStore, type ContextMenuState } from '../../state'
import { useEscapeLayer } from '../../lib/useEscapeLayer'
import { useReturnFocus } from '../../lib/useReturnFocus'

/**
 * Where Set point puts a point once the route has both ends: start,
 * end or a new stop. Opened by the store's setPoint at the cursor; it only
 * reads `setPointChooser` and dispatches store actions, like ContextMenu.
 */
export function SetPointChooser() {
  const chooser = useMissionStore((s) => s.setPointChooser)
  if (!chooser) return null
  // A new anchor is a new chooser: focus and position start over.
  return <OpenChooser key={`${chooser.anchor.x},${chooser.anchor.y}`} chooser={chooser} />
}

/** Keeps the chooser inside the viewport. */
const EDGE_PX = 8
/** Beside the cursor, not under it, so the pointer does not cover the first item. */
const CURSOR_GAP_PX = 12

function OpenChooser({ chooser }: { chooser: ContextMenuState }) {
  const { coordinate, anchor } = chooser
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: anchor.x + CURSOR_GAP_PX, y: anchor.y })

  const close = useMissionStore((s) => s.closeSetPointChooser)
  const setDeparture = useMissionStore((s) => s.setDeparture)
  const setDestination = useMissionStore((s) => s.setDestination)
  const addStop = useMissionStore((s) => s.addStop)

  // Beside the cursor; flipped to its left near the right edge, and shifted
  // up from the bottom, once the size is known.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const right = anchor.x + CURSOR_GAP_PX
    const x = right + width + EDGE_PX <= window.innerWidth ? right : anchor.x - CURSOR_GAP_PX - width
    setPosition({
      x: Math.max(EDGE_PX, Math.min(x, window.innerWidth - width - EDGE_PX)),
      y: Math.max(EDGE_PX, Math.min(anchor.y, window.innerHeight - height - EDGE_PX)),
    })
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [anchor])

  // Escape cancels when the chooser is the top layer; any pointer
  // press outside cancels regardless.
  useEscapeLayer(true, close)
  // Closing puts focus back where it was, e.g. on the Marked points list's
  // Set point; from the right-click menu that item is gone.
  useReturnFocus(ref)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const inside = e.target instanceof Node && ref.current?.contains(e.target)
      if (!inside) close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [close])

  // Arrow keys move between items; Home and End jump.
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    )
    const current = items.findIndex((el) => el === document.activeElement)
    let next: number | null = null
    if (e.key === 'ArrowDown') next = (current + 1) % items.length
    else if (e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next === null) return
    e.preventDefault()
    items[next]?.focus()
  }

  const items: { label: string; action: () => void }[] = [
    { label: 'Start here', action: () => setDeparture(coordinate) },
    { label: 'End here', action: () => setDestination(coordinate) },
    { label: 'Add as a stop', action: () => addStop(coordinate) },
  ]

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Set point"
      aria-describedby="set-point-coordinate"
      onKeyDown={onMenuKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: position.x, top: position.y }}
      // z-30, like the right-click menu it replaces: above the icon panel
      // (z-20 with a sub-panel open) and the open time menu (z-10).
      className="fixed z-30 w-48 rounded-panel border border-line/60 bg-surface/70 p-1 shadow-panel backdrop-blur-glass"
    >
      <p id="set-point-coordinate" className="px-3 pb-1 pt-1 text-micro tabular-nums text-ink-subtle">
        {formatMarsCoordinate(coordinate)}
      </p>
      {items.map(({ label, action }) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          onClick={() => {
            action()
            close()
          }}
          className="block w-full rounded-control px-3 py-2 text-left text-body text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink focus-visible:bg-surface-raised focus-visible:text-ink"
        >
          {label}
        </button>
      ))}
    </div>
  )
}
