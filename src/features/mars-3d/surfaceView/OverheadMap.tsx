import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { formatMarsCoordinate, type MarsCoordinate } from '../../../domain'
import { NO_DATA_CSS, markerHex, useMarkerColors, useMissionStore, useWalkPlan } from '../../../state'
import { menuOpenAtPress } from '../measureClick'
import { draftWaypoints, hasRouteLine } from '../routeWaypoints'
import type { SurfaceDetail } from '../surfaceDetail'
import { createMapTileStore } from './mapTileStore'
import {
  clampWindowSize,
  coordinateToScreen,
  followWalker,
  GLOBE_BOUNDS,
  openWindowSize,
  panBy,
  pickPrecision,
  placements,
  screenToCoordinate,
  TILE_PX,
  tilePlacements,
  tilesForMap,
  zoomAt,
  zoomLimits,
  type MapPicture,
  type MapSize,
  type MapView,
} from './overheadMapView'
import { MapCaption } from './MapCaption'
import { drawOverlay, drawTraverse, drawWalk, greatCircleTrack, mapPins, pinAt, walkOnMap } from './mapOverlay'
import { MAP_MENU_HEIGHT_PX, MAP_MENU_WIDTH_PX, OverheadMapMenu } from './OverheadMapMenu'
import { CLICK_SLOP_PX, CLOSEST_SPAN_KM, GRIP_STEP_PX, HEADER_AND_PADDING_PX, KM_PER_DEG } from './overheadMapSizes'
import { OPEN_SPAN_KM, SMALL_PX, SMALL_SPAN_KM, WALKER_REDRAW_MS } from './overheadMapSizes'
import { drawWalker } from './walkerMarker'

/**
 * The site from above, and the whole planet when expanded:
 * one north-up map in the active layer's own tiles, with the ground
 * patch's sharper picture laid over the place it shows. Small or expanded,
 * drag pans, the wheel zooms about the cursor, a click teleports straight
 * to the point under it, and a right-click shows the coordinate and asks
 * first. It follows the walker until dragged or zoomed, shifting only as
 * they near an edge so their dot is seen to move; Find me centres on
 * them and resumes.
 * The route draft's waypoints, the line joining them and the marked points
 * are drawn over it as on the globe; a click or right-click on a pin goes
 * to that point exactly.
 * Expanded, it opens at about 30% of the screen and resizes from its
 * top-right grip.
 *
 * Drawing is a 2D canvas, redrawn only when the view, the tiles or the
 * walker change, never per React render. The tiles come through the
 * shell's `SurfaceDetail` loader and a `TileStore`, which aborts what
 * leaves the view and closes every bitmap on eviction, layer change and
 * unmount; the whole-globe image is the zoomed-out base.
 */

