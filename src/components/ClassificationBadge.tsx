import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { DataClassification } from '../domain'

const COLOUR: Record<DataClassification, string> = {
  OFFICIAL: 'text-official',
  DERIVED: 'text-derived',
  SIMULATED: 'text-simulated',
  UNAVAILABLE: 'text-unavailable',
}

/** Distance between the mark and its tooltip, and from the tooltip to the viewport edge. */
const GAP_PX = 6
const MARGIN_PX = 8

/**
 * Marks where a value came from: a small translucent
 * "i" in the classification colour. The class name and `detail` — the
 * source, method or reason, or the note that used to sit beside the badge —
 * are always in the DOM for assistive tech, and shown to everyone in a
 * tooltip while the pointer is over the mark or it has keyboard focus. A
 * click does nothing. Colour is never the only signal: the text is there.
 *
 * `passive` is for a mark inside something the pointer can never reach,
 * like the readout that follows the cursor: no tooltip and no tab stop.
 */
export function ClassificationBadge({
  classification,
  detail,
  passive = false,
}: {
  classification: DataClassification
  /** What the tooltip says under the class name. Omit when the line beside the mark already says it. */
  detail?: string
  passive?: boolean
}) {
  return <Mark colour={COLOUR[classification]} heading={classification} detail={detail} passive={passive} />
}

/**
 * The same "i" for words that are help, not provenance: how to fill a
 * field, what a control does. Neutral in colour and with no class name, so
 * it never reads as a claim about where a value came from.
 */
export function InfoMark({ detail }: { detail: string }) {
  return <Mark colour="text-ink-muted" detail={detail} />
}

function Mark({
  colour,
  heading,
  detail,
  passive = false,
}: {
  colour: string
  /** The class name, for a provenance mark. */
  heading?: string
  detail?: string
  passive?: boolean
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const show = (e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) =>
    setAnchor(e.currentTarget.getBoundingClientRect())
  const hide = () => setAnchor(null)
  const handlers = passive
    ? {}
    : {
        tabIndex: 0,
        onPointerEnter: show,
        onPointerLeave: hide,
        // Focus from a click shows nothing extra; the pointer is already there.
        onFocus: (e: FocusEvent<HTMLElement>) => {
          if (e.currentTarget.matches(':focus-visible')) show(e)
        },
        onBlur: hide,
      }
  return (
    <span
      {...handlers}
      className={`inline-flex shrink-0 cursor-help rounded-control opacity-60 transition-opacity duration-(--duration-fast) hover:opacity-100 focus-visible:opacity-100 ${colour}`}
    >
      <InfoIcon />
      {heading && <span className="sr-only">{heading}</span>}
      {detail && <span className="sr-only">{detail}</span>}
      {anchor && (
        <Tooltip anchor={anchor} onDismiss={hide}>
          {heading && <span className={`text-micro font-medium uppercase ${colour}`}>{heading}</span>}
          {detail && <span className="wrap-anywhere text-caption text-ink-muted">{detail}</span>}
        </Tooltip>
      )}
    </span>
  )
}

/**
 * A circled "i" in CSS, not an SVG: panels test "no chart drawn" as "no
 * <svg>", and the mark must not look like one. Sized to sit in caption text.
 */
function InfoIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 items-center justify-center rounded-full border border-current text-micro font-semibold leading-none"
    >
      i
    </span>
  )
}

/**
 * Rendered into `document.body`, fixed, above the mark and centred on it,
 * flipped below when there is no room above, kept inside the viewport.
 * Portalled so a scrolling panel cannot clip it. Any scroll or resize
 * dismisses it, since the mark may have moved.
 */
function Tooltip({
  anchor,
  onDismiss,
  children,
}: {
  anchor: DOMRect
  onDismiss: () => void
  children: ReactNode
}) {
  const box = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    const maxLeft = window.innerWidth - MARGIN_PX - w
    const left = Math.max(MARGIN_PX, Math.min(anchor.left + anchor.width / 2 - w / 2, maxLeft))
    const above = anchor.top - GAP_PX - h
    const top = above >= MARGIN_PX ? above : anchor.bottom + GAP_PX
    setPos({ left, top })
  }, [anchor])

  useEffect(() => {
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    return () => {
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [onDismiss])

  return createPortal(
    <span
      ref={box}
      role="tooltip"
      // The sr-only text inside the mark is the accessible copy; this is the visible one.
      aria-hidden="true"
      // Off screen until measured, so the first paint is already in place.
      style={pos ? { left: pos.left, top: pos.top } : { left: -10000, top: -10000 }}
      // z-40: above the context menu (z-30), which can hold a classified coordinate.
      className="pointer-events-none fixed z-40 flex w-max max-w-64 flex-col gap-0.5 rounded-control border border-line/60 bg-surface/95 px-2 py-1 text-left shadow-panel backdrop-blur-glass"
    >
      {children}
    </span>,
    document.body,
  )
}
