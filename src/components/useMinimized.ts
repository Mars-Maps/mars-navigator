import { useCallback, useId, useState } from 'react'

/**
 * A window's minimised state, local to the window: it opens expanded
 * each time it appears, in a new mode or for a new tool. `bodyId` names the
 * body that `PanelHeader`'s button hides. `initial` is for a server-rendered
 * test of the minimised bar; the app always opens windows expanded.
 */
export function useMinimized(initial = false) {
  const [minimized, setMinimized] = useState(initial)
  const toggle = useCallback(() => setMinimized((m) => !m), [])
  const bodyId = useId()
  return { minimized, toggle, bodyId }
}
