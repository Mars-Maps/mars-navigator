import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { geologicUnitAreas } from '../data/adapters/GeologyAdapter'
import { ELEVATION_CHAIN } from '../data/elevation/demSources'
import { DEFAULT_SITE } from '../data/sites/sites'
import { derived, type Classified, type GeologicUnitArea, type SiteBounds } from '../domain'
import { CAMERA_FOV_DEG } from '../features/mars-3d/constants'
import { SLOPE_SPACING_CELLS } from '../features/route-analysis/pointSlope'
import { useLandingColours, useMissionStore } from '../state'
import { elevation, profileHeights } from './elevation'
import type { LandingRatingLayer, LandingRatingState } from './landingRatingAt'
import { createLandingRatingStore, layeredRating, oneLayer, readLandingRating, type LandingRatingAsk } from './landingRatingRead'
import { LANDING_VIEW_MAX_KM, landingViewBox } from './landingViewBox'

/**
 * The landing rating over the ground in view, read for the Plan a
 * walk tool: heights on a lattice from the elevation chain, the crater flag
 * from the site's geologic map, rated by `landingFavourability`. Read again
 * each time the camera settles on other ground, over the box that holds the
 * screen (`landingViewBox.ts`), so the colours follow the map. A view too
 * wide for that keeps to the site's map sheet and says so. A failed read,
 * one where a single model failed included, is not kept (`landingRatingRead.ts`).
 */

/**
 * The lattice's least spacing, km: a little over `SLOPE_SPACING_CELLS`
 * cells of the coarsest model in the chain (the 200 m global model today,
 * so 0.41 km), which is what the slope's rule asks for. Finer, and the
 * ground that model covers would have no rating at all. Taken from the
 * chain, so a change of model moves the lattice with it.
 */
export const LANDING_LATTICE_KM = Math.max(...ELEVATION_CHAIN.map((s) => s.cellKm)) * SLOPE_SPACING_CELLS * 1.025

const site = DEFAULT_SITE.site

/** One read of the rating: its box, the lattice's least spacing over it, and what the legend adds. */
interface LandingAsk extends LandingRatingAsk {
  name: string
  bounds: SiteBounds
  spacingKm: number
  note?: string
}

/** The site's own sheet at the lattice's least spacing: what is rated before the camera has settled, and from too far out. */
const SITE_ASK: LandingAsk = { key: 'site', name: site.name, bounds: site.bounds, spacingKm: LANDING_LATTICE_KM }

/** What the legend says while the view is too wide to rate. */
export const LANDING_ZOOM_IN_NOTE = `Zoom in to colour the ground in view: from this far out (a view over ${LANDING_VIEW_MAX_KM.toLocaleString('en-GB')} km across) the colours cover the ${site.map.id} map sheet only.`

/**
 * How long a view must hold before its ground is read, ms: a wheel zoom
 * settles many times on its way, and each read is a request per lattice row.
 */
export const LANDING_VIEW_HOLD_MS = 300

const overlaps = (a: SiteBounds, b: SiteBounds) => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south

/**
 * The site's unit polygons, read once and kept: the map does not change,
 * and every view over the site asks for the same polygons. A failed read is
 * not kept. Not tied to one view's read, so a view left behind does not
 * cancel what the next one is waiting on.
 */
let siteUnits: Promise<Classified<GeologicUnitArea[]>> | null = null
function unitAreas(bounds: SiteBounds): Promise<Classified<GeologicUnitArea[]>> {
  // No ground of the map in the box: nothing is inside the crater, and the map is not asked.
  if (!overlaps(bounds, site.bounds)) return Promise.resolve(derived([], `No ground of the ${site.map.id} map sheet in the box`))
  siteUnits ??= geologicUnitAreas(site.bounds, new AbortController().signal).then((read) => {
    if (read.classification === 'UNAVAILABLE') siteUnits = null
    return read
  })
  return siteUnits
}

const sources = { elevationsAt: (points: Float64Array, s: AbortSignal) => profileHeights.elevationsAt(points, s), unitAreas }

