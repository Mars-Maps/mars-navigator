import { create } from 'zustand'
import {
  isValidCoordinate,
  type MapLayer,
  type MapLayerId,
  type MarsCoordinate,
  type RouteOption,
  type SurfacePoint,
} from '../domain'
import { TABLE_MODES, type CoordinateTableState } from './coordinateTable'
import { describeMarker, withNewMarker, withoutMarker } from './markers'
import {
  EMPTY_ROUTE,
  defaultRouteOption,
  replacedRouteOptions,
  setPointSlot,
  withoutRouteEnd,
  type RouteDraft,
  type RouteEnd,
} from './routeDraft'
import { surfaceLeaveTarget, surfaceReturnFrom, transitionTo } from './transitions'
import type {
  CameraView,
  CenterRequest,
  ContextMenuState,
  NorthUpRequest,
  SidePanelId,
  SurfaceImage,
  ZoomDirection,
  ZoomRequest,
} from './missionTypes'
import { canTransition, type ViewMode } from './viewMode'

export type * from './missionTypes'

/**
 * Interface state shared by panels that do not sit next to each other.
 * Read it with a selector — useMissionStore((s) => s.viewMode) — so a panel
 * re-renders only when its own slice changes.
 *
 * Time and sun state live in their own slice, not here.
 */
export interface MissionState {
  viewMode: ViewMode
  /** The point the user clicked or set, if any. */
  selectedPoint: MarsCoordinate | null
  routeDraft: RouteDraft
  /**
   * The route being navigated: the planner's answer the user chose.
   * Interface state, not dataset contents — the option
   * carries its own classified metrics. null until a planner exists.
   */
  activeRoute: RouteOption | null
  /**
   * Every option the planner offered for the draft: one per
   * strategy, in the registry's order. Non-empty exactly while navigating,
   * and `activeRoute` is always one of them. The route picker lists these;
   * a strategy that cannot compute a path is listed with its UNAVAILABLE
   * reason, never drawn.
   */
  routeOptions: readonly RouteOption[]
  /**
   * The base layers the app can show, each with its provenance. Empty
   * until the layer adapter loads them; the menu says so rather than
   * listing placeholders. The app shell sets it once from the adapter.
   *
   * In the store, not props, for the usual reason: two readers with
   * no shared parent below App — the layer menu inside the icon panel, and
   * the scene for the active layer's texture. It is a four-entry provenance
   * catalogue, not dataset contents; those still arrive as props.
   */
  layers: MapLayer[]
  activeLayerId: MapLayerId
  /** What the globe shows for `activeLayerId`; see SurfaceImage. */
  surfaceImage: SurfaceImage | null
  /** Ids come from the tool registry. null means no tool. */
  activeToolId: string | null
  /** Coordinate grid overlay, drawn by mars-3d. */
  gridVisible: boolean
  /**
   * Which icon-panel sub-panels are open. Each opens and closes on its own,
   * so the layer menu and compass can be open together.
   */
  openSidePanels: Record<SidePanelId, boolean>
  /** null until the first zoom button press. */
  zoomRequest: ZoomRequest | null
  /**
   * Points the user flagged with "Mark point", in order. Rendered by
   * mars-3d; each has an id so it can be keyed and later removed. Elevation
   * is UNAVAILABLE until a terrain lookup exists.
   */
  markers: SurfacePoint[]
  /** null until the first "Center view". */
  centerRequest: CenterRequest | null
  /** null until the first click on the compass dial. */
  northUpRequest: NorthUpRequest | null
  /**
   * The coordinate table's point and source, or null while closed.
   * Set only in close-up and navigation; a move to any other mode closes it.
   */
  coordinateTable: CoordinateTableState | null
  /** "Hide all tools": every panel except the scene is hidden. */
  toolsHidden: boolean
  /** Sun shading on the globe in every globe mode; the right-click menu turns it off. */
  sunShading: boolean
  /** null while the right-click menu is closed. */
  contextMenu: ContextMenuState | null
  /**
   * The "Start here / End here / Add as a stop" chooser, open at the
   * cursor when Set point finds both ends of the route already chosen.
   * null while closed.
   */
  setPointChooser: ContextMenuState | null
  /**
   * The user closed the welcome intro panel. Reset on every return to
   * welcome, so the panel comes back with the welcome screen.
   */
  introDismissed: boolean
  /** null until the scene has rendered its first frame. */
  camera: CameraView | null
  /**
   * The surface coordinate under the cursor, DERIVED from the pick
   * ray, or null when the cursor is off the globe. Written by mars-3d only
   * when the value changes at the shown precision and at most every few
   * tens of milliseconds, so reading it is not a render storm.
   */
  hoverCoordinate: MarsCoordinate | null
  /**
   * Where the walker stands, DERIVED from the globe's pick ray. Set
   * exactly while the mode is surface: enterSurface sets both, and any
   * move out of surface clears it.
   */
  surfaceSpot: MarsCoordinate | null
  /** Where leaving the surface goes back to: navigation when entered from it, else close-up (`surfaceReturnFrom`). */
  surfaceReturn: 'close-up' | 'navigation'
  /** What happened to the drop: snapped onto the followed route, and how far; null when it landed where it was. Cleared on leaving. */
  surfaceNote: string | null

