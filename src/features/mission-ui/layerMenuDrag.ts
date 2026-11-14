/**
 * Moving the layer menu. The menu keeps its place beside the icon
 * panel and is moved by an offset from there, a CSS translate: the slot is
 * itself transformed (`-translate-y-1/2`), so `position: fixed` inside it
 * would not be fixed to the screen. Pure, so the rules are tested here.
 */

export interface Offset {
  dx: number
  dy: number
}

/** Where the menu sits with no offset, and its size, in screen pixels. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export const NO_OFFSET: Offset = { dx: 0, dy: 0 }

/** One arrow-key press moves the menu this far. */
export const KEY_STEP_PX = 16

/**
 * The offset moved as far as it may go towards `wanted` while the whole
 * menu stays on screen. A menu taller or wider than the screen keeps its
 * top-left corner on it, so its title bar is never out of reach.
 */
export function clampOffset(wanted: Offset, base: Box, viewport: { width: number; height: number }): Offset {
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))
  return {
    dx: clamp(wanted.dx, -base.left, viewport.width - base.left - base.width),
    dy: clamp(wanted.dy, -base.top, viewport.height - base.top - base.height),
  }
}

/**
 * The offset an arrow key asks for, or null for any other key. Home puts
 * the menu back, the keyboard's double-click.
 */
export function keyOffset(key: string, offset: Offset): Offset | null {
  switch (key) {
    case 'ArrowLeft':
      return { dx: offset.dx - KEY_STEP_PX, dy: offset.dy }
    case 'ArrowRight':
      return { dx: offset.dx + KEY_STEP_PX, dy: offset.dy }
    case 'ArrowUp':
      return { dx: offset.dx, dy: offset.dy - KEY_STEP_PX }
    case 'ArrowDown':
      return { dx: offset.dx, dy: offset.dy + KEY_STEP_PX }
    case 'Home':
      return NO_OFFSET
    default:
      return null
  }
}

/**
 * The offset that keeps a moved menu where it is on screen after its
 * default place moved from `before` to `base` (the time menu opening moves
 * it). A menu never moved, or with no earlier place, follows its
 * default place. Not clamped: the caller clamps.
 */
export function keepPlace(offset: Offset, before: Box | null, base: Box): Offset {
  if (!before || (offset.dx === 0 && offset.dy === 0)) return offset
  return { dx: offset.dx + before.left - base.left, dy: offset.dy + before.top - base.top }
}

/** The menu's untranslated box, from where it is drawn now and its current offset. */
export function baseBox(drawn: Box, offset: Offset): Box {
  return { ...drawn, left: drawn.left - offset.dx, top: drawn.top - offset.dy }
}
