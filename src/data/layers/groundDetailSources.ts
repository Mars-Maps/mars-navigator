import { official, type Classified } from '../../domain'
import type { TileSource } from './tileSource'

/**
 * Imagery finer than the base layers, draped on the surface view's ground.
 * Not a selectable globe layer: the ground takes its brightness
 * from here and its colour from the active satellite layer.
 *
 * OFFICIAL — the Murray Lab (Caltech) global CTX mosaic as NASA Mars Trek
 * catalogues it (product `CTX_beta01_uncontrolled_5m_Caltech`, "MRO CTX,
 * Mosaic Global Uncontrolled (Caltech)"). Trek's WMTSCapabilities for it
 * point at an Esri-hosted tile service: 512 px greyscale PNG tiles on the
 * Trek grid, TileMatrix 0–11. Checked 2026-10-25: tiles fetched at
 * zooms 5, 7, 9, 11 and 12 at 5°S 257.7°E and at both poles, each 512 ×
 * 512 8-bit grey with `Access-Control-Allow-Origin: *`; zoom 13 answers
 * 400. The service's own copyright text: "Source: NASA/JPL/MSSS/Caltech
 * Murray Lab/Esri".
 */

export type GroundDetailId = 'ctx' | 'jezero-hirise' | 'jezero-ctx'

export interface GroundDetailSource extends TileSource {
  id: GroundDetailId
  classification: 'OFFICIAL'
  /** Where the record and the tiles come from. */
  source: string
  licence: string
  /** The credit line the producer asks for. */
  credit: string
  /** What a reader must know before trusting a pixel's place or tone. */
  caveat: string
  /** Resolution of the source product, as the producer states it. */
  sourceResolution: Classified<string>
}

const CTX_TREK_LAYER = 'CTX_beta01_uncontrolled_5m_Caltech'
const CTX_TILES_URL = 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile'

export const CTX_GROUND_DETAIL: GroundDetailSource = {
  id: 'ctx',
  classification: 'OFFICIAL',
  label: 'CTX greyscale mosaic (Murray Lab, Caltech)',
  source:
    `NASA Mars Trek catalogue entry ${CTX_TREK_LAYER}; tiles from the Esri service its ` +
    `capabilities name, ${CTX_TILES_URL}/{z}/{row}/{col}; product page murray-lab.caltech.edu/CTX`,
  licence:
    'The Murray Lab/Caltech grants free use of the V01 mosaic for all purposes and asks that ' +
    'Dickson et al. (2023, Earth and Space Science) be cited; the tiles Trek serves are the ' +
    'earlier beta01 release, to which the lab has published no separate terms. Esri service ' +
    'copyright text: "Source: NASA/JPL/MSSS/Caltech Murray Lab/Esri"',
  credit: 'NASA/JPL/MSSS/The Murray Lab',
  caveat:
    'A preliminary, uncontrolled mosaic: features can sit up to a few hundred metres from ' +
    'where the heights put them, and seams between images show. Greyscale: it carries ' +
    'brightness only, never colour',
  // The served resolution is DERIVED from the zoom, through the adapter's servedResolution.
  sourceResolution: official(
    '5 m/px',
    `Trek product title "${CTX_TREK_LAYER}" (5 m) and its WMTSCapabilities (TileMatrix 0–11, 512 px tiles)`,
  ),
  maxZoom: 11,
  tilePx: 512,
  coverage: { south: -90, north: 90 },
  tileUrl: (zoom, row, col) => `${CTX_TILES_URL}/${zoom}/${row}/${col}`,
}

// Both Jezero mosaics: same producer, terms and paper. The product
// pages ask that their authors be cited; their supplemental link is the
// LPSC 2020 abstract the TRN elevation models cite (demSources.ts).
const TRN_LICENCE = 'Access constraints none; "Please cite authors" (USGS product page, 2026-10-28)'
const TRN_PAPER = 'Fergason, Hare, Mayer et al. 2020, Mars 2020 Terrain Relative Navigation products'

const HIRISE_TREK_LAYER = 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd'
const HIRISE_TILES_URL = `https://trek.nasa.gov/tiles/Mars/EQ/${HIRISE_TREK_LAYER}/1.0.0/default/default028mm`
const HIRISE_PRODUCT_PAGE =
  'https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_orthorectified_image_mosaic'

/**
 * OFFICIAL — the USGS Mars 2020 Terrain Relative Navigation HiRISE
 * orthomosaic of Jezero, 25 cm, as Mars Trek serves it. Checked
 * 2026-10-28 against Trek's WMTSCapabilities: 256 px tiles on the
 * Trek grid, TileMatrix 0–17, bounding box 77.2229331–77.583964°E,
 * 18.3067994–18.669315°N. Tiles fetched at zooms 10, 12, 15 and 17 inside
 * the box: 256 × 256 8-bit grey with alpha, `Access-Control-Allow-Origin:
 * *`; a tile in the box with no image is fully transparent; outside the box
 * and at zoom 18 the service answers 404. Product page (same day): access
 * constraints none, "Please cite authors", 0.25 m/px, 85,600 × 85,952 px,
 * the same 21.4 × 21.5 km box as the 1 m HiRISE DTM (demSources.ts).
 */