/** The coarsest model of the chain, km: the global one. */
const GLOBAL_CELL_KM = Math.max(...ELEVATION_CHAIN.map((s) => s.cellKm))

/**
 * For a view at cells larger than the lattice's least: the global model
 * alone. A site model a few cells across would be rated on a handful of
 * its heights and ringed by cells with no rating where it meets the global
 * one, a band a whole coarse cell wide; the site's own ground is rated on
 * its models by the sheet's read, laid on top.
 */
const coarseSources = {
  elevationsAt: (points: Float64Array, s: AbortSignal) => elevation.searchElevationsAt(points, s, GLOBAL_CELL_KM),
  unitAreas,
}

/**
 * The site's sheet at the lattice's least spacing, read once and kept as
 * the unit polygons are: neither the heights nor the map change, and every
 * view over the site lays it on top. A failed read is not kept.
 */
let siteLayer: Promise<LandingRatingLayer | string> | null = null
function readSiteLayer(): Promise<LandingRatingLayer | string> {
  siteLayer ??= readLandingRating(SITE_ASK, SITE_ASK.spacingKm, sources).then((read) => {
    if (typeof read === 'string') siteLayer = null
    return read
  })
  return siteLayer
}

const store = createLandingRatingStore<LandingAsk>(async (ask, signal) => {
  if (ask.bounds === site.bounds) {
    const layer = await readSiteLayer()
    return typeof layer === 'string' ? layer : { ...oneLayer(layer), ...(ask.note === undefined ? {} : { note: ask.note }) }
  }
  // A view at cells larger than the sheet's own would rate the site more coarsely than
  // the sheet's read does: the sheet's read goes on top, the view's covers the rest.
  const coarse = ask.spacingKm > LANDING_LATTICE_KM
  const fine = coarse && overlaps(ask.bounds, site.bounds)
  const [view, sheet] = await Promise.all([
    readLandingRating(ask, ask.spacingKm, coarse ? coarseSources : sources, signal),
    fine ? readSiteLayer() : null,
  ])
  if (typeof view === 'string') return view
  if (sheet === null) return oneLayer(view)
  if (typeof sheet === 'string') return sheet
  return layeredRating(sheet, view, `the ${site.map.id} map sheet`)
})

/** The screen's width over its height, for the box that holds the view; 16:9 where there is no window. */
const screenAspect = () => (typeof window === 'undefined' || !(window.innerHeight > 0) ? 16 / 9 : window.innerWidth / window.innerHeight)

/**
 * The rating, read while `active` is true for the ground the camera shows,
 * and drawn on the globe for as long as it is: the colours show while the
 * landing site is being picked and go when the step is left or the tool
 * closes. The rating on show stays until the next view's is in. After a
 * failed read, the next view, or leaving the step and coming back, tries again.
 */
export function useLandingRating(active: boolean): LandingRatingState {
  const state = useSyncExternalStore(store.subscribe, store.snapshot)
  const camera = useMissionStore((s) => s.camera)
  const ask = useMemo<LandingAsk>(() => {
    if (camera === null) return SITE_ASK
    const box = landingViewBox(camera, { fovDeg: CAMERA_FOV_DEG, aspect: screenAspect() }, LANDING_LATTICE_KM)
    if (box === null) return { ...SITE_ASK, key: 'site-zoom-in', note: LANDING_ZOOM_IN_NOTE }
    const { west, east, south, north } = box.bounds
    return {
      key: [west, east, south, north, box.spacingKm].map((v) => v.toFixed(4)).join(','),
      name: 'view',
      bounds: box.bounds,
      spacingKm: box.spacingKm,
    }
  }, [camera])
  useEffect(() => {
    if (!active) return
    const hold = setTimeout(() => store.show(ask), LANDING_VIEW_HOLD_MS)
    return () => clearTimeout(hold)
  }, [active, ask])
  const layers = active && state.status === 'ready' ? state.layers : null
  useEffect(() => {
    if (layers === null) return
    useLandingColours.getState().setLandingColours(layers.map((l) => l.grid))
    return () => useLandingColours.getState().clearLandingColours()
  }, [layers])
  return state
}
