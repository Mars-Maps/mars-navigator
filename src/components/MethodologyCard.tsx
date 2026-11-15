import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** Distance between the button and its card, and from the card to the viewport edge. */
const GAP_PX = 6
const MARGIN_PX = 8

/**
 * The open card: portalled to `document.body` and fixed, so a scrolling
 * panel cannot clip it. Under the button, or above it where there is no
 * room below, kept inside the viewport; it scrolls inside itself when the
 * explanation is long. It takes the focus when it opens and gives it back
 * to the button when it closes.
 */
export function MethodologyCard({
  id,
  title,
  anchor,
  trigger,
  onClose,
  children,
}: {
  id: string
  title: string
  anchor: DOMRect
  trigger: RefObject<HTMLButtonElement | null>
  onClose: (refocus: boolean) => void
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    const left = Math.max(MARGIN_PX, Math.min(anchor.left, window.innerWidth - MARGIN_PX - w))
    const below = anchor.bottom + GAP_PX
    const above = anchor.top - GAP_PX - h
    const top = below + h <= window.innerHeight - MARGIN_PX ? below : Math.max(MARGIN_PX, above)
    setPos({ left, top })
    el.focus({ preventScroll: true })
  }, [anchor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // This Escape closes the card only, not the tool or the pick under it.
      e.stopPropagation()
      onClose(true)
    }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (box.current?.contains(target) || trigger.current?.contains(target)) return
      onClose(false)
    }
    const onResize = () => onClose(false)
    // Focus that leaves both the card and its button (Tab past the end) closes the card,
    // so it never stays open behind another control or beside a second card.
    const onFocus = (e: FocusEvent) => {
      const target = e.target as Node
      if (box.current?.contains(target) || trigger.current?.contains(target)) return
      onClose(false)
    }
    document.addEventListener('focusin', onFocus)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('resize', onResize)
    }
  }, [onClose, trigger])

  return createPortal(
    <div
      ref={box}
      id={id}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      // A portal's events still bubble to its React parents: keys pressed in the card
      // must not page or steer the panel it was opened from.
      onKeyDown={(e) => e.stopPropagation()}
      // Off screen until measured, so the first paint is already in place.
      style={pos ? { left: pos.left, top: pos.top } : { left: -10000, top: -10000 }}
      // z-40: above the context menu (z-30), as the provenance tooltip is.
      className="fixed z-40 flex max-h-[min(60vh,26rem)] w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 overflow-y-auto rounded-control border border-line/60 bg-surface/95 px-3 py-2 text-left shadow-panel backdrop-blur-glass"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-caption font-semibold text-ink">{title}</span>
        <button
          type="button"
          aria-label="Close"
          onClick={() => onClose(true)}
          className="flex size-5 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink"
        >
          ×
        </button>
      </span>
      {children}
    </div>,
    document.body,
  )
}