  /**
   * Ignored if the move is not allowed — see viewMode.ts. Entering welcome
   * from another mode clears `introDismissed`. Surface needs a spot, so it
   * is entered only through enterSurface; setViewMode('surface') is ignored.
   */
  setViewMode: (next: ViewMode) => void
  /**
   * Stands on the surface at `at`: sets the spot and enters surface
   * in one write, and closes the hover readout and the right-click menu,
   * which belong to the globe. It also turns "Hide all tools" off: its
   * switch is in the right-click menu, which surface does not have. From
   * welcome, close-up or navigation, and only for a valid
   * coordinate; otherwise nothing changes. From surface it moves the
   * walker to `at`. `note` says what happened to the drop, if
   * anything did.
   */
  enterSurface: (at: MarsCoordinate, note?: string) => void
  /**
   * Back to where the surface was entered from (`surfaceReturn`): close-up
   * with the globe as it was, or navigation with the route still followed;
   * close-up if the route is gone meanwhile. Does nothing outside surface.
   */
  leaveSurface: () => void
  /**
   * Stores the settled view. It never changes the mode: the shell watches
   * the altitude and the user's input and calls setViewMode.
   */
  setCameraView: (view: CameraView) => void
  setHoverCoordinate: (coordinate: MarsCoordinate | null) => void
  selectPoint: (point: MarsCoordinate | null) => void
  setDeparture: (point: MarsCoordinate | null) => void
  setDestination: (point: MarsCoordinate | null) => void
  addStop: (point: MarsCoordinate) => void
  /**
   * `null` marks the stop as entered but not valid. An index outside
   * `stops` is ignored, not an error.
   */
  updateStop: (index: number, point: MarsCoordinate | null) => void
  /** An index outside `stops` is ignored, not an error. */
  removeStop: (index: number) => void
  /** Removes the departure or destination; the nearest stop takes its place (`withoutRouteEnd`). Not while navigating. */
  removeRouteEnd: (end: RouteEnd) => void
  /**
   * Moves one stop to another position in a single write, so subscribers
   * never see a duplicated or missing stop. Out-of-range or equal indices
   * are ignored.
   */
  moveStop: (from: number, to: number) => void
  /**
   * Clears the draft and the active route together. In navigation it also
   * returns to close-up, so the view is never navigation with no route.
   */
  clearRoute: () => void
  /**
   * Follows a planned route: sets `activeRoute` and enters
   * navigation in one write. Allowed only where navigation can be entered
   * (from close-up, or already navigating, which replaces the route);
   * anywhere else nothing changes. With `endNavigation` and `clearRoute`
   * this keeps one rule: `activeRoute` is set exactly while navigating.
   * It is the only way to set a route.
   *
   * It takes every option the planner offered and selects the
   * first with a DERIVED path, else the first listed (`defaultRouteOption`);
   * an empty list changes nothing. `selectRouteOption` changes the choice.
   */
  startNavigation: (options: readonly RouteOption[]) => void
  /**
   * Makes one of `routeOptions` the active route. Only while
   * navigating, and only for an id in the list; anything else is ignored,
   * so the invariant above holds.
   */
  selectRouteOption: (id: string) => void
  /** Replaces every option while navigating or standing on the route, once a terrain search answers (`replacedRouteOptions`). */
  replaceRouteOptions: (options: readonly RouteOption[]) => void
  /**
   * Stops following the route: `activeRoute` is cleared and the view
   * returns to close-up. The draft is kept, so the user can change it and
   * plan again. Does nothing outside navigation. If the camera is above the
   * welcome threshold, the altitude rule then moves close-up
   * on to welcome at the next settled view; the search bar shows there too.
   */
  endNavigation: () => void
  /** Replaces the list. `activeLayerId` is untouched; a menu may show it as missing. */
  setLayers: (layers: MapLayer[]) => void
  setActiveLayer: (id: MapLayerId) => void
  setSurfaceImage: (image: SurfaceImage) => void
  setActiveTool: (id: string | null) => void
  toggleGrid: () => void
  /** Opens or closes `id`; the other sub-panel is left as it is. */
  toggleSidePanel: (id: SidePanelId) => void
  /** Closes `id`; already closed, it stays closed. Escape uses this. */
  closeSidePanel: (id: SidePanelId) => void
  requestZoom: (direction: ZoomDirection) => void
  /**
   * Marked points. The description is the user's own text, stored as
   * the label: trimmed, capped at MARKER_DESCRIPTION_MAX, and blank means no
   * label. An unknown id is a silent no-op.
   */
  markPoint: (point: MarsCoordinate, description?: string) => void
  unmarkPoint: (id: string) => void
  describePoint: (id: string, description: string) => void
  requestCenter: (target: MarsCoordinate, altitudeKm?: number) => void
  requestNorthUp: () => void
  /**
   * Opens the table for `point` from `source`, replacing what it showed.
   * Ignored for an invalid coordinate or outside close-up and navigation.
   */
  openCoordinateTable: (point: MarsCoordinate, source: CoordinateTableState['source']) => void
  closeCoordinateTable: () => void
  toggleToolsHidden: () => void
  toggleSunShading: () => void
  openContextMenu: (menu: ContextMenuState) => void
  closeContextMenu: () => void
  /**
   * Right-click → Set point. Selects the point, so the point menu
   * opens for it as before, and puts it into the route in one write: the
   * departure if none is chosen, else the destination if none is chosen,
   * else it opens the chooser at `anchor` and changes nothing else. See
   * setPointSlot. In navigation it only selects: the search bar is hidden
   * there, so the draft must not change behind the route being followed.
   */
  setPoint: (point: MarsCoordinate, anchor: { x: number; y: number }) => void
  closeSetPointChooser: () => void
  dismissIntro: () => void
}

