import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import {
  avoid,
  clampPlace,
  defaultPlace,
  keyPlace,
  parsePlace,
  PLOT_SIZES,
  plotSize,
  sameAway,
  type Away,
  type Place,
  type PlotSizeId,
  type Rect,
} from './plotPlacement'

const STORAGE_KEY = 'mars-navigator.terrain-plot.place'
/** The box's height beyond the plot itself (handle, notes), until it is measured. */
const CHROME_GUESS_PX = 64

/**
 * The place the user gave the box, kept for the session here (the box
 * unmounts with the tool) and, where the browser allows, across reloads in
 * localStorage. Storage is a convenience: every access may throw (private
 * windows, blocked site data) and the app works the same without it.
 */
let remembered: Place | null | undefined

function recall(): Place | null {
  if (remembered === undefined) {
    try {
      remembered = parsePlace(window.localStorage.getItem(STORAGE_KEY))
    } catch {
      remembered = null
    }
  }
  return remembered
}

function remember(place: Place | null) {
  remembered = place
  try {
    if (place === null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(place))
  } catch {
    // Not stored: the place still holds for this session.
  }
}

const viewportNow = () => ({ width: window.innerWidth, height: window.innerHeight })

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}
const drawn = (r: Rect) => r.right > r.left && r.bottom > r.top

/**
 * What is on screen around the box, measured now. Blockers are what opened
 * on a click: every sub-panel an expanded toggle of the icon panel controls
 * (the layer menu, the compass dial), and, while the time menu is open, the
 * menu and the icon column it pushes aside. The others are every other
 * panel: the layout's slots (`data-slot`) and what asks to be kept clear
 * (`data-keep-clear`, the walker widget).
 */
function obstacles(): { blockers: Rect[]; others: Rect[] } {
  const blockers: Rect[] = []
  const others: Rect[] = []
  const opened = new Set<Element>()
  for (const toggle of document.querySelectorAll('[data-slot="iconPanel"] [aria-expanded="true"][aria-controls]')) {
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    if (panel) opened.add(panel)
  }
  const timeOpen = document.querySelector('[data-slot="time"] [aria-expanded="true"]') !== null
  for (const el of document.querySelectorAll<HTMLElement>('[data-slot], [data-keep-clear]')) {
    const slot = el.dataset.slot
    if (slot === 'scene' || slot === 'terrainPlot' || opened.has(el)) continue
    const rect = rectOf(el)
    if (!drawn(rect)) continue
    if (timeOpen && (slot === 'time' || slot === 'iconPanel')) blockers.push(rect)
    else others.push(rect)
  }
  for (const panel of opened) {
    const rect = rectOf(panel)
    if (drawn(rect)) blockers.push(rect)
  }
  return { blockers, others }
}

/** What the handle needs to move the box. */
export interface PlotMove {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerMove: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void
  onDoubleClick: () => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

/**
 * The Terrain Profile 3D plot's box: where it is drawn, at what size, and
 * the handlers that move it.
 *
 * - The user's place wins: drag the handle, or the arrow keys on it; Home
 *   or a double-click goes back to the default place. Kept on screen on
 *   every move and when the window resizes (the wanted place is kept, so a
 *   window made larger again gives it back).
 * - While a menu is open over that place (`obstacles`), the box is drawn
 *   away from it (`avoid`) and returns when the menu closes: the user's
 *   place itself is never changed by a menu. A box the user moves while a
 *   menu is open stays where they put it, even under the menu, until
 *   another menu opens or they all close.
 * - Re-evaluated when an aria-expanded toggle changes (the menus' open
 *   state lives in their toggles; the time menu's is nowhere else), when
 *   the window resizes and when the box's own size changes.
 */
export function useMovablePlot(box: RefObject<HTMLElement | null>) {
  const [viewport, setViewport] = useState(viewportNow)
  const [user, setUser] = useState<Place | null>(recall)
  const [away, setAway] = useState<Away | null>(null)
  const [chrome, setChrome] = useState(CHROME_GUESS_PX)
  const [dragging, setDragging] = useState(false)

  const fullId = plotSize(viewport)
  const sizeId: PlotSizeId = away !== null && away.size > 0 ? 'small' : fullId
  const dims = PLOT_SIZES[sizeId]
  const full = { width: PLOT_SIZES[fullId].width, height: PLOT_SIZES[fullId].plotHeight + chrome }
  const home = clampPlace(user ?? defaultPlace(viewport, full.width), full, viewport)
  const place = away === null ? home : clampPlace(away.place, { width: dims.width, height: dims.plotHeight + chrome }, viewport)

  // What the measuring below reads; written after each render, never during one.
  const latest = useRef({ user, sizeId, place })
  useLayoutEffect(() => {
    latest.current = { user, sizeId, place }
  })
  const chromeNow = useRef(CHROME_GUESS_PX)
  // The open menus as last measured, and the same at the user's last move
  // while any were open: the box is left where they put it until that set
  // changes (another menu opens, or all close).
  const menus = useRef('')
  const override = useRef<string | null>(null)
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null)

