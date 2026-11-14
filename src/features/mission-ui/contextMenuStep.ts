/**
 * The right-click menu's steps and the ARIA roles each one takes.
 * A `menu` may own only menu items, so the menu is a menu only while it
 * shows just its items. Editing the coordinate or describing a point is a
 * dialog named for the step, so a screen reader passes typing through to
 * the field and says what the step is.
 */
export type MenuStep = 'menu' | 'edit' | 'describe'

export interface StepRoles {
  /** The popup itself. */
  container: 'menu' | 'dialog'
  /** Its accessible name. */
  label: string
  /** Whether the coordinate line describes it; while editing, the line is the field. */
  describedByCoordinate: boolean
  /**
   * The wrapper round the items: transparent inside the menu, its own menu
   * inside the edit dialog, where the items stay below the field.
   */
  items: 'none' | 'menu'
}

export function stepOf(editing: boolean, describing: boolean): MenuStep {
  return describing ? 'describe' : editing ? 'edit' : 'menu'
}

export function stepRoles(step: MenuStep): StepRoles {
  switch (step) {
    case 'menu':
      return { container: 'menu', label: 'Surface actions', describedByCoordinate: true, items: 'none' }
    case 'edit':
      return { container: 'dialog', label: 'Edit coordinates', describedByCoordinate: false, items: 'menu' }
    case 'describe':
      return { container: 'dialog', label: 'Mark point', describedByCoordinate: true, items: 'none' }
  }
}

/**
 * Where the menu's first focus goes: the first action item that does
 * something, so Set point rather than Edit, which sits above it beside the
 * coordinate. An item that is off (`aria-disabled`) is skipped here
 * but stays in the arrow-key order, so its reason can still be reached.
 */
export const FIRST_ITEM = '[role="menuitem"][data-item]:not(:disabled):not([aria-disabled="true"])'

/** The items the arrow keys move between: every one but the disabled, so off items and the colour swatches too. */
export const ARROW_ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)'

/**
 * The item index an arrow key, Home or End moves to, or null when the key
 * is not one of them or there are no items (the description step).
 */
export function nextItemIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null
  if (key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowUp') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/**
 * What the coordinate table says of the menu's coordinate. Only a point
 * right-clicked on the surface is a pick: a marked point may have been typed
 * and no record says, so it never claims the pick's DERIVED mark.
 */
export function coordinateSource(isOpeningPoint: boolean, atMark: boolean): 'pick' | 'typed' {
  return isOpeningPoint && !atMark ? 'pick' : 'typed'
}
