import { derived, unavailable, type Classified, type GeologicUnit, type MarsCoordinate } from '../../domain'
import { distanceAndBearing } from '../route-analysis/distanceAndBearing'
import { shownSlope } from './slopeLimit'
import { NO_RADIATION_REASON, readRadiation, type RadiationReading } from './radiation/radiationMath'
import {
  NO_TEMPERATURE_REASON,
  readTemperature,
  type TemperatureInputs,
  type TemperatureReading,
} from './temperature/temperatureMath'

export { NO_RADIATION_REASON, NO_TEMPERATURE_REASON }

/**
 * The point menu's fields, one classified value each. Pure, so a test
 * can check that no field ever turns into a number it does not have.
 *
 * The coordinate and the distance are computed here; the elevation comes in
 * from the shell's read (below), and the slope from its slope read of the
 * same elevation models, as the stop card's. Temperature is the model estimate for the
 * mission time, with any measurement above it, once the shell hands the
 * model in. The geologic unit comes in from the shell's read of the
 * USGS maps: OFFICIAL with its map's citation, or UNAVAILABLE with the
 * reason, never a nearest unit. Radiation keeps its dose
 * UNAVAILABLE and adds the atmosphere overhead against Gale. The
 * elevation comes in from the shell with it, since the shielding is
 * derived from it and the two rows must agree.
 */
export interface PointFields {
  /** The point as set, in the project's one display format (see `formatMarsCoordinate`). */
  coordinate: Classified<MarsCoordinate>
  elevation: Classified<number>
  /** Degrees, DERIVED from the heights around the point by Horn's method, or UNAVAILABLE with the reason. */
  slope: Classified<number>
  distanceFromDeparture: Classified<number>
  temperature: TemperatureReading
  radiation: RadiationReading
  geologicUnit: Classified<GeologicUnit>
}

/**
 * Where the height is not passed in (`describePoint` without `elevation`):
 * says so, without claiming no lookup exists, since the shell reads it.
 */
export const NO_ELEVATION_REASON =
  'Not read in this panel. In close-up, the point menu shows the height at the selected point, read from the elevation models'

export const READING_ELEVATION_REASON = 'Reading the height at this point from the elevation models'

/** The slope while the shell reads the heights around the point: the point menu's and the stop card's. */
export const READING_SLOPE_REASON = 'Reading the heights around this point to work out its slope'

/** Where the slope is not passed in (`describePoint` without `slope`). */
export const NO_SLOPE_REASON = 'The slope at this point was not read'

/** Where the unit is not passed in (`describePoint` without `geologicUnit`). */
export const NO_GEOLOGIC_UNIT_REASON =
  'The unit at this point was not read'

export const READING_GEOLOGIC_UNIT_REASON = 'Reading the geologic unit at this point from the USGS geologic maps'

const NO_DEPARTURE_REASON = 'No departure set. Set one in the search bar to see the distance'

export function describePoint(
  point: MarsCoordinate,
  departure: MarsCoordinate | null,
  {
    shielding = null,
    elevation,
    slope,
    temperature = null,
    geologicUnit,
  }: {
    /** The atmosphere overhead at this point, as a fraction of Gale's; null while unknown. */
    shielding?: Classified<number> | null
    /**
     * The height at this point, metres, from the shell's elevation read;
     * null while it is being read. Left out where nothing reads it.
     */
    elevation?: Classified<number> | null
    /**
     * The slope at this point, degrees, from the shell's slope read;
     * null while it is being read. Left out where nothing reads it.
     */
    slope?: Classified<number> | null
    /** The mission time, the model and the measurements; null while there is no model. */
    temperature?: TemperatureInputs | null
    /**
     * The unit at this point, from the shell's read of the USGS maps;
     * null while it is being read. Left out where nothing reads it.
     */
    geologicUnit?: Classified<GeologicUnit> | null
  } = {},
): PointFields {
  return {
    // The point is a click on the globe (right-click, or a route field's pick;
    // the same ray as the hover readout), a marked point, or a
    // coordinate the user entered: in the right-click menu's Edit, or in the
    // search bar. The label names them rather than guess.
    coordinate: derived(
      point,
      'The selected point: clicked on the globe (the pick ray), a marked point, or as you entered it in the search bar or the menu',
    ),
    elevation:
      elevation === undefined
        ? unavailable(NO_ELEVATION_REASON)
        : (elevation ?? unavailable(READING_ELEVATION_REASON)),
    slope: slope === undefined ? unavailable(NO_SLOPE_REASON) : shownSlope(slope ?? unavailable(READING_SLOPE_REASON)),
    distanceFromDeparture:
      departure === null
        ? unavailable(NO_DEPARTURE_REASON)
        : distanceAndBearing(departure, point).distanceKm,
    temperature: readTemperature(point, temperature),
    radiation: readRadiation(shielding),
    geologicUnit:
      geologicUnit === undefined
        ? unavailable(NO_GEOLOGIC_UNIT_REASON)
        : (geologicUnit ?? unavailable(READING_GEOLOGIC_UNIT_REASON)),
  }
}
