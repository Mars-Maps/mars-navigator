/**
 * Which globe pin a left click landed on, in screen pixels. A pin is
 * drawn as a 56 px sprite centred on its tip (mapPin.ts) with its round head
 * about 16 px straight above the tip once its pop-in has settled, so a click
 * counts when it is within PIN_HIT_PX of the line from the tip to the head's
 * centre. Pure, so it is tested without a renderer.
 */

/** From the tip to the head's centre, CSS px: 36 of the sprite's 128 texture px, at 56 px. */
export const PIN_HEAD_UP_PX = 16
/** How near the line from tip to head a click must be, CSS px: about the head's radius plus a margin. */
export const PIN_HIT_PX = 9

/**
 * The index of the pin whose tip-to-head line is nearest the click, within
 * PIN_HIT_PX, or -1. `tips` are the pins' tips on screen, null for a pin
 * not drawn (over the horizon or behind the camera). Ties go to the later
 * pin, which is drawn over the earlier.
 */
export function pinAtClick(click: { x: number; y: number }, tips: readonly ({ x: number; y: number } | null)[]): number {
  let best = -1
  let bestPx = PIN_HIT_PX
  tips.forEach((tip, i) => {
    if (!tip) return
    // The nearest point of the vertical segment from the tip up to the head.
    const y = Math.min(tip.y, Math.max(tip.y - PIN_HEAD_UP_PX, click.y))
    const px = Math.hypot(click.x - tip.x, click.y - y)
    if (px <= bestPx) {
      best = i
      bestPx = px
    }
  })
  return best
}
