/**
 * When a search-bar point commits. A point is a group: its X and Y
 * fields and, for the new-stop row, its × (cancel) button. It commits on
 * Enter or when focus leaves the whole group, never while focus moves
 * inside it.
 */
export type RowEvent =
  /** Enter in either field. */
  | { kind: 'enter' }
  /** The new stop's × pressed, by pointer or keyboard. */
  | { kind: 'press-cancel' }
  /** Focus left a field or the ×: to the other field, to the ×, or out of the group. */
  | { kind: 'leave'; from: 'fields' | 'cancel'; to: 'fields' | 'cancel' | 'outside' }

export type RowAction = 'commit' | 'discard' | 'none'

/** A focus target as the row reads it: its `data-focus` key. */
export type FocusTarget = { dataset: { focus?: string } }

/**
 * The leave event for a blur inside a point's group: from the field or the
 * × that lost focus, to where focus went. Focus that left the page (no
 * target) or the group is `outside`; the × counts only when it is this
 * group's hold-focus control, so another row's × is outside too.
 */
export function leaveOf<T extends FocusTarget>(
  from: T | null,
  to: T | null,
  // NoInfer: T comes from the elements, not from a DOM group's contains(Node).
  group: { contains(el: NoInfer<T>): boolean } | null,
  holdFocusKey?: string,
): Extract<RowEvent, { kind: 'leave' }> {
  const place = (el: T | null) =>
    !el || !group?.contains(el)
      ? 'outside'
      : holdFocusKey !== undefined && el.dataset.focus === holdFocusKey
        ? 'cancel'
        : 'fields'
  return { kind: 'leave', from: place(from) === 'cancel' ? 'cancel' : 'fields', to: place(to) }
}

export function rowAction(event: RowEvent): RowAction {
  switch (event.kind) {
    case 'enter':
      return 'commit'
    case 'press-cancel':
      return 'discard'
    case 'leave':
      // Focus on the × waits, so the × can still cancel. Without the wait, a blur
      // to the × skipped the commit and nothing ran when focus moved on
      // from there, so Tab lost a new stop.
      return event.to === 'outside' ? 'commit' : 'none'
  }
}
