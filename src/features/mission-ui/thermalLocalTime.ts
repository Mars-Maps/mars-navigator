import {
  derived,
  formatMarsCoordinate,
  isAvailable,
  localTrueSolarTimeHours,
  MARS24_METHOD,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type MarsSolarTime,
} from '../../domain'

/** Within this of a pole every longitude meets, so no local time is one place's. */
const POLE_MARGIN_DEG = 0.5

/**
 * The thermal layer's local-time hint: local true solar time at the
 * view centre, hours 0–24, DERIVED from Mars24. A hint for picking the Day or
 * Night mosaic only; nothing switches on it, because neither mosaic shows the
 * surface at this hour.
 */
export function thermalLocalTime(
  solar: Classified<MarsSolarTime>,
  centre: MarsCoordinate | null,
): Classified<number> {
  if (!isAvailable(solar)) return unavailable(solar.reason)
  if (centre === null) {
    return unavailable('The view centre is not known until the camera first settles')
  }
  if (Math.abs(centre.latitude) > 90 - POLE_MARGIN_DEG) {
    return unavailable('At a pole every longitude meets, so there is no single local time')
  }
  return derived(
    localTrueSolarTimeHours(solar.value, centre.longitudeEast),
    `Local true solar time at the view centre (${formatMarsCoordinate(centre)}): ` +
      `local mean solar time plus the equation of time. ${MARS24_METHOD}`,
  )
}