export function OverheadMap({
  expanded,
  globeImage,
  detail,
  walkerRef,
  spot,
  yawRef,
  pictureRef,
  layerLabel,
  hasImagery,
  escapeRef,
  onTeleport,
  onExpand,
  onCollapse,
  traverse = NO_TRAVERSE,
  traverseSource = null,
}: {
  expanded: boolean
  globeImage: HTMLCanvasElement | null
  detail: SurfaceDetail | null
  /** Where the walker stands, written by the ground a few times a second. */
  walkerRef: RefObject<MarsCoordinate | null>
  /** Where the walker was put, for the marker until the ground reports. */
  spot: MarsCoordinate
  yawRef: RefObject<number>
  /** The ground patch's picture, written by the ground with the walker's place. */
  pictureRef: RefObject<MapPicture | null>
  layerLabel: string
  hasImagery: boolean
  /** The surface view's Escape asks the map first; true when the map took it. */
  escapeRef: RefObject<(() => boolean) | null>
  onTeleport: (at: MarsCoordinate) => void
  onExpand: () => void
  onCollapse: () => void
  /** The rover's driven path up to the slider's sol, oldest first; empty for none. */
  traverse?: readonly MarsCoordinate[]
  traverseSource?: string | null
}) {
  const [openSize, setOpenSize] = useState<MapSize>(() => openWindowSize(screenSize()))
  const size = expanded ? openSize : { width: SMALL_PX, height: SMALL_PX }
  const [menu, setMenu] = useState<{ at: MarsCoordinate; name?: string; decimals: number; x: number; y: number } | null>(null)
  const draft = useMissionStore((s) => s.routeDraft)
  const markers = useMissionStore((s) => s.markers)
  const markerColors = useMarkerColors((s) => s.colors)
  const pins = useMemo(() => mapPins(draft, markers, (id) => markerHex(markerColors, id)), [draft, markers, markerColors])
  const track = useMemo(
    () => (hasRouteLine(draft) ? greatCircleTrack(draftWaypoints(draft).map((w) => w.coordinate)) : []),
    [draft],
  )
  const plan = useWalkPlan((s) => s.plan)
  const walk = useMemo(() => walkOnMap(plan), [plan])
  const overlay = useRef({ pins, track, traverse, walk })
  const canvas = useRef<HTMLCanvasElement>(null)
  const hover = useRef<HTMLSpanElement>(null)
  const span = useRef<HTMLSpanElement>(null)
  const draw = useRef({
    view: null as MapView | null,
    follow: true,
    dirty: true,
    lastDrawn: 0,
    tilesFor: '',
    wanted: null as ReturnType<typeof tilesForMap>,
  })
  const spotRef = useRef(spot)
  const expandedRef = useRef(expanded)
  const sizeRef = useRef(size)
  const menuRef = useRef(menu)
  useEffect(() => {
    sizeRef.current = size
    menuRef.current = menu
    spotRef.current = spot
    expandedRef.current = expanded
    overlay.current = { pins, track, traverse, walk }
    draw.current.dirty = true
  })

  // Each size opens at its own scale, on the walker.
  useEffect(() => {
    const d = draw.current
    d.view = null
    d.follow = true
    d.dirty = true
  }, [expanded])
  // A menu placed for one size does not carry over to the other.
  const [menuSize, setMenuSize] = useState(expanded)
  if (menuSize !== expanded) {
    setMenuSize(expanded)
    setMenu(null)
  }

  // Escape: the menu first, then the expanded map; the small map lets it through.
  useEffect(() => {
    escapeRef.current = () => {
      if (menuRef.current) setMenu(null)
      else if (expanded) onCollapse()
      else return false
      return true
    }
    return () => {
      escapeRef.current = null
    }
  }, [escapeRef, expanded, onCollapse])

  // A layer change is a new store; the old one closes its bitmaps.
  const store = useMemo(() => (detail ? createMapTileStore(detail) : null), [detail])
  useEffect(() => {
    if (!store) return
    store.activate()
    const unsubscribe = store.subscribe(() => {
      draw.current.dirty = true
    })
    return () => {
      unsubscribe()
      store.dispose()
    }
  }, [store])
  // The whole-globe image is 2^z tiles tall; none, and tiles start from zoom 0.
  const baseZoom = globeImage ? Math.round(Math.log2(globeImage.height / TILE_PX)) : null
  const maxZoom = detail?.maxZoom ?? baseZoom ?? 0

  // The draw loop: cheap when nothing changed, which is most frames.
  useEffect(() => {
    let frame = 0
    const d = draw.current
    d.dirty = true
    d.tilesFor = ''
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const el = canvas.current
      const ctx = el?.getContext('2d')
      const s = sizeRef.current
      if (!el || !ctx) return
      const walker = walkerRef.current ?? spotRef.current
      if (!d.view) {
        const span = expandedRef.current ? OPEN_SPAN_KM : SMALL_SPAN_KM
        const limits = zoomLimits(s, maxZoom, CLOSEST_SPAN_KM / KM_PER_DEG)
        const pxPerDeg = Math.max(limits.min, Math.min(limits.max, (s.width / span) * KM_PER_DEG))
        d.view = { centre: walker, pxPerDeg }
      }
      if (!d.dirty && now - d.lastDrawn < WALKER_REDRAW_MS) return
      d.dirty = false
      d.lastDrawn = now
      if (d.follow) d.view = followWalker(d.view, s, walker)
      const view = d.view
      const dpr = window.devicePixelRatio || 1

      // Ask for the tiles this view needs, once per change of view or size.
      const key = `${view.centre.latitude},${view.centre.longitudeEast},${view.pxPerDeg},${s.width},${s.height},${dpr}`
      if (store && detail && key !== d.tilesFor) {
        d.tilesFor = key
        d.wanted = tilesForMap(view, s, dpr, baseZoom, detail.maxZoom)
        store.update(d.wanted)
      }
      const zoom = d.wanted?.zoom ?? null
      // The scale, north–south, which unlike east–west holds at every latitude; at most pole to pole.
      const km = Math.min(180, s.height / view.pxPerDeg) * KM_PER_DEG
      const across = km >= 100 ? `${Math.round(km / 10) * 10}` : km >= 10 ? `${Math.round(km)}` : km.toFixed(1)
      if (span.current && span.current.textContent !== across) span.current.textContent = across

      if (el.width !== Math.round(s.width * dpr) || el.height !== Math.round(s.height * dpr)) {
        el.width = Math.round(s.width * dpr)
        el.height = Math.round(s.height * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.fillStyle = NO_DATA_CSS
      ctx.fillRect(0, 0, s.width, s.height)
      if (globeImage) {
        for (const p of placements(view, s, GLOBE_BOUNDS)) ctx.drawImage(globeImage, p.x, p.y, p.w, p.h)
      }
      if (store && zoom !== null) {
        // Stand-ins come last in the snapshot but belong underneath.
        const shown = store.getSnapshot()
        const ordered = [...shown.filter((t) => t.fallback), ...shown.filter((t) => !t.fallback)]
        for (const { resources } of ordered) {
          for (const p of tilePlacements(view, s, resources.tile)) ctx.drawImage(resources.image, p.x, p.y, p.w, p.h)
        }
      }
      // The ground's own picture, the same pixels it is drawn with, over the tiles.
      const picture = pictureRef.current
      if (picture) {
        for (const p of placements(view, s, picture.bounds)) ctx.drawImage(picture.image, p.x, p.y, p.w, p.h)
      }
      drawTraverse(ctx, view, s, overlay.current.traverse)
      drawWalk(ctx, view, s, overlay.current.walk)
      drawOverlay(ctx, view, s, overlay.current.pins, overlay.current.track, expandedRef.current)
      const at = coordinateToScreen(view, s, walker)
      drawWalker(ctx, at.x, at.y, yawRef.current)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [store, globeImage, detail, baseZoom, maxZoom, walkerRef, yawRef, pictureRef])

  // Wheel zoom about the cursor; a native listener, since React's is passive.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const d = draw.current
      if (!d.view) return
      const s = sizeRef.current
      const rect = el.getBoundingClientRect()
      const limits = zoomLimits(s, maxZoom, CLOSEST_SPAN_KM / KM_PER_DEG)
      d.view = zoomAt(d.view, s, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.002), limits)
      d.follow = false
      d.dirty = true
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [maxZoom])

  // Keeps the view inside the zoom limits when the window shrinks.
  useEffect(() => {
    const d = draw.current
    if (!d.view) return
    const limits = zoomLimits(sizeRef.current, maxZoom, CLOSEST_SPAN_KM / KM_PER_DEG)
    if (d.view.pxPerDeg < limits.min) d.view = { ...d.view, pxPerDeg: limits.min }
  }, [openSize, expanded, maxZoom])

  // The press: a drag pans; a press that barely moves is a click.
  const press = useRef<{ x: number; y: number; lastX: number; lastY: number; moved: boolean; closedMenu: boolean } | null>(null)
  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  // Whether the app's right-click menu (opened from the ground) was open when this press began. Read in a
  // capture listener added at mount, so before the menu's own, which closes it on the same press (as the globe).
  const appMenuAtPress = useRef(false)
  useEffect(() => {
    const onPress = () => {
      appMenuAtPress.current = menuOpenAtPress(useMissionStore.getState())
    }
    window.addEventListener('pointerdown', onPress, true)
    return () => window.removeEventListener('pointerdown', onPress, true)
  }, [])
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    // No text selection while dragging the map.
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    // The press that closes the menu teleports nowhere (as for Measure on the globe).
    const closedMenu = menuRef.current !== null || appMenuAtPress.current
    if (menuRef.current !== null) setMenu(null)
    press.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, closedMenu }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = draw.current
    const p = press.current
    if (p && d.view) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) p.moved = true
      if (p.moved) {
        d.view = panBy(d.view, e.clientX - p.lastX, e.clientY - p.lastY)
        d.follow = false
        d.dirty = true
      }
      p.lastX = e.clientX
      p.lastY = e.clientY
    }
    if (d.view && hover.current) {
      const { x, y } = local(e)
      hover.current.textContent = formatMarsCoordinate(
        screenToCoordinate(d.view, sizeRef.current, x, y),
        pickPrecision(d.view.pxPerDeg),
      )
    }
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    // Only the left button's release ends its press: a middle or right click meanwhile is not a teleport.
    if (e.button !== 0) return
    const p = press.current
    press.current = null
    const view = draw.current.view
    if (!p || p.moved || p.closedMenu || !view) return
    const { x, y } = local(e)
    const pin = pinAt(view, sizeRef.current, overlay.current.pins, x, y)
    onTeleport(pin ? pin.coordinate : screenToCoordinate(view, sizeRef.current, x, y))
  }
  const menuWidth = Math.min(MAP_MENU_WIDTH_PX, size.width - 8)
  const onContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    // Not while the left button is down: its release would teleport under the open menu.
    if (press.current) return
    const view = draw.current.view
    if (!view) return
    const { x, y } = local(e)
    const s = sizeRef.current
    const pin = pinAt(view, s, overlay.current.pins, x, y)
    setMenu({
      at: pin ? pin.coordinate : screenToCoordinate(view, s, x, y),
      name: pin?.name,
      decimals: pin ? 2 : pickPrecision(view.pxPerDeg),
      // Kept inside the window, so a click near its edge still shows all of it.
      x: Math.max(4, Math.min(x, s.width - menuWidth - 4)),
      y: Math.max(4, Math.min(y, s.height - MAP_MENU_HEIGHT_PX - 4)),
    })
  }

  // The grip: the window is anchored bottom left, so it grows up and right.
  const grip = useRef<{ x: number; y: number; start: MapSize } | null>(null)
  const resize = (next: MapSize) => setOpenSize(clampWindowSize(next, screenSize()))
  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // No text selection while resizing.
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    grip.current = { x: e.clientX, y: e.clientY, start: openSize }
  }
  const onGripMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = grip.current
    if (!g) return
    resize({ width: g.start.width + e.clientX - g.x, height: g.start.height - (e.clientY - g.y) })
  }
  const onGripKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]
    if (!step) return
    // The ground leaves arrow keys alone here (`data-own-keys`).
    e.preventDefault()
    resize({ width: openSize.width + step[0] * GRIP_STEP_PX, height: openSize.height + step[1] * GRIP_STEP_PX })
  }

  // Keeps the window on screen when the browser window shrinks.
  useEffect(() => {
    const onResize = () => setOpenSize((s) => clampWindowSize(s, screenSize()))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const findMe = () => {
    const d = draw.current
    const walker = walkerRef.current ?? spotRef.current
    if (d.view) d.view = { ...d.view, centre: walker }
    d.follow = true
    d.dirty = true
  }
  const button =
    'rounded-control border border-line px-2 py-0.5 text-ink transition-colors duration-(--duration-fast) hover:bg-surface-raised'

  return (
    <section
      aria-label={expanded ? 'Map of Mars' : 'The site from above'}
      // Never shorter than the header, the map and the caption's first lines: on a short screen the rest of the caption scrolls.
      style={{ minHeight: size.height + HEADER_AND_PADDING_PX }}
      // Fills the column under the surface panel. Expanded, it is drawn over the walk guide, so its
      // Collapse is never under another panel; still under the right-click menu (z-30).
      className={`pointer-events-auto relative flex min-h-0 flex-1 select-none flex-col gap-2 rounded-panel ${expanded ? 'z-20' : ''} border border-line/60 bg-surface/80 p-3 text-caption text-ink-muted shadow-panel backdrop-blur-glass`}
    >
      {expanded && (
        <div
          role="slider"
          data-own-keys
          tabIndex={0}
          aria-label="Map size: drag, or arrow keys"
          aria-valuetext={`${size.width} by ${size.height} pixels`}
          aria-valuenow={size.width}
          title="Drag to resize"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={() => (grip.current = null)}
          onPointerCancel={() => (grip.current = null)}
          onKeyDown={onGripKey}
          className="absolute -top-1.5 -right-1.5 z-10 size-4 cursor-nesw-resize touch-none rounded-full border border-line bg-surface-raised"
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-ink">{expanded ? 'Map' : 'From above'}</h2>
        <div className="flex gap-1.5">
          {/* Focus leaves the buttons, since Space is a movement key (as the Fly button). */}
          <button type="button" onClick={(e) => (e.currentTarget.blur(), findMe())} className={button}>
            Find me
          </button>
          <button
            type="button"
            onClick={(e) => (e.currentTarget.blur(), expanded ? onCollapse() : onExpand())}
            className={button}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      <div className="relative shrink-0" style={{ width: size.width, height: size.height }}>
        <canvas
          ref={canvas}
          style={{ width: size.width, height: size.height, cursor: 'crosshair' }}
          className="block touch-none rounded-control border border-line/60 bg-canvas"
          role="img"
          aria-label="Map, north up, you marked with your heading. Drag to move, wheel to zoom, click to teleport, right-click to see the coordinate first."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (press.current = null)}
          onPointerLeave={() => hover.current && (hover.current.textContent = '—')}
          onContextMenu={onContextMenu}
        />
        {menu && (
          <OverheadMapMenu
            key={`${menu.x},${menu.y}`}
            at={menu.at}
            name={menu.name}
            decimals={menu.decimals}
            x={menu.x}
            y={menu.y}
            width={menuWidth}
            onTeleport={() => {
              setMenu(null)
              onTeleport(menu.at)
            }}
            onCancel={() => setMenu(null)}
          />
        )}
      </div>
      <MapCaption
        width={size.width}
        expanded={expanded}
        layerLabel={layerLabel}
        hasImagery={hasImagery}
        spanRef={span}
        hoverRef={hover}
        pins={pins}
        line={track.length > 1}
        walk={walk}
        traverseSource={traverse.length > 1 ? traverseSource : null}
      />
    </section>
  )
}

const NO_TRAVERSE: readonly MarsCoordinate[] = []

function screenSize(): MapSize {
  return { width: window.innerWidth, height: window.innerHeight }
}
