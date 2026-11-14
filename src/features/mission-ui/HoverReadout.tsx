import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import { formatMarsCoordinate } from '../../domain'
import { hoverDecimals, useMissionStore } from '../../state'

/** Offset from the cursor so the label never sits under it. */
const OFFSET_PX = 14

interface Pointer {
  x: number
  y: number
  /** False until the first pointer event; the label stays off screen. */
  known: boolean
}

/**
 * The coordinate under the cursor, to one decimal, two below 100 km. Reads the store's
 * `hoverCoordinate`, which the scene writes only when the value changes;
 * the label follows the cursor through one window listener that sets a
 * transform on the element, so cursor movement causes no React render.
 * The listener lives here, not in the label, so the last pointer position
 * is known when the label mounts: the write that mounts it can be the
 * trailing throttled one, after the cursor has already stopped.
 * Hidden off the surface and while the right-click menu is open, which has
 * its own copy of the coordinate. Deliberately not hidden by "Hide all
 * tools": like the context menu, it is a readout of the scene, not a tool,
 * and it takes no space.
 */
export function HoverReadout() {
  const coordinate = useMissionStore((s) => s.hoverCoordinate)
  const menuOpen = useMissionStore((s) => s.contextMenu !== null)
  // Two decimals below 100 km, one above (`hoverDecimals`).
  const decimals = useMissionStore((s) => hoverDecimals(s.camera?.altitudeKm ?? null))
  const pointer = useRef<Pointer>({ x: 0, y: 0, known: false })
  const label = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = e.clientX
      pointer.current.y = e.clientY
      pointer.current.known = true
      if (label.current) place(label.current, pointer.current)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const shown = coordinate !== null && !menuOpen
  return shown ? (
    <Label text={formatMarsCoordinate(coordinate, decimals)} labelRef={label} pointer={pointer} />
  ) : null
}

/** Flips to the left of the cursor near the right edge and above it near the bottom, so it stays on screen. */
function place(el: HTMLDivElement, p: Pointer) {
  if (!p.known) return
  const flipX = p.x + OFFSET_PX + el.offsetWidth > window.innerWidth
  const flipY = p.y + OFFSET_PX + el.offsetHeight > window.innerHeight
  const left = flipX ? p.x - OFFSET_PX - el.offsetWidth : p.x + OFFSET_PX
  const top = flipY ? p.y - OFFSET_PX - el.offsetHeight : p.y + OFFSET_PX
  el.style.transform = `translate(${left}px, ${top}px)`
}

function Label({
  text,
  labelRef,
  pointer,
}: {
  text: string
  labelRef: RefObject<HTMLDivElement | null>
  pointer: RefObject<Pointer>
}) {
  // Placed before paint on mount and whenever the text (and so the width)
  // changes, from the last known pointer position.
  useLayoutEffect(() => {
    if (labelRef.current) place(labelRef.current, pointer.current)
  }, [text, labelRef, pointer])

  return (
    <div
      ref={labelRef}
      role="status"
      aria-live="off"
      // Off screen until placed; `place` runs before the first paint.
      style={{ transform: 'translate(-1000px, -1000px)' }}
      className="pointer-events-none absolute left-0 top-0 flex items-center gap-1.5 rounded-control border border-line bg-surface/90 px-2 py-1 text-caption tabular-nums text-ink shadow-sm"
    >
      <span>{text}</span>
      {/* Passive: the label ignores the pointer, so no tooltip could open; the method stays for assistive tech. */}
      <ClassificationBadge
        classification="DERIVED"
        detail="Surface coordinate under the cursor, derived from the pick ray"
        passive
      />
    </div>
  )
}
