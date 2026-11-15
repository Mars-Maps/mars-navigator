import { Suspense, lazy, useId, useRef, useState, type ReactNode } from 'react'

// The card is asked for by a click, so its code is not in the first load.
const MethodologyCard = lazy(() => import('./MethodologyCard').then((m) => ({ default: m.MethodologyCard })))

/**
 * A small "Methodology" button that keeps a long explanation out of
 * a panel until someone asks for it: how a figure was obtained, what it
 * leaves out, where its limits come from. A click opens a card over the
 * page, so the panel under it never grows; Escape, a second click, a click
 * elsewhere or the card's × closes it.
 *
 * Closed, the words stay in the DOM in a `hidden` element: out of sight and
 * out of the accessibility tree, and still there for a test that renders
 * to markup. `children` are phrasing content (`MethodologyItem`s), so the
 * button can sit inside a paragraph.
 */
export function Methodology({
  title,
  children,
  label = 'Methodology',
}: {
  /** What the card explains, as its heading: "How the hazards were scanned". */
  title: string
  children: ReactNode
  /** The button's word. "Methodology" unless the card is not about a method. */
  label?: string
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  const open = anchor !== null
  const close = (refocus: boolean) => {
    setAnchor(null)
    if (refocus) button.current?.focus()
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        data-methodology=""
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={title}
        onClick={(e) => (open ? close(false) : setAnchor(e.currentTarget.getBoundingClientRect()))}
        className={`inline-flex shrink-0 items-center rounded-control border px-1.5 py-px align-middle text-micro font-medium uppercase whitespace-nowrap transition-colors duration-(--duration-fast) ${
          open
            ? 'border-accent/50 bg-accent/15 text-accent'
            : 'border-line text-ink-muted hover:bg-surface-raised hover:text-ink'
        }`}
      >
        {label}
      </button>
      {open ? (
        <Suspense fallback={null}>
          <MethodologyCard id={id} title={title} anchor={anchor} trigger={button} onClose={close}>
            {children}
          </MethodologyCard>
        </Suspense>
      ) : (
        <span hidden data-methodology-text="">
          {title}
          {children}
        </span>
      )}
    </>
  )
}

/** One part of an explanation: a short heading and its words. */
export function MethodologyItem({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <span className="flex flex-col gap-0.5">
      {heading && <span className="text-micro font-medium uppercase text-ink-subtle">{heading}</span>}
      <span className="wrap-anywhere text-caption text-ink-muted">{children}</span>
    </span>
  )
}

