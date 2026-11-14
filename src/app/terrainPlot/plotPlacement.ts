/**
 * Where the Terrain Profile 3D plot's box sits. The box is the user's to
 * move; these are the rules around that, pure so they are tested: its size
 * for a screen, the default place (covering no other panel), keeping it on
 * screen, the arrow keys, and getting out of the way of a menu that opens
 * over it. Pixels throughout, from the screen's top-left corner.
 */

export interface Place {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export type PlotSizeId = 'regular' | 'compact' | 'small'

/**
 * The box's width and the plot's own height inside it. Regular on a tall
 * screen; compact below 900 px, where the right edge has only the band
 * between the time menu and the walker widget; small only while a menu is
 * open and nothing larger fits clear of the other panels. Wider than 4:3:
 * the plot's scale follows its height, and the height labels beside the
 * box, which do not scale, need the width.
 */
export const PLOT_SIZES: Record<PlotSizeId, { width: number; plotHeight: number }> = {
  regular: { width: 352, plotHeight: 240 },
  compact: { width: 304, plotHeight: 208 },
  small: { width: 208, plotHeight: 144 },
}

const REGULAR_FROM_HEIGHT_PX = 900

export function plotSize(viewport: Size): Exclude<PlotSizeId, 'small'> {
  return viewport.height >= REGULAR_FROM_HEIGHT_PX ? 'regular' : 'compact'
}

/**
 * The default place, at 16 px to the rem: its right edge 72 px from the
 * screen's (the icon column is right-4 w-12, so 64 px, plus a gap), its top
 * at 110 px (the closed time menu ends at 102 px). So it sits under the time
 * menu, left of the icon column and above the walker widget and the compass
 * dial, far from the left column and the tool dock.
 */
export const DEFAULT_RIGHT_PX = 72
export const DEFAULT_TOP_PX = 110

export function defaultPlace(viewport: Size, width: number): Place {
  return { x: viewport.width - DEFAULT_RIGHT_PX - width, y: DEFAULT_TOP_PX }
}

/**
 * The place moved as little as it takes for the whole box to be on screen,
 * `margin` from every edge. A box larger than the screen keeps its top-left
 * corner on it, so the handle is never out of reach.
 */
export function clampPlace(place: Place, size: Size, viewport: Size, margin = 0): Place {
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))
  return {
    x: clamp(place.x, margin, viewport.width - size.width - margin),
    y: clamp(place.y, margin, viewport.height - size.height - margin),
  }
}

/** One arrow-key press moves the box this far; with Shift, four times as far. */
export const KEY_STEP_PX = 16

/** Where an arrow key moves the box, 'home' for the Home key (back to the default place), null for any other key. */
export function keyPlace(key: string, place: Place, far = false): Place | 'home' | null {
  const step = far ? KEY_STEP_PX * 4 : KEY_STEP_PX
  switch (key) {
    case 'ArrowLeft':
      return { x: place.x - step, y: place.y }
    case 'ArrowRight':
      return { x: place.x + step, y: place.y }
    case 'ArrowUp':
      return { x: place.x, y: place.y - step }
    case 'ArrowDown':
      return { x: place.x, y: place.y + step }
    case 'Home':
      return 'home'
    default:
      return null
  }
}

/** The area two rectangles share once `b` is grown by `gap` on every side; 0 when they are at least `gap` apart. */
export function overlapArea(a: Rect, b: Rect, gap = 0): number {
  const w = Math.min(a.right, b.right + gap) - Math.max(a.left, b.left - gap)
  const h = Math.min(a.bottom, b.bottom + gap) - Math.max(a.top, b.top - gap)
  return w > 0 && h > 0 ? w * h : 0
}

const rectAt = (place: Place, size: Size): Rect => ({
  left: place.x,
  top: place.y,
  right: place.x + size.width,
  bottom: place.y + size.height,
})

const covered = (rect: Rect, by: readonly Rect[], gap: number) => by.reduce((sum, o) => sum + overlapArea(rect, o, gap), 0)

/** The gap kept to a menu the box moved away from, and to the screen's edge while away. */
export const AVOID_GAP_PX = 8

export interface Away {
  place: Place
  /** Index into the sizes given: 0 is the box's own size. */
  size: number
}

/**
 * Where the box goes while menus are open over it, or null when its own
 * place (`home`) is clear of them and it stays.
 *
 * `blockers` are the open menus: the box must not be under them. `others`
 * are the panels that were there all along: better not covered. The places
 * tried are the home place and every place beside, above or below one of
 * those rectangles, kept on screen. The choice, in this order: least area
 * under a blocker, least area over another panel, then nearest to home. A
 * later (smaller) size is taken only when it covers strictly less than the
 * sizes before it, so the box shrinks only when moving alone is not enough.
 */
export function avoid(
  home: Place,
  sizes: readonly Size[],
  viewport: Size,
  blockers: readonly Rect[],
  others: readonly Rect[],
  gap = AVOID_GAP_PX,
): Away | null {
  if (sizes.length === 0 || covered(rectAt(home, sizes[0]), blockers, gap) === 0) return null
  const all = [...blockers, ...others]
  let best: (Away & { blocked: number; other: number; distance: number }) | null = null
  for (const [index, size] of sizes.entries()) {
    if (best !== null && best.blocked === 0 && best.other === 0) break
    const xs = [home.x, ...all.flatMap((o) => [o.left - gap - size.width, o.right + gap])]
    const ys = [home.y, ...all.flatMap((o) => [o.top - gap - size.height, o.bottom + gap])]
    for (const x of xs) {
      for (const y of ys) {
        const place = clampPlace({ x, y }, size, viewport, gap)
        const rect = rectAt(place, size)
        const blocked = covered(rect, blockers, gap)
        const other = covered(rect, others, 0)
        const distance = Math.hypot(place.x - home.x, place.y - home.y)
        const less = best === null || blocked < best.blocked || (blocked === best.blocked && other < best.other)
        const nearer = best !== null && best.size === index && blocked === best.blocked && other === best.other && distance < best.distance
        if (less || nearer) best = { place, size: index, blocked, other, distance }
      }
    }
  }
  return best === null ? null : { place: best.place, size: best.size }
}

export const sameAway = (a: Away | null, b: Away | null) =>
  a === b || (a !== null && b !== null && a.size === b.size && a.place.x === b.place.x && a.place.y === b.place.y)

/** A place read back from storage: two finite numbers, or null for anything else. */
export function parsePlace(text: string | null): Place | null {
  if (text === null) return null
  try {
    const v: unknown = JSON.parse(text)
    if (typeof v !== 'object' || v === null) return null
    const { x, y } = v as { x?: unknown; y?: unknown }
    return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  } catch {
    return null
  }
}
