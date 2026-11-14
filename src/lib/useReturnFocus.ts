import { useLayoutEffect, useState, type RefObject } from 'react'

/** What a popup gives focus back to: an element that may since have left the page. */
export interface FocusReturnTarget {
  readonly isConnected: boolean
  focus(): void
}

/**
 * Where focus goes as a popup closes: back to what had it when the
 * popup opened, but only while focus is still in the popup, or has fallen to
 * the body as the popup's focused item was removed. A click that moved focus
 * to another control keeps it there, and an opener that has left the page
 * (the right-click menu's item, gone as the chooser opens) gets nothing.
 */
export function focusToReturn<T extends FocusReturnTarget>(
  opener: T | null,
  active: unknown,
  body: unknown,
  inPopup: (node: unknown) => boolean,
): T | null {
  if (opener === null || !opener.isConnected || opener === active) return null
  return active === null || active === body || inPopup(active) ? opener : null
}

/**
 * For a popup that takes focus when it opens: gives it back on unmount, by
 * `focusToReturn`'s rule. The opener is read while rendering, before the
 * popup's own layout effects move focus into it.
 */
export function useReturnFocus(popup: RefObject<HTMLElement | null>) {
  const [opener] = useState(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  useLayoutEffect(() => {
    const el = popup.current
    return () => {
      focusToReturn(opener, document.activeElement, document.body, (n) => n instanceof Node && !!el?.contains(n))?.focus()
    }
  }, [opener, popup])
}
