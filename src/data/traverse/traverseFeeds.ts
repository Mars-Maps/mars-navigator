import type { RoverId } from '../../domain'

/**
 * NASA's published rover waypoints: the MMGIS feeds
 * behind the mission's "Where is the rover?" maps. Live, updated as the
 * rovers drive, and with no licence stated, so they are read at runtime
 * and never committed (DATA_INTEGRATION, rover paths column).
 */
export interface TraverseFeed {
  rover: RoverId
  url: string
  /** What the UI credits, with the feed URL. */
  credit: string
  /** What this feed's `elev_geoid` measures, and how that was established for this rover. */
  elevationDatum: string
}

const MMGIS = 'https://mars.nasa.gov/mmgis-maps'

export const TRAVERSE_FEEDS: Readonly<Record<RoverId, TraverseFeed>> = {
  perseverance: {
    rover: 'perseverance',
    url: `${MMGIS}/M20/Layers/json/M20_waypoints.json`,
    credit: 'NASA/JPL-Caltech, Mars 2020 rover waypoints',
    elevationDatum: 'elev_geoid: metres above the MOLA areoid (Mars 2020 PLACES SIS §3.9.3)',
  },
  curiosity: {
    rover: 'curiosity',
    url: `${MMGIS}/MSL/Layers/json/MSL_waypoints.json`,
    credit: 'NASA/JPL-Caltech, Mars Science Laboratory rover waypoints',
    elevationDatum:
      'elev_geoid: metres above the MOLA areoid. The MSL feed has no PLACES SIS of its own in the project; its heights were checked against the Trek DEM at Bradbury Landing and agree within 3 m',
  },
}

/** The feeds' no-data value, for heights and tilt alike (PLACES SIS). */
export const FEED_NO_DATA = -9999

/**
 * What `tilt` is taken to be. The feeds give it in degrees with -9999 for
 * none; no PLACES SIS definition of the field was verified, so the
 * source says so rather than citing a page.
 */
export const TILT_SOURCE = "tilt: the feed's own field, taken as degrees from level; no PLACES SIS definition was verified for it"
