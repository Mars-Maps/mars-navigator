import { useEffect, useLayoutEffect, useRef } from 'react'
import { createEscapeLayers } from './escapeLayers'

/** The app's one stack, and its one `window` listener while it is not empty. */
const layers = createEscapeLayers()
const onKeyDown = (e: KeyboardEvent) => {
  layers.handle(e)
}

/**
 * While `active`, Escape calls `onEscape`, but only when this is the most
 * recently activated layer. The layer keeps its place when
 * `onEscape` changes; it moves to the top only when it activates again.
 */
export function useEscapeLayer(active: boolean, onEscape: () => void) {
  const latest = useRef(onEscape)
  useLayoutEffect(() => {
    latest.current = onEscape
  })

  useEffect(() => {
    if (!active) return
    if (layers.size === 0) window.addEventListener('keydown', onKeyDown)
    const remove = layers.push(() => latest.current())
    return () => {
      remove()
      if (layers.size === 0) window.removeEventListener('keydown', onKeyDown)
    }
  }, [active])
}
