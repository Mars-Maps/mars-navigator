import type { GeologicMap, MissionSite } from '../../domain'
import type { EllipseSource } from '../adapters/SiteAdapter'

/**
 * The Marswalk sites. Adding a site is one more entry
 * here; nothing outside this file names a site.
 *
 * Every figure below was read from the USGS Jezero feature service on
 * 2026-10-28 and is OFFICIAL as stated in `source`,
 * except the centre, which is the midpoint of the landing ellipse's extent
 * and says so. The ellipse itself is read live by `loadLandingEllipse`.
 */

/** USGS SIM 3464, the 1:75,000 map the walk is planned on (PROJECT_BRIEF). */
export const SIM_3464: GeologicMap = {
  id: 'SIM 3464',
  title: 'Geologic map of Jezero crater and the Nili Planum region, Mars',
  scaleDenominator: 75_000,
  citation:
    'Sun, V.Z., and Stack, K.M., 2020, Geologic map of Jezero crater and the Nili Planum region, Mars: U.S. Geological Survey Scientific Investigations Map 3464, https://doi.org/10.3133/sim3464',
}

/** The map's feature service: units, contacts, linear features, craters, landing ellipse, map boundary. */
export const JEZERO_FEATURE_SERVICE =
  'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer'

/** Layer ids on that service, as it lists them. */
export const JEZERO_LAYERS = {
  mapBoundary: 0,
  landingEllipse: 2,
  geologicUnits: 8,
} as const

export const JEZERO: MissionSite = {
  id: 'jezero',
  name: 'Jezero crater',
  mission:
    'Plan a Marswalk from the Mars 2020 landing ellipse: science stops on the mapped geologic units, a route that flags steep ground and mapped obstacles, and the rover’s own path and photos as proven ground.',
  // Midpoint of the LandingEllipse layer's extent, 77.354–77.505°E,
  // 18.399–18.534°N, rounded to 0.001° (about 60 m, far inside the ellipse).
  centre: { latitude: 18.466, longitudeEast: 77.43 },
  // The MapBoundary layer, verbatim.
  bounds: { west: 76.8, east: 77.8, south: 17.7, north: 18.7 },
  map: SIM_3464,
  source: `Bounds: the MapBoundary layer of the USGS SIM 3464 feature service, verbatim (76.8–77.8°E, 17.7–18.7°N). Centre: the midpoint of the LandingEllipse layer's extent (77.354–77.505°E, 18.399–18.534°N), rounded to 0.001°. Both queried in Mars 2000 degrees on 2026-10-28. Map: ${SIM_3464.citation}`,
}

export const JEZERO_ELLIPSE: EllipseSource = {
  serviceUrl: JEZERO_FEATURE_SERVICE,
  layerId: JEZERO_LAYERS.landingEllipse,
  citation: `Mars 2020 landing ellipse, LandingEllipse layer of the USGS SIM 3464 feature service. ${SIM_3464.citation}`,
  bounds: JEZERO.bounds,
}

export interface SiteEntry {
  site: MissionSite
  ellipse: EllipseSource
}

export const SITES: Readonly<Record<'jezero', SiteEntry>> = {
  jezero: { site: JEZERO, ellipse: JEZERO_ELLIPSE },
}

/** The site the app opens on. */
export const DEFAULT_SITE: SiteEntry = SITES.jezero