  const reflow = useRef(() => {})

  useLayoutEffect(() => {
    const run = () => {
      const el = box.current
      if (!el) return
      const vp = viewportNow()
      const { blockers, others } = obstacles()
      menus.current = blockers.map((b) => `${b.left},${b.top},${b.right},${b.bottom}`).join(';')
      // Measured only at the box's own size: the small one wraps its notes
      // differently, and one figure for both keeps the choice below stable.
      if (latest.current.sizeId !== 'small') {
        chromeNow.current = Math.max(0, el.offsetHeight - PLOT_SIZES[latest.current.sizeId].plotHeight)
        setChrome(chromeNow.current)
      }
      if (blockers.length === 0) {
        override.current = null
        setAway(null)
        return
      }
      if (override.current === menus.current) return
      override.current = null
      const own = PLOT_SIZES[plotSize(vp)]
      const sizes = [own, PLOT_SIZES.small].map((s) => ({ width: s.width, height: s.plotHeight + chromeNow.current }))
      const from = clampPlace(latest.current.user ?? defaultPlace(vp, own.width), sizes[0], vp)
      const next = avoid(from, sizes, vp, blockers, others)
      setAway((prev) => (sameAway(prev, next) ? prev : next))
    }
    reflow.current = run
    const onResize = () => setViewport(viewportNow())
    window.addEventListener('resize', onResize)
    const toggles = new MutationObserver(run)
    toggles.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    const own = new ResizeObserver(run)
    if (box.current) own.observe(box.current)
    return () => {
      window.removeEventListener('resize', onResize)
      toggles.disconnect()
      own.disconnect()
      drag.current = null
    }
  }, [box])

  // After every change of the user's place, the size or the window, and
  // before paint, so the box never flashes under an open menu.
  useLayoutEffect(() => {
    reflow.current()
  }, [user, sizeId, viewport])

  const moveTo = (to: Place) => {
    const el = box.current
    if (!el) return
    const next = clampPlace(to, { width: el.offsetWidth, height: el.offsetHeight }, viewportNow())
    override.current = menus.current === '' ? null : menus.current
    remembered = next
    setAway(null)
    setUser(next)
  }

  const goHome = () => {
    override.current = null
    remember(null)
    setUser(null)
  }

  const end = (e: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return
    drag.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (remembered !== undefined) remember(remembered)
  }

  const move: PlotMove = {
    onPointerDown: (e) => {
      if (e.button !== 0) return
      // From the place it is drawn at, not its rectangle: that lags while a move is animated.
      const { place } = latest.current
      drag.current = { pointerId: e.pointerId, dx: e.clientX - place.x, dy: e.clientY - place.y }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e) => {
      const d = drag.current
      if (d?.pointerId !== e.pointerId) return
      // No button held: a release was missed. End rather than drag.
      if (e.buttons === 0) return end(e)
      setDragging(true)
      moveTo({ x: e.clientX - d.dx, y: e.clientY - d.dy })
    },
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick: goHome,
    onKeyDown: (e) => {
      const to = keyPlace(e.key, latest.current.place, e.shiftKey)
      if (to === null) return
      e.preventDefault()
      if (to === 'home') return goHome()
      moveTo(to)
      if (remembered !== undefined) remember(remembered)
    },
  }

  return { place, width: dims.width, plotHeight: dims.plotHeight, compact: sizeId !== 'regular', dragging, move }
}
