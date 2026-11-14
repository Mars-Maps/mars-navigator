import type { MarsCoordinate } from './mars'

/**
 * A published geologic map a unit or feature comes from.
 * The USGS Planetary Geologic Mapping Program numbers each map; that
 * number and the map's own suggested citation travel with every unit, so a
 * unit is never shown without its source.
 */
export interface GeologicMap {
  /** USGS publication number as printed, e.g. "SIM 3464". */
  id: string
  title: string
  /** The scale's denominator: 75000 for 1:75,000. */
  scaleDenominator: number
  /** The map's suggested citation, verbatim. */
  citation: string
}

/**
 * One geologic unit, as its map describes it. Text is copied from the map
 * as published, typos included ("Crater riim unit"), never corrected here.
 * Wrapped in Classified at the point of use: OFFICIAL with the map as
 * source, or UNAVAILABLE where no map covers a point.
 */
export interface GeologicUnit {
  /** The map's unit symbol, as printed. */
  symbol: string
  /** The unit's name, e.g. "Jezero floor unit". */
  name: string
  /** The map's description of the unit. Absent when the map gives none. */
  description?: string
  /** The map's interpretation of how the unit formed. Absent when none. */
  interpretation?: string
  /** The fill the map publishes for the unit, "#rrggbb". Absent when it gives none or it could not be read. */
  color?: string
  map: GeologicMap
}

/** A unit's polygon as its map draws it: outer ring first, then holes, 0–360°E. */
export interface GeologicUnitArea {
  unit: GeologicUnit
  rings: MarsCoordinate[][]
}

/**
 * A line a geologic map draws: a ridge crest, a crater rim crest, a delta
 * front. The walk route treats these as mapped obstacles. `kind` is
 * the map's own wording ("ridge crest (type 1), certain"), not a category
 * of ours, so nothing is reinterpreted between the map and the screen.
 */
export interface GeologicLineFeature {
  kind: string
  /** The line's vertices, in order, in the project convention (mars.ts). */
  path: MarsCoordinate[]
  map: GeologicMap
}

/** A point a geologic map marks, such as a small crater. `kind` is the map's wording. */
export interface GeologicPointFeature {
  kind: string
  at: MarsCoordinate
  map: GeologicMap
}

/** An area a geologic map marks, such as "ridged" ground. `kind` is the map's wording. */
export interface GeologicAreaFeature {
  kind: string
  rings: MarsCoordinate[][]
  map: GeologicMap
}

/** Everything a geologic map marks inside one box: what the walk route treats as mapped obstacles. */
export interface GeologicFeatures {
  points: GeologicPointFeature[]
  lines: GeologicLineFeature[]
  areas: GeologicAreaFeature[]
}
