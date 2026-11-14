/**
 * One Escape rule. Everything Escape can close (the context menu, the
 * time menu, an icon sub-panel, the active tool) pushes a layer when it
 * opens and removes it when it closes. One press closes only the top layer,
 * the one opened most recently, so a sub-panel and the active tool no
 * longer close together.
 *
 * A press something else already handled (`defaultPrevented`, as the search
 * bar's fields do) is left alone. A press that closes a layer is marked
 * handled, so nothing further down reacts to it either.
 */
export type EscapeEvent = Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'preventDefault'>

export interface EscapeLayers {
  /** Puts `onEscape` on top. The returned function removes it wherever it is. */
  push(onEscape: () => void): () => void
  /** Closes the top layer for an unhandled Escape. True if one closed. */
  handle(e: EscapeEvent): boolean
  readonly size: number
}

export function createEscapeLayers(): EscapeLayers {
  // Entries are objects, not the callbacks, so the same callback pushed
  // twice is two layers and each remove takes out only its own.
  const stack: { onEscape: () => void }[] = []
  return {
    push(onEscape) {
      const entry = { onEscape }
      stack.push(entry)
      return () => {
        const i = stack.indexOf(entry)
        if (i !== -1) stack.splice(i, 1)
      }
    },
    handle(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return false
      const top = stack.at(-1)
      if (!top) return false
      e.preventDefault()
      top.onEscape()
      return true
    },
    get size() {
      return stack.length
    },
  }
}
