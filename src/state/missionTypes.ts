/**
 * The mission store's own types: split from missionStore.ts to keep it
 * under the 500-line limit. Re-exported from there, so importers are unchanged.
 */
import type { Classified, MapLayerId, MarsCoordinate } from '../domain'

/** Sub-panels opened from the right-side icon panel. */
export type SidePanelId = 'layers' | 'compass'

export type ZoomDirection = 'in' | 'out'

/**
 * A zoom button press. The camera (mars-3d) reacts each time `id` changes,
 * so pressing the same direction twice still zooms twice.
 *
 * Contract: the request stays in the store after it is
 * handled, so a subscriber must initialise its last-handled `id` from the
 * current store value when it mounts and act only on later changes.
 * Otherwise a press made before the scene exists replays once on mount.
 */
export interface ZoomRequest {
  direction: ZoomDirection
  id: number
}

/**
 * A "center view" request from the context menu. Same one-shot
 * contract as ZoomRequest: the camera acts when `id`
 * changes, and a subscriber initialises its last-handled `id` from the
 * current store value on mount so an earlier request does not replay.
 */
export interface CenterRequest {
  target: MarsCoordinate
  /** Also fly to this height above the surface, km, within the camera's limits. */
  altitudeKm?: number
  id: number
}

/** A click on the compass dial: turn the globe view so north is up. Same contract as ZoomRequest. */
export interface NorthUpRequest {
  id: number
}

/**
 * What the camera is looking at. Interface state, not data.
 * Written by mars-3d when a drag, zoom or centre settles,
 * not every frame.
 */
export interface CameraView {
  /** Camera height above the mean-radius sphere, km. */
  altitudeKm: number
  /** Surface point at the centre of the view, spin accounted for. */
  target: MarsCoordinate
  /**
   * Degrees clockwise from screen-up to north at the view centre, [0, 360).
   * DERIVED from the camera and the globe's orientation, with the
   * method; UNAVAILABLE with a reason at a pole, where north has no single
   * direction. Reported on settle, like the rest of the view.
   */
  headingDeg: Classified<number>
}

/**
 * The picture on the globe: the active layer's whole-globe image.
 * The app shell loads it through the layer adapter and writes it here; the
 * scene (mars-3d) reads it, so no feature imports `src/data/`. The canvas is
 * OFFICIAL imagery whose provenance is the matching entry in `layers`;
 * `servedResolution` is DERIVED by the adapter from the zoom it fetched,
 * which can be coarser than the source. Where the layer has no data the
 * shell draws the base layer underneath, greyed and dimmed, so colour
 * always means data; `base` says whether it did, and if not, why, so the
 * scene can tell the user instead of leaving them to guess whether the
 * neutral gaps mean "no data" or "base map failed". null until the shell
 * has started a load.
 */
export type SurfaceBase =
  /** The base layer itself: nothing to draw under it. */
  | { status: 'not-needed' }
  /** The named layer is under this one's gaps, greyed. */
  | { status: 'drawn'; layerId: MapLayerId }
  /** Gaps are the shell's neutral fill; the base could not be drawn. */
  | { status: 'unavailable'; reason: string }

export type SurfaceImage =
  | {
      status: 'loading'
      layerId: MapLayerId
      /**
       * What the globe shows meanwhile, when the shell has one: the
       * grey base map alone, no layer values. The caption still says loading.
       */
      placeholder?: HTMLCanvasElement
    }
  | {
      status: 'ready'
      layerId: MapLayerId
      image: HTMLCanvasElement
      sourceResolution: Classified<string>
      servedResolution: Classified<string>
      base: SurfaceBase
      /**
       * A thermal grid layer's picture in two parts, so the globe can
       * lay the base map's detail tiles between them and the crater shows
       * through the colours at close range: `under`, the grey base alone, and
       * `over`, the layer's cells partly see-through with its no-data cells
       * clear. `image` stays the two composed, for everything else. Absent
       * for every other layer, and when the base is not there to go under.
       */
      drape?: { under: HTMLCanvasElement; over: HTMLCanvasElement }
    }
  | { status: 'unavailable'; layerId: MapLayerId; reason: string }

/**
 * The right-click menu, while open. Whoever has a surface pick (the scene)
 * opens it; the menu component only reads this. `anchor` is the pointer
 * position in viewport pixels.
 */
export interface ContextMenuState {
  coordinate: MarsCoordinate
  anchor: { x: number; y: number }
}