export const useMissionStore = create<MissionState>()((set) => ({
  viewMode: 'welcome',
  selectedPoint: null,
  routeDraft: EMPTY_ROUTE,
  activeRoute: null,
  routeOptions: [],
  layers: [],
  activeLayerId: 'satellite',
  surfaceImage: null,
  activeToolId: null,
  gridVisible: false,
  openSidePanels: { layers: false, compass: false },
  zoomRequest: null,
  markers: [],
  centerRequest: null,
  northUpRequest: null,
  coordinateTable: null,
  toolsHidden: false,
  sunShading: true,
  contextMenu: null,
  setPointChooser: null,
  introDismissed: false,
  camera: null,
  hoverCoordinate: null,
  surfaceSpot: null,
  surfaceReturn: 'close-up',
  surfaceNote: null,

  setViewMode: (next) => set((s) => (next === 'surface' ? s : transitionTo(s, next))),
  enterSurface: (at, note) =>
    set((s) =>
      canTransition(s.viewMode, 'surface') && isValidCoordinate(at)
        ? {
            ...transitionTo(s, 'surface'),
            surfaceSpot: at,
            surfaceNote: note ?? null,
            surfaceReturn: surfaceReturnFrom(s),
            hoverCoordinate: null,
            contextMenu: null,
            setPointChooser: null,
            toolsHidden: false,
          }
        : s,
    ),
  leaveSurface: () => set((s) => (s.viewMode === 'surface' ? transitionTo(s, surfaceLeaveTarget(s)) : s)),
  setCameraView: (view) => set({ camera: view }),
  setHoverCoordinate: (coordinate) =>
    set((s) => (s.hoverCoordinate === coordinate ? s : { hoverCoordinate: coordinate })),
  selectPoint: (point) => set({ selectedPoint: point }),
  setDeparture: (point) =>
    set((s) => ({ routeDraft: { ...s.routeDraft, departure: point } })),
  setDestination: (point) =>
    set((s) => ({ routeDraft: { ...s.routeDraft, destination: point } })),
  addStop: (point) =>
    set((s) => ({
      routeDraft: { ...s.routeDraft, stops: [...s.routeDraft.stops, point] },
    })),
  updateStop: (index, point) =>
    set((s) => ({
      routeDraft: {
        ...s.routeDraft,
        stops: s.routeDraft.stops.map((p, i) => (i === index ? point : p)),
      },
    })),
  removeStop: (index) =>
    set((s) => ({
      routeDraft: {
        ...s.routeDraft,
        stops: s.routeDraft.stops.filter((_, i) => i !== index),
      },
    })),
  removeRouteEnd: (end) =>
    set((s) => (s.viewMode === 'navigation' ? s : { routeDraft: withoutRouteEnd(s.routeDraft, end) })),
  moveStop: (from, to) =>
    set((s) => {
      const { stops } = s.routeDraft
      const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < stops.length
      if (from === to || !inRange(from) || !inRange(to)) return s
      const next = stops.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { routeDraft: { ...s.routeDraft, stops: next } }
    }),
  clearRoute: () =>
    set((s) => ({
      routeDraft: EMPTY_ROUTE,
      activeRoute: null,
      routeOptions: [],
      ...(s.viewMode === 'navigation' ? transitionTo(s, 'close-up') : {}),
    })),
  startNavigation: (options) =>
    set((s) => {
      const route = defaultRouteOption(options)
      // Not from the surface: its panels are not shown there, and the walker would be pulled off the ground.
      return route && s.viewMode !== 'surface' && canTransition(s.viewMode, 'navigation')
        ? { activeRoute: route, routeOptions: [...options], ...transitionTo(s, 'navigation') }
        : s
    }),
  selectRouteOption: (id) =>
    set((s) => {
      const route = s.routeOptions.find((o) => o.id === id)
      return route && s.viewMode === 'navigation' ? { activeRoute: route } : s
    }),
  replaceRouteOptions: (options) => set((s) => replacedRouteOptions(s, options) ?? s),
  endNavigation: () =>
    set((s) =>
      s.viewMode === 'navigation'
        ? { activeRoute: null, routeOptions: [], ...transitionTo(s, 'close-up') }
        : s,
    ),
  setLayers: (layers) => set({ layers }),
  setActiveLayer: (id) => set({ activeLayerId: id }),
  setSurfaceImage: (image) => set({ surfaceImage: image }),
  setActiveTool: (id) => set({ activeToolId: id }),
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
  toggleSidePanel: (id) =>
    set((s) => ({
      openSidePanels: { ...s.openSidePanels, [id]: !s.openSidePanels[id] },
    })),
  closeSidePanel: (id) =>
    set((s) =>
      s.openSidePanels[id] ? { openSidePanels: { ...s.openSidePanels, [id]: false } } : s,
    ),
  requestZoom: (direction) =>
    set((s) => ({
      zoomRequest: { direction, id: (s.zoomRequest?.id ?? 0) + 1 },
    })),
  markPoint: (point, description) =>
    set((s) => ({ markers: withNewMarker(s.markers, point, description) })),
  unmarkPoint: (id) => set((s) => ({ markers: withoutMarker(s.markers, id) })),
  describePoint: (id, description) =>
    set((s) => ({ markers: describeMarker(s.markers, id, description) })),
  requestCenter: (target, altitudeKm) =>
    set((s) => ({
      centerRequest: { target, altitudeKm, id: (s.centerRequest?.id ?? 0) + 1 },
    })),
  requestNorthUp: () => set((s) => ({ northUpRequest: { id: (s.northUpRequest?.id ?? 0) + 1 } })),
  openCoordinateTable: (point, source) =>
    set((s) =>
      TABLE_MODES.includes(s.viewMode) && isValidCoordinate(point)
        ? { coordinateTable: { point, source } }
        : s,
    ),
  closeCoordinateTable: () => set({ coordinateTable: null }),
  toggleToolsHidden: () => set((s) => ({ toolsHidden: !s.toolsHidden })),
  toggleSunShading: () => set((s) => ({ sunShading: !s.sunShading })),
  openContextMenu: (menu) => set({ contextMenu: menu }),
  closeContextMenu: () => set({ contextMenu: null }),
  setPoint: (point, anchor) =>
    set((s) => {
      // A followed route is kept through the surface view, so its draft stays fixed there too.
      if (s.viewMode === 'navigation' || s.activeRoute) return { selectedPoint: point }
      const slot = setPointSlot(s.routeDraft)
      if (slot === 'choose') {
        return { selectedPoint: point, setPointChooser: { coordinate: point, anchor } }
      }
      return {
        selectedPoint: point,
        setPointChooser: null,
        routeDraft: { ...s.routeDraft, [slot]: point },
      }
    }),
  closeSetPointChooser: () => set({ setPointChooser: null }),
  dismissIntro: () => set({ introDismissed: true }),
}))
