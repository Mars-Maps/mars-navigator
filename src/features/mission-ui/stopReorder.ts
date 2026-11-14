import { useState, type DragEvent } from 'react'

/**
 * Drag-to-reorder for the search bar's stops. The index rules are
 * pure, so they are tested without a browser; `useStopDrag` wires them to
 * native drag and drop.
 *
 * An insertion point is a gap between rows: 0 is above the first stop,
 * `count` below the last. Hovering the top half of row i points at gap i,
 * the bottom half at gap i + 1.
 */
export function insertionPoint(row: number, inTopHalf: boolean): number {
  return inTopHalf ? row : row + 1
}

/**
 * The index the dragged stop ends up at when dropped into gap `insertAt`,
 * for the store's `moveStop(from, to)`, or null when it would not move:
 * the gaps directly above and below the dragged row both leave it in place.
 */
export function dropTarget(from: number, insertAt: number, count: number): number | null {
  if (from < 0 || from >= count || insertAt < 0 || insertAt > count) return null
  // Removing the row first shifts every gap below it up by one.
  const to = insertAt > from ? insertAt - 1 : insertAt
  return to === from ? null : to
}

/** The drag payload's type, private to this list. */
const STOP_DRAG_TYPE = 'application/x-mars-stop-index'

/**
 * Drag state for `count` stop rows. A drop calls `move` once, as the ↑ ↓
 * buttons do. `lineAt` is the gap to mark, only where a drop would move the
 * stop. Spread `rowProps(i)` on each row and `handleProps(i)` on its grip.
 */
export function useStopDrag(count: number, move: (from: number, to: number) => void) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const end = () => {
    setDragFrom(null)
    setDropAt(null)
  }
  const target = dragFrom !== null && dropAt !== null ? dropTarget(dragFrom, dropAt, count) : null

  return {
    dragFrom,
    lineAt: target === null ? null : dropAt,
    rowProps: (i: number) => ({
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (dragFrom === null) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const rect = e.currentTarget.getBoundingClientRect()
        const at = insertionPoint(i, e.clientY < rect.top + rect.height / 2)
        if (at !== dropAt) setDropAt(at)
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        if (dragFrom === null) return
        e.preventDefault()
        if (target !== null) move(dragFrom, target)
        end()
      },
    }),
    handleProps: (i: number) => ({
      onDragStart: (e: DragEvent<HTMLElement>) => {
        e.dataTransfer.effectAllowed = 'move'
        // A private type: dropped on a text field by mistake, a plain-text
        // payload would be typed into it.
        e.dataTransfer.setData(STOP_DRAG_TYPE, String(i))
        const row = e.currentTarget.closest('li')
        if (row) e.dataTransfer.setDragImage(row, 12, 24)
        setDragFrom(i)
      },
      onDragEnd: end,
    }),
  }
}
