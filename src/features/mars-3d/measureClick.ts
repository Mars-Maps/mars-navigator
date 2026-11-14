import type { MissionState } from '../../state'

/**
 * Whether a left click on the globe sets a Measure point. Only a
 * plain single click does:
 *
 * - a drag turns the camera, so the pointer must barely move between press
 *   and release (R3F reports the travel as `delta`, px);
 * - a double-click sets one point: its first click counts, its second is
 *   ignored, and while measuring it is not the camera's zoom either;
 * - a press that closed a menu (the right-click menu, or the Set point
 *   chooser) was a dismissal, not a pick.
 */
export const MEASURE_CLICK_MAX_PX = 4

/**
 * Whether a menu that closes on any outside press was open when a press
 * began: the right-click menu, or the Set point chooser. Read
 * on the press, since by the click the menu has closed itself.
 */
export function menuOpenAtPress({
  contextMenu,
  setPointChooser,
}: Pick<MissionState, 'contextMenu' | 'setPointChooser'>): boolean {
  return contextMenu !== null || setPointChooser !== null
}

export function isMeasureClick({
  deltaPx,
  clickCount,
  closedMenu,
}: {
  deltaPx: number
  /** The DOM's `detail`: 1 for a single click, 2 for a double-click's second. */
  clickCount: number
  /** A menu was open when this click's press came (`menuOpenAtPress`). */
  closedMenu: boolean
}): boolean {
  return Number.isFinite(deltaPx) && deltaPx <= MEASURE_CLICK_MAX_PX && clickCount <= 1 && !closedMenu
}
