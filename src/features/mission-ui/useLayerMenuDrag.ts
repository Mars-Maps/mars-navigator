import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { baseBox, clampOffset, keepPlace, keyOffset, NO_OFFSET, type Box, type Offset } from './layerMenuDrag'

/** What the layer menu's title bar and grip need to move it. */
export interface LayerMenuMove {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerMove: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void
  onDoubleClick: (e: MouseEvent<HTMLElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })

/** The menu's box with no offset, measured from where it is drawn now. */
function measure(el: HTMLElement | null, offset: Offset): Box | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return baseBox({ left: r.left, top: r.top, width: r.width, height: r.height }, offset)
}

const same = (a: Offset, b: Offset) => a.dx === b.dx && a.dy === b.dy

/**
 * The layer menu's offset from its place beside the icon panel, and
 * the handlers that change it: drag the title bar, arrow keys on the grip,
 * Home or a double-click to put it back. Use it only while the menu is
 * shown: the offset is forgotten when the caller unmounts, so the menu
 * reopens at its default place.
 *
 * Once moved, the menu stays where the user put it: its default place
 * moves when the time menu opens (the slot follows it through CSS),
 * so the offset takes up that move. Clamped to the screen on every move,
 * when the menu opens, when the window resizes and when an aria-expanded
 * toggle (the time menu's) changes the layout. `box` is the element the
 * offset translates.
 */
export function useLayerMenuDrag(box: RefObject<HTMLElement | null>) {
  const [offset, setOffset] = useState<Offset>(NO_OFFSET)
  // The offset last asked for, and the one the menu is drawn with. Measuring
  // happens here, never inside a state updater, which React may call twice.
  const wanted = useRef<Offset>(NO_OFFSET)
  const drawn = useRef<Offset>(NO_OFFSET)
  const drag = useRef<{ pointerId: number; x: number; y: number; start: Offset; base: Box } | null>(null)
  // The default place the offset was last measured from.
  const lastBase = useRef<Box | null>(null)

  useLayoutEffect(() => {
    drawn.current = offset
  }, [offset])

  const apply = useCallback((next: Offset) => {
    if (same(next, wanted.current)) return
    wanted.current = next
    setOffset(next)
  }, [])

  // Before paint on opening, so a kept place does not flash at the old one.
  useLayoutEffect(() => {
    const reclamp = () => {
      const base = measure(box.current, drawn.current)
      if (!base) return
      const before = lastBase.current
      lastBase.current = base
      apply(clampOffset(keepPlace(wanted.current, before, base), base, viewport()))
    }
    reclamp()
    window.addEventListener('resize', reclamp)
    // The time menu moves the icon panel through CSS alone, so no render
    // here follows it; its toggle's aria-expanded is what changes.
    const toggles = new MutationObserver(reclamp)
    toggles.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    return () => {
      window.removeEventListener('resize', reclamp)
      toggles.disconnect()
      // Closed mid-drag (Escape), the release never arrives: drop the drag.
      drag.current = null
    }
  }, [apply, box])

  const moveTo = (to: Offset, base: Box) => {
    lastBase.current = base
    apply(clampOffset(to, base, viewport()))
  }

  const end = (e: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const move: LayerMenuMove = {
    onPointerDown: (e) => {
      if (e.button !== 0 || onBarButton(e.target)) return
      const base = measure(box.current, drawn.current)
      if (!base) return
      drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, start: wanted.current, base }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e) => {
      const d = drag.current
      if (d?.pointerId !== e.pointerId) return
      // No button held: a release was missed. End rather than drag.
      if (e.buttons === 0) {
        drag.current = null
        return
      }
      moveTo({ dx: d.start.dx + e.clientX - d.x, dy: d.start.dy + e.clientY - d.y }, d.base)
    },
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick: (e) => {
      if (!onBarButton(e.target)) apply(NO_OFFSET)
    },
    onKeyDown: (e) => {
      const to = keyOffset(e.key, wanted.current)
      if (!to) return
      e.preventDefault()
      const base = measure(box.current, drawn.current)
      if (base) moveTo(to, base)
    },
  }

  return { offset, move }
}

/** The bar's own buttons (minimise) keep their clicks; the grip is the bar. */
function onBarButton(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  return Boolean(el?.closest('button') && !el.closest('[data-drag-grip]'))
}
