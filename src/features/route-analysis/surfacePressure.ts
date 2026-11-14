import { MARS_SCALE_HEIGHT_KM } from '../../domain'

/**
 * Surface pressure from elevation: the Fact Sheet's mean pressure
 * at mean radius falling off with the scale height. Its own module so the
 * point menu's pressure line needs none of the thermal model.
 */

/** NASA NSSDCA Mars Fact Sheet: "Surface pressure: 6.36 mb at mean radius (variable from 4.0 to 8.7 mb depending on season)". Checked 2026-10-31. */
export const MEAN_SURFACE_PRESSURE_PA = 636
export const MEAN_SURFACE_PRESSURE_SOURCE =
  'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html — "Surface pressure: 6.36 mb at mean radius (variable from 4.0 to 8.7 mb depending on season)" (checked 2026-10-31)'

export function surfacePressurePa(elevationM: number): number {
  return MEAN_SURFACE_PRESSURE_PA * Math.exp(-elevationM / (MARS_SCALE_HEIGHT_KM * 1000))
}

export const SURFACE_PRESSURE_METHOD = `Surface pressure ${MEAN_SURFACE_PRESSURE_PA} Pa × exp(−h / ${MARS_SCALE_HEIGHT_KM} km), the NASA Mars Fact Sheet’s mean pressure at mean radius and scale height, h the point’s elevation; the seasonal cycle (4.0–8.7 mb on the sheet) is not modelled`
