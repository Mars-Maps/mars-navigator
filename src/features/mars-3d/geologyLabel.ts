import {
  official,
  unavailable,
  type Classified,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
} from '../../domain'
import { areaAt } from './geologyArea'

/** Why no units are drawn yet: not a failure, so it does not open the caption (`captionAlerts`). */
export const GEOLOGY_LOADING_REASON = 'the USGS SIM 3464 units are still loading'

/**
 * What the geology layer says about a point, classified: OFFICIAL
 * with the unit's map as source where a mapped unit covers it, UNAVAILABLE
 * where none does. Never an empty or nearest unit.
 */
export function unitUnder(
  areas: readonly GeologicUnitArea[],
  c: MarsCoordinate,
  /** The areas' source, when the caller has it: the map's citation and how the geometry was simplified. */
  source?: string,
): Classified<GeologicUnit> {
  const area = areaAt(areas, c)
  if (area === null) return unavailable(notOnDetailedMap(areas))
  return official(area.unit, source ?? area.unit.map.citation)
}

/**
 * Why no unit is named: only the detailed map's areas are read here, so a
 * point off them is not a point no map covers. The global map is drawn there.
 */
function notOnDetailedMap(areas: readonly GeologicUnitArea[]): string {
  const id = areas[0]?.unit.map.id ?? 'the detailed map'
  return `${id} has no unit at this point; the coarser global map drawn around it is not read here`
}

/** "Jezero floor unit (Jf)": the map's own name and symbol, as printed. */
export function unitText(unit: GeologicUnit): string {
  return `${unit.name} (${unit.symbol})`
}

/**
 * Each map behind the shown areas once, in first-seen order, for the
 * caption: "USGS SIM 3464, 1:75,000".
 */
export function geologyMaps(areas: readonly GeologicUnitArea[]): { id: string; text: string; citation: string }[] {
  const seen = new Map<string, { id: string; text: string; citation: string }>()
  for (const { unit } of areas) {
    const { id, scaleDenominator, citation } = unit.map
    if (seen.has(id)) continue
    seen.set(id, {
      id,
      text: `USGS ${id}, 1:${scaleDenominator.toLocaleString('en-US')}`,
      citation,
    })
  }
  return [...seen.values()]
}

/** What the colours on screen are, for the caption. */
export function colourNote(areas: readonly GeologicUnitArea[]): string {
  return areas.every((a) => a.unit.color) ? "colours as the map publishes them" : "grey where the map's colour could not be read"
}
