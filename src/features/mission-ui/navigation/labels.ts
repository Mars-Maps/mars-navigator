import type { HazardKind, RouteStrategy } from '../../../domain'

/** "Energy-efficient" is human metabolic cost, not battery energy. */
export const STRATEGY_LABEL: Record<RouteStrategy, string> = {
  fastest: 'Fastest',
  'energy-efficient': 'Energy-efficient (metabolic)',
  scientific: 'Scientific',
  shortest: 'Shortest distance',
}

/** Hazards to a human on the surface, not a rover. */
export const HAZARD_LABEL: Record<HazardKind, string> = {
  slope: 'Steep slope',
  'sudden-drop': 'Sudden drop',
  dust: 'Dust',
  radiation: 'Radiation',
  temperature: 'Temperature',
  'mapped-obstacle': 'Mapped obstacle',
}

/** "radiation" / "radiation and dust" / "a, b and c": hazard kinds in the panel's words, for a scan's coverage line. */
export function listKinds(kinds: readonly HazardKind[]): string {
  const labels = kinds.map((k) => HAZARD_LABEL[k].toLowerCase())
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}
