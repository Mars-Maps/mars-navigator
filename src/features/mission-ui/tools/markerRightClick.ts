/** Controls keep the browser's own right-click, so the description field can paste. */
const ROW_CONTROLS = 'button, input, textarea, select, a, label, form'

/**
 * Whether a right-click on a marker row unmarks it: not while the row is
 * being edited, and not on a control (Go to, Edit, Unmark, the description
 * field), so a right-click to paste or by mistake never deletes the point.
 */
export function rightClickUnmarks(
  target: { closest(selector: string): unknown } | null,
  editing: boolean,
): boolean {
  if (editing) return false
  return !target?.closest(ROW_CONTROLS)
}
