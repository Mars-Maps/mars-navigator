import { official, type Classified } from '../../domain'

/**
 * The digital elevation models the elevation adapter can read.
 * Both are USGS Astrogeology GeoTIFFs served from one S3
 * bucket that allows cross-origin range reads, so a height is a two-byte
 * request and nothing is downloaded whole. Both are uncompressed signed
 * 16-bit metres, one row per strip, rows contiguous: the byte of a pixel is
 * arithmetic from its row and column. The adapter checks that layout against
 * the file's own TIFF directory before the first read; the figures here are
 * what it expects, measured on 2026-10-25 and, for the 463 m file,
 * 2026-10-23.
 *
 * `ELEVATION_SOURCE` is the global one in use. Switching is a one-line change here.
 *
 * `SITE_DEM_SOURCES` are finer models of one site, from the same
 * bucket and read the same way, but float32 metres on a regional grid laid
 * out in metres; `ELEVATION_CHAIN` puts them in front of the global one.
 */

export type DemSourceId = 'hrsc-mola-blend-200m' | 'mola-463m' | 'jezero-hirise-1m' | 'jezero-ctx-20m'

/**
 * Where the grid lies. `global`: equirectangular in degrees, 180°W to 180°E
 * and 90°N to 90°S. `regional`: equirectangular in metres on a sphere of
 * `radiusM` (x = R·λ, y = R·φ, standard parallel 0), cell (0, 0)'s outer
 * corner at (`westM`, `northM`), pixel-is-area, as the file's GeoTIFF tags
 * state.
 */
export type DemExtent =
  | { kind: 'global' }
  | { kind: 'regional'; westM: number; northM: number; cellM: number; radiusM: number }

const GLOBAL: DemExtent = { kind: 'global' }

export interface DemSource {
  id: DemSourceId
  /** Short product name for captions. */
  label: string
  /** Read from here: the S3 object the published URL redirects to, so a lookup does not pay for the redirect. */
  url: string
  /** The URL USGS publishes, which redirects to `url`. */
  publishedUrl: string
  productPage: string
  tiff: 'classic' | 'bigtiff'
  widthPx: number
  heightPx: number
  /** Whole-file size in bytes, checked against the server's Content-Range. */
  fileBytes: number
  /** How a cell is stored, little-endian: signed 16-bit or 32-bit float metres. */
  sample: 'int16' | 'float32'
  extent: DemExtent
  /** Byte offset of row 0, column 0. Row r starts at `firstRowOffset + r * widthPx * bytesPerSample`. */
  firstRowOffset: number
  /** The sample value meaning "no height here". */
  noData: number
  /** Ground size of one cell, as the product states it. */
  resolution: Classified<string>
  /** The same at the equator, km: the finest spacing worth sampling a path at. */
  cellKm: number
  /** What a height is measured from. */
  datum: string
  /** Stated vertical uncertainty, quoted, never improved on. */
  uncertainty: string
  licence: string
  /** Credit to show wherever a height from this product is shown. */
  attribution: string
  /** What a reader must know before trusting a value. */
  caveat: string
}

const S3 = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic'

/** The global DEMs. */
export const DEM_SOURCES: Record<'hrsc-mola-blend-200m' | 'mola-463m', DemSource> = {
  'hrsc-mola-blend-200m': {
    id: 'hrsc-mola-blend-200m',
    label: 'HRSC–MOLA blended DEM v2, 200 m',
    url: `${S3}/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif`,
    publishedUrl:
      'https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif',
    productPage:
      'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m',
    tiff: 'bigtiff',
    sample: 'int16',
    extent: GLOBAL,
    widthPx: 106694,
    heightPx: 53347,
    fileBytes: 11_384_463_908,
    firstRowOffset: 854_272,
    noData: -32768,
    resolution: official('200 m/px', 'USGS product page: "Resolution is 200 meters per pixel"'),
    cellKm: 0.2,
    datum: 'metres above the areoid MOLA uses, on the Mars 2000 sphere (3,396,190 m)',
    uncertainty:
      "at least ±3 m (the MOLA base; the product page quotes no separate figure for the HRSC part); against the rovers' own waypoint heights (live feeds read 2026-11-07, model minus rover): Perseverance at Jezero median +12.0 m, 95% within 50.4 m, worst +87.0 m over 708 waypoints; Curiosity at Gale median +1.0 m, 95% within 23.5 m, worst −40.0 m over 1,386",
    licence: 'MOLA CC0; HRSC CC BY-SA 3.0 IGO; "please cite authors" (USGS product page, 2026-10-25)',
    attribution: 'USGS Astrogeology, NASA GSFC (MOLA), ESA/DLR/FU Berlin (HRSC); Fergason, Hare and Laura 2018',
    caveat:
      'HRSC stereo detail where Mars Express covered the ground and MOLA 463 m elsewhere, with no mark saying which. MOLA gaps were filled by interpolation by the producer. Nothing smaller than a 200 m cell is resolved',
  },
  'mola-463m': {
    id: 'mola-463m',
    label: 'MOLA DEM, 463 m',
    url: `${S3}/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`,
    publishedUrl: 'https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif',
    productPage: 'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m',
    tiff: 'classic',
    sample: 'int16',
    extent: GLOBAL,
    widthPx: 46080,
    heightPx: 23040,
    fileBytes: 2_125_771_142,
    firstRowOffset: 184_973,
    noData: -32768,
    resolution: official('463 m/px', 'USGS product page: 128 pixels per degree'),
    cellKm: 0.463,
    datum: 'metres above the areoid GMM-2B, on the Mars 2000 sphere (3,396,190 m)',
    uncertainty: 'at least ±3 m (USGS product page)',
    licence: 'CC0, use constraints none (USGS product page, 2026-10-18)',
    attribution: 'MOLA Team, NASA GSFC; USGS Astrogeology',
    caveat:
      'About 55% of equatorial cells hold a laser shot; the rest were filled by interpolation by the producer, unmarked. Nothing smaller than a 463 m cell is resolved',
  },
}

