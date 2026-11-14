import type { Classified, GeologicUnitArea, MapLayer, MapLayerId, MarsSolarTime, RoverTraverse } from '../../domain'
import type { SurfaceImage } from '../../state'
import { GEOLOGY_LOADING_REASON } from './geologyLabel'
import { TRAVERSE_LOADING_REASON, isTraverseRetrying } from './traverseLabel'

/**
 * What the surface caption is showing that a user should know about:
 * every error and caveat, one key each. The caption starts minimized and
 * opens itself only when a failure key appears that was not there before,
 * so a failed read is never silent; caveats and the route line stay
 * behind the info button, and a failure already seen does not reopen it
 * after the user minimizes it again.
 */
export function captionAlerts({
  surface,
  layers,
  activeLayerId,
  routeLine,
  sun,
  traverse = null,
  geology = null,
}: {
  surface: SurfaceImage | null
  layers: readonly MapLayer[]
  activeLayerId: MapLayerId
  routeLine: boolean
  sun: Classified<MarsSolarTime>
  /** The rover path: a failed read is an alert, one still loading is not. */
  traverse?: Classified<RoverTraverse> | null
  /** The detailed units while their layer is active: the same rule. */
  geology?: Classified<GeologicUnitArea[]> | null
}): string[] {
  const alerts: string[] = []
  if (surface?.status === 'unavailable') alerts.push(`layer-unavailable:${surface.layerId}`)
  if (surface?.status === 'ready' && surface.base.status === 'unavailable') {
    alerts.push(`base-unavailable:${surface.layerId}`)
  }
  if (sun.classification === 'UNAVAILABLE') alerts.push('sun-unavailable')
  if (traverse?.classification === 'UNAVAILABLE' && traverse.reason !== TRAVERSE_LOADING_REASON && !isTraverseRetrying(traverse.reason)) {
    alerts.push('traverse-unavailable')
  }
  if (geology?.classification === 'UNAVAILABLE' && geology.reason !== GEOLOGY_LOADING_REASON) alerts.push('geology-unavailable')
  // Keyed on the chosen layer, not the loaded image, so reloading the same
  // layer is not a new caveat. Unknown until the catalogue arrives.
  const caveat = layers.find((l) => l.id === activeLayerId)?.caveat
  if (typeof caveat === 'string') alerts.push(caveatAlert(activeLayerId))
  // The dotted trail reads as a planned route without its note.
  if (routeLine) alerts.push('route-line')
  return alerts
}

/** The key for a layer's caveat. */
export function caveatAlert(layerId: MapLayerId): string {
  return `caveat:${layerId}`
}

/** The keys that mean a read failed, as opposed to a caveat or a note. */
export function isFailureAlert(alert: string): boolean {
  return (
    alert.startsWith('layer-unavailable:') ||
    alert.startsWith('base-unavailable:') ||
    alert === 'sun-unavailable' ||
    alert === 'traverse-unavailable' ||
    alert === 'geology-unavailable'
  )
}

/**
 * Whether the caption should open: `next` has a failure key `previous`
 * lacks. A layer's caveat or the route line's note never opens it,
 * whether at load or on a layer change; they wait behind the info button,
 * which the user opens when they want the provenance.
 */
export function opensCaption(previous: readonly string[], next: readonly string[]): boolean {
  return next.some((a) => isFailureAlert(a) && !previous.includes(a))
}

/**
 * Whether the caption minimizes as navigation starts: the route
 * column needs its height, and the route line's note is on the selected
 * option's DERIVED mark in the destination bar. A layer or sun error keeps
 * it open, since nothing else on screen says so.
 */
export function minimizesForNavigation(alerts: readonly string[]): boolean {
  return !alerts.some(
    (a) =>
      a.startsWith('layer-unavailable:') ||
      a.startsWith('base-unavailable:') ||
      a === 'sun-unavailable',
  )
}
