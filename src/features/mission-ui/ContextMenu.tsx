import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { formatMarsCoordinate, type MarsCoordinate, type SurfacePoint } from '../../domain'
import { MARKER_COLORS, markerHex, useMarkerColors, useMissionStore, type ContextMenuState } from '../../state'
import { copyText } from '../../lib/clipboard'
import { CoordinateField } from './CoordinateField'
import { tableShows } from './coordinateTable'
import { ARROW_ITEMS, FIRST_ITEM, coordinateSource, nextItemIndex, stepOf, stepRoles } from './contextMenuStep'
import { nearbyMarker, nearbyRoutePin, routePinName, type RoutePin } from './nearbyMarker'
import { kmPerPixel } from './scaleBarMath'
import { DescriptionEditor } from './tools/MarkedPoints'
import { useEscapeLayer } from '../../lib/useEscapeLayer'

interface ContextMenuProps {
  /** Vertical field of view of the scene camera, degrees. The shell passes the scene's own value. */
  fovDeg: number
}

/**
 * Right-click menu over the surface. It reads `contextMenu` from the
 * store — the scene opens it with the picked coordinate — and every item
 * dispatches a store action, so the camera, markers and panels react without
 * this component knowing they exist. A marked point near the pick
 * is found here, from the markers and the settled camera, so the open menu
 * can offer to unmark it, and the item goes when the point is unmarked
 * elsewhere.
 */
export function ContextMenu({ fovDeg }: ContextMenuProps) {
  const menu = useMissionStore((s) => s.contextMenu)
  const markers = useMissionStore((s) => s.markers)
  const camera = useMissionStore((s) => s.camera)
  const draft = useMissionStore((s) => s.routeDraft)
  // A route is followed in navigation and, entered from it, in the surface view: its draft is fixed.
  const navigating = useMissionStore((s) => s.viewMode === 'navigation' || s.activeRoute !== null)
  const surface = useMissionStore((s) => s.viewMode === 'surface')
  if (!menu) return null
  // The scale bar's figure for this camera: the scene fills the window, so
  // its height is the window's. null before the first settle.
  // In the surface view the globe's camera says nothing of the ground under the cursor, so nothing is near.
  const kmPerPx = camera === null || surface ? null : kmPerPixel(camera.altitudeKm, fovDeg, window.innerHeight)
  const nearMarker = nearbyMarker(markers, menu.coordinate, kmPerPx)
  // A route pin the click landed on; the route is fixed while navigating, so its items are off there.
  const nearRoute = nearbyRoutePin(draft, menu.coordinate, kmPerPx)
  // A new anchor is a new menu: focus and position start over.
  return (
    <OpenMenu
      key={`${menu.anchor.x},${menu.anchor.y}`}
      menu={menu}
      nearMarker={nearMarker}
      nearRoute={nearRoute}
      navigating={navigating}
      surface={surface}
    />
  )
}

/** Keeps the menu inside the viewport. */
const EDGE_PX = 8

/** Why Set point is off in navigation, in the search bar's words. */
const SET_POINT_NAVIGATING_HINT = 'End navigation to set a point'
/** Why a route pin cannot be removed in navigation, in the same words. */
const REMOVE_PIN_NAVIGATING_HINT = 'End navigation to change the route'

