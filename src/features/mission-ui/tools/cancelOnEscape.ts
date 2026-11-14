/**
 * The description form's key handler. Escape cancels the edit only:
 * `preventDefault` marks the press handled, so the shared Escape rule
 * leaves the tool or menu around it open. On the form, not the field, so a
 * press on Save or Cancel cancels too.
 */
export const cancelOnEscape =
  (onCancel: () => void) => (e: Pick<KeyboardEvent, 'key' | 'preventDefault'>) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    onCancel()
  }
