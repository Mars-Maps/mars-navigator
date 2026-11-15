import {
  formatMarsCoordinate,
  HAZARD_NOT_CHECKED,
  isShieldingWarning,
  SHIELDING_WARNING_FRACTION,
  type Classified,
  type Hazard,
  type HazardKind,
} from '../../domain'

/**
 * The hazard kinds in the Hazards panel's own words (mission-ui's
 * HAZARD_LABEL; a test holds the two equal), since the point on the route
 * names the same hazard as the panel's row.
 */
export const HAZARD_POINT_LABEL: Record<HazardKind, string> = {
  slope: 'Steep slope',
  'sudden-drop': 'Sudden drop',
  dust: 'Dust',
  radiation: 'Radiation',
  temperature: 'Temperature',
  'mapped-obstacle': 'Mapped obstacle',
}

/**
 * Whether a hazard gets a point: one that was found, at a place. A
 * hazard with no figure is ground that was not checked (a radiation row
 * over ground with no height, an obstacle on an unread map), which the
 * panel says in words and the route does not mark. A mapped obstacle has
 * no size on its map, so its missing figure is not a missing check.
 */
function isFound(hazard: Hazard): boolean {
  if (hazard.kind === 'mapped-obstacle') return hazard.unit !== HAZARD_NOT_CHECKED
  return hazard.magnitude.classification !== 'UNAVAILABLE'
}

/**
 * The hazards a route draws as points: none for a route not yet scanned
 * (UNAVAILABLE), for no route, or for a scan that found nothing; else each
 * found hazard, in the route's order. Returns the same empty list every
 * time there is nothing to draw.
 */
export function drawnHazards(hazards: Classified<Hazard[]> | null | undefined): readonly Hazard[] {
  if (!hazards || hazards.classification === 'UNAVAILABLE') return NONE
  const found = hazards.value.filter(isFound)
  return found.length > 0 ? found : NONE
}

const NONE: readonly Hazard[] = []

/**
 * What a hazard's point says under the pointer: the kind, its figure in
 * the hazard's own unit, and the place, as the panel's row does. Radiation
 * is the atmosphere overhead as a fraction of Gale's, never a dose.
 */
export function hazardPointName(hazard: Hazard): string {
  const label = HAZARD_POINT_LABEL[hazard.kind]
  const place = formatMarsCoordinate(hazard.coordinate)
  if (hazard.kind === 'mapped-obstacle') return `${label}: ${hazard.unit} · ${place}`
  if (hazard.magnitude.classification === 'UNAVAILABLE') return `${label} · ${place}`
  const value = hazard.magnitude.value
  if (hazard.kind === 'radiation') {
    // Floored, as the panel's figure is, so a value just under the line never reads as on it.
    const shown = (Math.floor(value * 100 + 1e-9) / 100).toFixed(2)
    // The line is read, not assumed, as the panel does: a figure at or over it says only itself.
    const line = isShieldingWarning(value) ? `, under the warning line (${SHIELDING_WARNING_FRACTION.toFixed(2)})` : ''
    return `${label}: atmosphere overhead ${shown} of Gale's${line} · ${place}`
  }
  // Degrees sit against their figure, as the panel prints them.
  if (hazard.unit === '°') return `${label}: ${value.toFixed(1)}° · ${place}`
  return `${label}: ${value.toFixed(1)} ${hazard.unit || 'unit unknown'} · ${place}`
}