export const JEZERO_HIRISE_GROUND_DETAIL: GroundDetailSource = {
  id: 'jezero-hirise',
  classification: 'OFFICIAL',
  label: 'HiRISE orthomosaic of Jezero, 25 cm (USGS)',
  source:
    `NASA Mars Trek layer ${HIRISE_TREK_LAYER}, tiles ${HIRISE_TILES_URL}/{z}/{row}/{col}.png; ` +
    `USGS product page ${HIRISE_PRODUCT_PAGE}`,
  licence: TRN_LICENCE,
  credit: `USGS Astrogeology; NASA/JPL/University of Arizona (HiRISE); ${TRN_PAPER}`,
  caveat:
    'Covers only a 21 km box in Jezero crater (77.22–77.58°E, 18.31–18.67°N), and within it ' +
    'only where HiRISE imaged: elsewhere in the box the tiles are transparent. Greyscale: it ' +
    'carries brightness only, never colour. Made for Mars 2020 Terrain Relative Navigation, 2020',
  sourceResolution: official(
    '0.25 m/px',
    'USGS product page: Pixel Resolution 0.25 m; Trek product title (25cm), TileMatrix 0–17, 256 px tiles',
  ),
  maxZoom: 17,
  tilePx: 256,
  coverage: { south: 18.3067994, north: 18.669315, west: 77.2229331, east: 77.583964 },
  tileUrl: (zoom, row, col) => `${HIRISE_TILES_URL}/${zoom}/${row}/${col}.png`,
}

const JEZ_CTX_TREK_LAYER = 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0'
const JEZ_CTX_TILES_URL = `https://trek.nasa.gov/tiles/Mars/EQ/${JEZ_CTX_TREK_LAYER}/1.0.0/default/default028mm`
const JEZ_CTX_PRODUCT_PAGE =
  'https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_context_camera_orthorectified_image_mosaic'

/**
 * OFFICIAL — the USGS Mars 2020 Terrain Relative Navigation CTX orthomosaic
 * of Jezero, 6 m, as Mars Trek serves it. Checked 2026-10-28
 * against Trek's WMTSCapabilities: 256 px tiles on the Trek grid,
 * TileMatrix 0–13 (zoom 13 is ≈ 5 m/px, finer than the 6 m source),
 * bounding box 77.1604655–77.6991776°E, 18.2110274–18.7211945°N. Tiles
 * fetched at zooms 10 and 13: 256 × 256 8-bit grey with alpha,
 * `Access-Control-Allow-Origin: *`; inside the box fully opaque (corner
 * included), tiles straddling an edge transparent beyond it; one tile
 * past the west or north edge, and zoom 14, answer 404. Product page (same
 * day): access constraints none, "Please cite authors", 6 m/px, 5,322 ×
 * 5,040 px, the same box as the 20 m CTX DTM (demSources.ts).
 */
export const JEZERO_CTX_GROUND_DETAIL: GroundDetailSource = {
  id: 'jezero-ctx',
  classification: 'OFFICIAL',
  label: 'CTX orthomosaic of Jezero, 6 m (USGS)',
  source:
    `NASA Mars Trek layer ${JEZ_CTX_TREK_LAYER}, tiles ${JEZ_CTX_TILES_URL}/{z}/{row}/{col}.png; ` +
    `USGS product page ${JEZ_CTX_PRODUCT_PAGE}`,
  licence: TRN_LICENCE,
  credit: `USGS Astrogeology; NASA/JPL/MSSS (CTX); ${TRN_PAPER}`,
  caveat:
    'Covers only Jezero crater and its rim (77.16–77.70°E, 18.21–18.72°N). Greyscale: it ' +
    'carries brightness only, never colour. Made for Mars 2020 Terrain Relative Navigation, 2020',
  sourceResolution: official(
    '6 m/px',
    'USGS product page: Pixel Resolution 6 m; Trek product title (6m), TileMatrix 0–13, 256 px tiles',
  ),
  maxZoom: 13,
  tilePx: 256,
  coverage: { south: 18.2110274, north: 18.7211945, west: 77.1604655, east: 77.6991776 },
  tileUrl: (zoom, row, col) => `${JEZ_CTX_TILES_URL}/${zoom}/${row}/${col}.png`,
}

/** Finest first: a point takes the first source whose coverage holds it. */
export const GROUND_DETAIL_SOURCES: readonly GroundDetailSource[] = [
  JEZERO_HIRISE_GROUND_DETAIL,
  JEZERO_CTX_GROUND_DETAIL,
  CTX_GROUND_DETAIL,
]