/** The open menu; exported so tests can render it with a menu state. */
export function OpenMenu({
  menu,
  nearMarker = null,
  nearRoute = null,
  navigating = false,
  surface = false,
}: {
  menu: ContextMenuState
  /** The marked point the right-click landed on or beside, if any. */
  nearMarker?: SurfacePoint | null
  /** The route pin the click landed on or beside, if any. */
  nearRoute?: RoutePin | null
  /** The view is following a route: Set point is off. */
  navigating?: boolean
  /**
   * Opened from the ground in the surface view: only the point's own
   * items. Center view, the coordinate table, Hide all tools and the sun
   * shading belong to the globe.
   */
  surface?: boolean
}) {
  const { anchor } = menu
  // A right-click on or beside a marked point picks the point itself, not
  // the spot on its pin: the pin stands above the surface, so the raw pick
  // can be far from where the point was marked. Set point, Center view and
  // the rest then act on the marked point. Fixed when the menu opens: a zoom
  // with the menu open changes what is near, not what was right-clicked.
  const [atMark] = useState(nearMarker)
  // A route pin is the same: the pick snaps to it, and it may have been typed in the search bar.
  const [atRoute] = useState(nearRoute)
  const [pick] = useState(() => atMark?.coordinate ?? atRoute?.coordinate ?? menu.coordinate)
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(anchor)
  // The picked point, or what the user typed over it. null while the
  // typed text is empty or invalid: the point actions wait for a valid one.
  const [coordinate, setCoordinate] = useState<MarsCoordinate | null>(pick)
  const [editing, setEditing] = useState(false)
  const wasEditing = useRef(false)
  // Escape in the editor restores the point it opened with. `cancelled`
  // ignores the commit a field removed with focus in it can still send on
  // blur.
  const beforeEdit = useRef<MarsCoordinate | null>(null)
  const cancelled = useRef(false)
  // Mark point first asks for an optional description, in place of the items.
  const [describing, setDescribing] = useState(false)
  const wasDescribing = useRef(false)
  // Rename asks for the marked point's new description in the same place.
  const [renaming, setRenaming] = useState(false)
  const wasRenaming = useRef(false)

  const close = useMissionStore((s) => s.closeContextMenu)
  const setPoint = useMissionStore((s) => s.setPoint)
  const markPoint = useMissionStore((s) => s.markPoint)
  const unmarkPoint = useMissionStore((s) => s.unmarkPoint)
  const describePoint = useMissionStore((s) => s.describePoint)
  const removeStop = useMissionStore((s) => s.removeStop)
  const removeRouteEnd = useMissionStore((s) => s.removeRouteEnd)
  const markerColors = useMarkerColors((s) => s.colors)
  const setMarkerColor = useMarkerColors((s) => s.setMarkerColor)
  const requestCenter = useMissionStore((s) => s.requestCenter)
  const openCoordinateTable = useMissionStore((s) => s.openCoordinateTable)
  const closeCoordinateTable = useMissionStore((s) => s.closeCoordinateTable)
  const toggleToolsHidden = useMissionStore((s) => s.toggleToolsHidden)
  const table = useMissionStore((s) => s.coordinateTable)
  const toolsHidden = useMissionStore((s) => s.toolsHidden)
  const sunShading = useMissionStore((s) => s.sunShading)
  const toggleSunShading = useMissionStore((s) => s.toggleSunShading)

  const formatted = coordinate ? formatMarsCoordinate(coordinate) : null
  // The pick until the user commits a typed point: Escape in the editor
  // restores the pick object itself, so it counts as the pick again.
  // A snapped point (a marked point or a route pin) may have been typed, so it never claims the pick's DERIVED mark.
  const source = coordinateSource(coordinate === pick, atMark !== null || atRoute !== null)
  // The marked point is already marked: another would lie exactly on it.
  const showingMark = atMark !== null && coordinate === pick
  const roles = stepRoles(stepOf(editing, describing || renaming))

  // Shift away from the right and bottom edges once the size is known, and
  // again when the coordinate editor, its error or the description step
  // changes the height.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPosition({
      x: Math.max(EDGE_PX, Math.min(anchor.x, window.innerWidth - width - EDGE_PX)),
      y: Math.max(EDGE_PX, Math.min(anchor.y, window.innerHeight - height - EDGE_PX)),
    })
  }, [anchor, editing, coordinate, describing, renaming])

  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>(FIRST_ITEM)?.focus()
  }, [anchor])

  // Opening the editor puts the caret in it; leaving it, by Enter or
  // Escape, returns focus to Edit so the arrow keys keep working.
  useEffect(() => {
    if (editing) ref.current?.querySelector<HTMLElement>('[data-focus="menu-coordinate"]')?.focus()
    else if (wasEditing.current) ref.current?.querySelector<HTMLElement>('[data-edit-coordinates]')?.focus()
    wasEditing.current = editing
  }, [editing])

  const openEditor = () => {
    beforeEdit.current = coordinate
    cancelled.current = false
    setEditing(true)
  }
  const cancelEdit = () => {
    cancelled.current = true
    setCoordinate(beforeEdit.current)
    setEditing(false)
  }

  // Cancelling the description step returns focus to Mark point.
  useEffect(() => {
    if (wasDescribing.current && !describing) {
      ref.current?.querySelector<HTMLElement>('[data-item="Mark point"]')?.focus()
    }
    wasDescribing.current = describing
  }, [describing])
  useEffect(() => {
    if (wasRenaming.current && !renaming) ref.current?.querySelector<HTMLElement>('[data-item^="Rename"]')?.focus()
    wasRenaming.current = renaming
  }, [renaming])

  // Escape closes the menu when it is the top layer; any pointer
  // press outside closes it regardless.
  useEscapeLayer(true, close)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const inside = e.target instanceof Node && ref.current?.contains(e.target)
      if (!inside) close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [close])

  // Arrow keys move between items; Home and End jump.
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // In the coordinate field, Home and End move the caret.
    if (e.target instanceof HTMLInputElement) return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ARROW_ITEMS))
    const current = items.findIndex((el) => el === document.activeElement)
    const next = nextItemIndex(e.key, current, items.length)
    if (next === null) return
    e.preventDefault()
    items[next]?.focus()
  }

  const run = (action: () => void) => () => {
    action()
    close()
  }

  // Disabled while the typed coordinate is empty or invalid.
  const pointItem = (label: string, action: (c: MarsCoordinate) => void) => ({
    label,
    disabled: coordinate === null,
    action: () => {
      if (coordinate) action(coordinate)
    },
  })

  // `stay` items open a step inside the menu instead of closing it.
  // `disabled` items wait for a valid typed coordinate. An `off` item does
  // nothing, with `hint` under its label saying why. It is aria-disabled,
  // not disabled, so it keeps focus and its place in the arrow-key order
  // and a keyboard or screen-reader user hears the reason too.
  const items: {
    label: string
    disabled?: boolean
    off?: boolean
    hint?: string
    stay?: boolean
    action: () => void
  }[] = [
    // Into the route: departure, then destination, then a chooser here.
    // In navigation the route is fixed and no panel shows a set point, so
    // the item stays in place, off, with the search bar's reason.
    navigating
      ? { label: 'Set point', off: true, hint: SET_POINT_NAVIGATING_HINT, action: () => undefined }
      : pointItem('Set point', (c) => setPoint(c, anchor)),
    ...(showingMark
      ? []
      : [
          {
            ...pointItem('Mark point', () => {
              setEditing(false)
              setDescribing(true)
            }),
            stay: true,
          },
        ]),
    // The point the right-click landed on or beside goes from here,
    // named as the Marked points list names it. Unmark acts on the pick,
    // not on a typed coordinate, so it stays enabled while editing.
    ...(nearMarker
      ? [
          { label: `Unmark ${nearMarker.label ?? 'Unnamed point'}`, action: () => unmarkPoint(nearMarker.id) },
          {
            label: `Rename ${nearMarker.label ?? 'Unnamed point'}`,
            stay: true,
            action: () => {
              setEditing(false)
              setRenaming(true)
            },
          },
        ]
      : []),
    // The route pin clicked on goes from the route; a removed end is
    // taken over by the nearest stop (`withoutRouteEnd`).
    ...(nearRoute
      ? [
          navigating
            ? { label: `Remove ${routePinName(nearRoute)}`, off: true, hint: REMOVE_PIN_NAVIGATING_HINT, action: () => undefined }
            : {
                label: `Remove ${routePinName(nearRoute)}`,
                action: () => (nearRoute.kind === 'stop' ? removeStop(nearRoute.index) : removeRouteEnd(nearRoute.kind)),
              },
        ]
      : []),
    ...(surface ? [] : [pointItem('Center view', requestCenter)]),
    // Copy failing is not worth an error here; the table's Copy reports it.
    pointItem('Copy coordinates', (c) => void copyText(formatMarsCoordinate(c))),
    ...(surface
      ? []
      : [
          // Collapse only the table showing this point from this source; Expand
          // replaces another, and waits with the point items for a valid one.
          coordinate && tableShows(table, coordinate, source)
            ? { label: 'Collapse coordinate table', action: closeCoordinateTable }
            : pointItem('Expand coordinate table', (c) => openCoordinateTable(c, source)),
          {
            label: toolsHidden ? 'Show all tools' : 'Hide all tools',
            action: toggleToolsHidden,
          },
          // Day and night on the globe stay on in every mode until turned off here.
          {
            label: sunShading ? 'Hide sun shading' : 'Show sun shading',
            action: toggleSunShading,
          },
        ]),
  ]

  return (
    <div
      ref={ref}
      role={roles.container}
      aria-label={renaming ? 'Rename marked point' : roles.label}
      aria-describedby={roles.describedByCoordinate ? 'context-menu-coordinate' : undefined}
      onKeyDown={onMenuKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: position.x, top: position.y }}
      // Over the surface view, its arrow keys and Space work the menu, not the walker.
      data-own-keys
      // z-30: above the icon-panel slot, which rises to z-20 while a
      // sub-panel is open, and the open time menu (z-10).
      className="fixed z-30 w-56 rounded-panel border border-line/60 bg-surface/70 p-1 shadow-panel backdrop-blur-glass"
    >
      <div id="context-menu-coordinate" role="presentation" className="px-3 pb-2 pt-1">
        {editing ? (
          <div
            onKeyDown={(e) => {
              // Cancels the edit only; `preventDefault` keeps the menu open
              // under the shared Escape rule.
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelEdit()
              }
            }}
          >
            <CoordinateField
              label="Coordinates"
              focusKey="menu-coordinate"
              value={coordinate}
              onErrorChange={ignoreError}
              onCommit={(c, via) => {
                if (cancelled.current) return
                setCoordinate(c)
                if (c && via === 'enter') setEditing(false)
              }}
            />
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              {/* Names the marked point while the line shows it, untyped over. */}
              <p className="break-words text-micro uppercase text-ink-subtle">
                {showingMark ? (atMark.label ?? 'Unnamed point') : 'Coordinates'}
              </p>
              {/* The point stays fixed while it is described or renamed. */}
              {!describing && !renaming && (
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Edit coordinates"
                  data-edit-coordinates
                  onClick={openEditor}
                  className="rounded-control px-1.5 text-caption text-accent transition-colors duration-(--duration-fast) hover:bg-accent/15"
                >
                  Edit
                </button>
              )}
            </div>
            <p className="text-body tabular-nums text-ink">{formatted}</p>
          </>
        )}
      </div>
      <hr className="mx-2 mb-1 border-line" />
      {renaming && nearMarker ? (
        <div className="px-3 pb-2 pt-1">
          <DescriptionEditor
            initial={nearMarker.label ?? ''}
            submitLabel="Rename"
            onSave={(text) => {
              describePoint(nearMarker.id, text)
              close()
            }}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : describing && coordinate ? (
        <div className="px-3 pb-2 pt-1">
          <DescriptionEditor
            initial=""
            submitLabel="Mark point"
            onSave={(text) => {
              markPoint(coordinate, text)
              close()
            }}
            onCancel={() => setDescribing(false)}
          />
        </div>
      ) : (
        // One wrapper in every step, so the items are not remounted when
        // the editor opens and the menu role moves onto it.
        <div role={roles.items} aria-label={roles.items === 'menu' ? 'Surface actions' : undefined}>
          {items.map(({ label, disabled = false, off = false, hint, stay = false, action }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              data-item={label}
              disabled={disabled}
              aria-disabled={off || undefined}
              // An off item keeps the menu open, as a disabled one does.
              onClick={off ? undefined : stay ? action : run(action)}
              className="group block w-full break-words rounded-control px-3 py-2 text-left text-body text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink focus-visible:bg-surface-raised focus-visible:text-ink disabled:hover:bg-transparent disabled:hover:text-ink-muted aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-muted"
            >
              {/* Only the label fades when off: the reason under it stays readable. */}
              <span className="group-disabled:opacity-40 group-aria-disabled:opacity-40">{label}</span>
              {hint && <span className="block text-caption">{hint}</span>}
            </button>
          ))}
          {/* The marked point's colour, none of them a route role's. */}
          {nearMarker && !editing && (
            <div role="group" aria-label="Colour" className="flex items-center gap-2 px-3 py-2">
              <span className="text-caption text-ink-muted">Colour</span>
              {MARKER_COLORS.map((c) => {
                const chosen = markerHex(markerColors, nearMarker.id) === c.hex
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={chosen}
                    aria-label={c.label}
                    title={c.label}
                    onClick={run(() => setMarkerColor(nearMarker.id, c.id))}
                    style={{ background: `#${c.hex.toString(16).padStart(6, '0')}` }}
                    className={`size-5 rounded-full border-2 transition-transform duration-(--duration-fast) hover:scale-110 focus-visible:scale-110 ${chosen ? 'border-ink' : 'border-transparent'}`}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The field shows its own error and the point items disable on null. */
const ignoreError = () => undefined