/** The product in use. */
export const ELEVATION_SOURCE: DemSource = DEM_SOURCES['hrsc-mola-blend-200m']

/** Bytes per cell. */
export const bytesPerSample = (s: DemSource): number => (s.sample === 'float32' ? 4 : 2)

const MARS_2000_RADIUS_M = 3_396_190
const TRN = `${S3}/mars2020_trn`
const TRN_ATTRIBUTION =
  'USGS Astrogeology; NASA/JPL/University of Arizona (HiRISE), NASA/JPL/MSSS (CTX); Fergason, Hare, Mayer et al. 2020, Mars 2020 Terrain Relative Navigation products'
const TRN_LICENCE = 'Access constraints none; "Please cite authors" (USGS product pages, 2026-10-28)'
// GDAL's no-data tag in both files, verbatim: the lowest float32, written as a double.
const TRN_NO_DATA = -3.40282265508890445e38

/**
 * The Mars 2020 landing-site models of Jezero crater, made by USGS for
 * the rover's Terrain Relative Navigation. Measured on 2026-10-28 from the
 * files' own TIFF tags: uncompressed float32, one row per strip, rows
 * contiguous. Both are heights above the MOLA areoid ("MOLAtopography_
 * DeltaGeoid" in the names), the datum of the global DEMs.
 */
export const SITE_DEM_SOURCES: Record<'jezero-hirise-1m' | 'jezero-ctx-20m', DemSource> = {
  'jezero-hirise-1m': {
    id: 'jezero-hirise-1m',
    label: 'HiRISE DTM mosaic of Jezero, 1 m',
    url: `${TRN}/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif`,
    publishedUrl:
      'https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif',
    productPage: 'https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic',
    tiff: 'classic',
    sample: 'float32',
    extent: { kind: 'regional', westM: 4_577_366, northM: 1_106_618, cellM: 1, radiusM: MARS_2000_RADIUS_M },
    widthPx: 21400,
    heightPx: 21488,
    fileBytes: 1_839_545_409,
    firstRowOffset: 172_609,
    noData: TRN_NO_DATA,
    resolution: official('1 m/px', 'USGS product page: Pixel Resolution 1 m; GeoTIFF pixel scale 1.0 m'),
    cellKm: 0.001,
    datum: 'metres above the MOLA areoid, on the Mars 2000 sphere (3,396,190 m)',
    uncertainty:
      `"Accurate to Control Net" (USGS product page); median offset from the CTX model about 0.4 m; against the rovers' own waypoint heights (live feeds read 2026-11-07, model minus rover): Perseverance median +0.0 m, 85% within 0.5 m, 95% within 4.2 m, worst +5.4 m over 612 waypoints. The feed's heights look to share this model's source, so this is agreement, not an independent check`,
    licence: TRN_LICENCE,
    attribution: TRN_ATTRIBUTION,
    caveat:
      'Covers only where HiRISE stereo pairs were taken: about a third of its box is no-data (measured 2026-10-28), where the CTX model is used. Built for landing navigation, 2020',
  },
  'jezero-ctx-20m': {
    id: 'jezero-ctx-20m',
    label: 'CTX DTM mosaic of Jezero, 20 m',
    url: `${TRN}/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif`,
    publishedUrl:
      'https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif',
    productPage: 'https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic',
    tiff: 'classic',
    sample: 'float32',
    extent: { kind: 'regional', westM: 4_573_663.250853, northM: 1_109_693.140188, cellM: 20, radiusM: MARS_2000_RADIUS_M },
    widthPx: 1596,
    heightPx: 1512,
    fileBytes: 9_662_387,
    firstRowOffset: 9779,
    noData: TRN_NO_DATA,
    resolution: official('20 m/px', 'USGS product page: Pixel Resolution 20 m; GeoTIFF pixel scale 20.0 m'),
    cellKm: 0.02,
    datum: 'metres above the MOLA areoid, on the Mars 2000 sphere (3,396,190 m)',
    uncertainty:
      `"Accurate to Control Net" (USGS product page); about 0.4 m above the HiRISE model, median; against the rovers' own waypoint heights (live feeds read 2026-11-07, model minus rover): Perseverance median −1.1 m, 95% within 7.2 m, worst +11.0 m over 708 waypoints`,
    licence: TRN_LICENCE,
    attribution: TRN_ATTRIBUTION,
    caveat: 'Covers Jezero crater and its rim only (77.16–77.70°E, 18.21–18.72°N). Built as the lander vision map, 2020',
  },
}

/**
 * Finest first: a height comes from the first model with data at the
 * point, so Jezero gets 1 m or 20 m cells and everywhere else the global DEM.
 */
export const ELEVATION_CHAIN: readonly DemSource[] = [
  SITE_DEM_SOURCES['jezero-hirise-1m'],
  SITE_DEM_SOURCES['jezero-ctx-20m'],
  ELEVATION_SOURCE,
]
