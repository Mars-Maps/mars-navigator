/**
 * Where focus goes when a tool's panel closes. A panel closed from
 * inside, by a photo's Go to or by Escape, removes the focused element with
 * it, and the browser drops focus to the page; the dock puts it back on the
 * closed tool's button instead. A panel closed while focus was elsewhere
 * (its dock button pressed again, another tool chosen) leaves focus alone.
 *
 * Returns the id of the tool whose button takes focus, or null.
 */
export function focusAfterClose(was: string | null, now: string | null, focusWasInPanel: boolean): string | null {
  if (was === null || now !== null || !focusWasInPanel) return null
  return was
}
