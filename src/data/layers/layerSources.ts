import { official, type Classified, type MapLayer, type MapLayerId } from '../../domain'

/**
 * Where each base map layer comes from.
 *
 * OFFICIAL — every layer is a NASA Mars Trek WMTS product. No API key; tiles
 * are served CORS-open (`Access-Control-Allow-Origin: *` on the tile host,
 * the requesting origin on the ArcGIS host). Layer names, formats, maximum
 * zoom levels and coverage were read from each layer's WMTSCapabilities.xml
 * and the Trek catalogue on 2026-10-19 (geology on 2026-10-28), and a
 * tile was fetched for each. Licences follow the table in
 * DATA_SOURCES.md. Do not add a layer whose
 * source cannot be cited here.
 */

export const TREK_TILES_URL = 'https://trek.nasa.gov/tiles/Mars/EQ'
/**
 * Trek's ArcGIS host. Some products' capabilities (on the tile host above)
 * send tile requests here instead; the geology map is one.
 */
export const TREK_ARCGIS_URL = 'https://trek.nasa.gov/mars/trekarcgis/rest/services'

/** Which Trek host serves a product's tiles, per its capabilities' ResourceURL. */
export type TrekTileHost = 'tiles' | 'arcgis'
const TREK_CATALOGUE_URL = 'https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?key='

const capabilities = (trekLayer: string) =>
  `${TREK_TILES_URL}/${trekLayer}/1.0.0/WMTSCapabilities.xml`

/** The Trek tile URL shapes, one per host: the template for the adapter and the previews. */
export const trekTileUrl = (
  trekLayer: string,
  format: 'jpg' | 'png',
  zoom: number,
  row: number,
  col: number,
  host: TrekTileHost = 'tiles',
) =>
  host === 'tiles'
    ? `${TREK_TILES_URL}/${trekLayer}/1.0.0/default/default028mm/${zoom}/${row}/${col}.${format}`
    : `${TREK_ARCGIS_URL}/${trekLayer}/MapServer/WMTS/tile/1.0.0/${trekLayer}/default/default028mm/${zoom}/${row}/${col}.${format}`

/**
 * Preview for the layer menu: the zoom-1 tile for 0–90°N, 90°W–0° (Chryse,
 * Kasei Valles, the head of Valles Marineris), which every layer serves,
 * the geology map included. 256 × 256 px, one request per layer.
 */
const PREVIEW_TILE = { zoom: 1, row: 0, col: 1 } as const
const preview = (trekLayer: string, format: 'jpg' | 'png', host: TrekTileHost = 'tiles') =>
  trekTileUrl(trekLayer, format, PREVIEW_TILE.zoom, PREVIEW_TILE.row, PREVIEW_TILE.col, host)
const trekDescription = (trekLayer: string, quote: string) =>
  `NASA Mars Trek product description, ${TREK_CATALOGUE_URL}${trekLayer} — "${quote}"`

export interface LayerSource {
  layer: MapLayer
  /** Trek layer identifier, as it appears in the tile URL. */
  trekLayer: string
  /** The host the capabilities' ResourceURL names for this product's tiles. */
  host: TrekTileHost
  /** Tile file extension, from the capabilities' ResourceURL format. */
  format: 'jpg' | 'png'
  /** Highest TileMatrix in the capabilities. Nothing finer exists. */
  maxZoom: number
  /** Resolution of the source product, as the source states it. */
  sourceResolution: Classified<string>
  /**
   * Latitudes the product covers, degrees north. Mars Trek serves no tile
   * for rows wholly outside this band (HTTP 404, not an empty image), so the
   * adapter skips them and leaves those pixels transparent: no data, not a
   * dark surface.
   */
  coverage: { south: number; north: number }
}

const VIKING = 'Mars_Viking_MDIM21_ClrMosaic_global_232m'
const MOLA_SHADED = 'Mars_MGS_MOLA_ClrShade_merge_global_463m'
const THEMIS_DAY = 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018'
const SIM3292_GEOLOGY = 'SIM3292_Global_Geology'

/**
 * One source per layer. A `Record` so a new `MapLayerId` without a source is
 * a type error; `null` would mean "no verified source" and is reported as
 * unavailable by the adapter, never dropped.
 */
export const LAYER_SOURCES: Record<MapLayerId, LayerSource | null> = {
  satellite: {
    layer: {
      id: 'satellite',
      label: 'Satellite (Viking colour mosaic)',
      classification: 'OFFICIAL',
      source: capabilities(VIKING),
      provider: 'NASA Mars Trek',
    licence:
        'Public domain; use constraints: none. ' +
        'Viking colorized mosaic: NASA Ames / USGS Astrogeology',
      caveat: 'Colourized Viking mosaic, not true colour',
      previewUrl: preview(VIKING, 'jpg'),
      legend: {
        kind: 'none',
        reason:
          'A picture of the surface: its colours encode no measured value, ' +
          'so there is no scale to read.',
      },
    },
    trekLayer: VIKING,
    host: 'tiles',
    format: 'jpg',
    maxZoom: 7,
    sourceResolution: official('232 m/px', `Trek layer name ${VIKING}`),
    coverage: { south: -90, north: 90 },
  },
  elevation: {
    layer: {
      id: 'elevation',
      label: 'Elevation (MOLA shaded relief)',
      classification: 'OFFICIAL',
      source: capabilities(MOLA_SHADED),
      provider: 'NASA Mars Trek',
    licence:
        'Public domain; use constraints: none. ' +
        'MOLA shaded relief: NASA GSFC / USGS Astrogeology',
      caveat: 'Elevation-coded colour, not surface colour',
      previewUrl: preview(MOLA_SHADED, 'jpg'),
      legend: {
        kind: 'none',
        reason:
          'Colour shows elevation, but no official scale in metres is ' +
          'published: ASU describes the product only as "colorized by ' +
          'elevation" (https://www.mars.asu.edu/data/mola_color/).',
      },
    },
    trekLayer: MOLA_SHADED,
    host: 'tiles',
    format: 'jpg',
    maxZoom: 7,
    sourceResolution: official('463 m/px', `Trek layer name ${MOLA_SHADED}`),
    coverage: { south: -90, north: 90 },
  },
  thermal: {
    layer: {
      id: 'thermal',
      label: 'Thermal (THEMIS daytime infrared)',
      classification: 'OFFICIAL',
      source: capabilities(THEMIS_DAY),
      provider: 'NASA Mars Trek',
      // Licence: the same registry entry as the night mosaic. USGS
      // says the controlled mosaics were made from both the daytime and the
      // nighttime infrared at 100 m/pixel; the entry states CC0 1.0 and asks
      // for no credit beyond its "How to Cite" line (read 2026-11-09).
      licence:
        'CC0 1.0. NASA / USGS Controlled THEMIS Mosaics, AWS Open Data ' +
        'Registry, doi:10.5066/P96FA04Z',
      // Trek: "Daytime infrared Themis images typically emphasize topography,
      // with warmer sunward slopes being brighter" — a brightness picture.
      caveat:
        'Daytime infrared brightness, not calibrated temperature. ' +
        'No data poleward of 65°',
      previewUrl: preview(THEMIS_DAY, 'png'),
      legend: {
        kind: 'none',
        reason:
          'Brightness is qualitative: USGS calls these mosaics "8-bit (i.e., ' +
          'qualitative) products" and does not recommend them for ' +
          'quantitative analysis ' +
          '(https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/).',
      },
    },
    trekLayer: THEMIS_DAY,
    host: 'tiles',
    format: 'png',
    maxZoom: 9,
    sourceResolution: official(
      '100 m/px',
      trekDescription(THEMIS_DAY, 'orthoprojected at 100 m/pixel scale'),
    ),
    // Trek catalogue bbox: -65.0006576 to 65.0007535.
    coverage: { south: -65, north: 65 },
  },
  geology: {
    layer: {
      id: 'geology',
      label: 'Geology (USGS global geologic map)',
      classification: 'OFFICIAL',
      source: capabilities(SIM3292_GEOLOGY),
      // USGS terms as verified on 2026-10-28: no access
      // constraints, cite the authors. The suggested citation is the
      // publication page's, verbatim.
      provider: 'NASA Mars Trek',
    licence:
        'USGS: no access constraints, cite the authors (verified 2026-10-28). ' +
        'Cite: Tanaka, K.L., Skinner, J.A., Jr., Dohm, J.M., ' +
        'Irwin, R.P., III, Kolb, E.J., Fortezzo, C.M., Platz, T., Michael, G.G., ' +
        'and Hare, T.M., 2014, Geologic map of Mars: USGS Scientific ' +
        'Investigations Map 3292, https://doi.org/10.3133/sim3292',
      caveat:
        'Map units coloured by age and rock type, not surface colour. Mapped ' +
        'at 1:20,000,000, so one unit can span hundreds of km',
      previewUrl: preview(SIM3292_GEOLOGY, 'png', 'arcgis'),
      // The producer's own legend service (44 named units with their
      // swatches), read by the adapter at runtime: nothing is typed in or
      // sampled from the tiles. The map is a USGS work, so showing
      // its swatches is allowed where ASU's bar had to be linked.
      legend: {
        kind: 'categories',
        quantity: 'Geologic unit: age and rock type, as the map names them',
        legendUrl: `${TREK_ARCGIS_URL}/${SIM3292_GEOLOGY}/MapServer/legend?f=json`,
        publicationUrl: 'https://pubs.usgs.gov/sim/3292/',
        source:
          'Legend of USGS SIM 3292 as served by NASA Mars Trek for the map; ' +
          'Tanaka and others (2014), https://doi.org/10.3133/sim3292',
      },
    },
    trekLayer: SIM3292_GEOLOGY,
    host: 'arcgis',
    format: 'png',
    // Capabilities list TileMatrix 0–11; the map is drawn from vectors, so
    // unit boundaries stay crisp at every zoom though no new unit appears
    // past about zoom 3 (1:20M at 0.28 mm/px is ~5.6 km/px). The overhead
    // map and the ground patch take this as their zoom ceiling too, so they
    // may fetch 20 m/px tiles of flat colour: cheap (about 1 KB each).
    maxZoom: 11,
    sourceResolution: official(
      '1:20,000,000 map scale',
      'USGS SIM 3292, https://pubs.usgs.gov/sim/3292/ — "scale 1:20,000,000"',
    ),
    coverage: { south: -90, north: 90 },
  },
}

const THEMIS_NIGHT = 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018'

/**
 * The thermal layer's night mosaic: a variant of `thermal`, not a
 * fifth layer, so it sits outside `LAYER_SOURCES` and the record keeps one
 * source per layer id. The user chooses Day or Night; nothing switches it.
 * Format, zoom 9 and coverage read from its WMTSCapabilities.xml on
 * 2026-10-27, and a zoom-1 tile fetched. Licence: the DOI resolves to the
 * AWS Open Data Registry entry, which states CC0 1.0.
 */
export const THERMAL_NIGHT_SOURCE: LayerSource = {
  layer: {
    id: 'thermal',
    label: 'Thermal (THEMIS night infrared)',
    classification: 'OFFICIAL',
    source: capabilities(THEMIS_NIGHT),
    provider: 'NASA Mars Trek',
    licence:
      'CC0 1.0. NASA / USGS Controlled THEMIS Mosaics, AWS Open Data ' +
      'Registry, doi:10.5066/P96FA04Z',
    // Trek: "Nighttime Themis images emphasize differences in thermal
    // inertia between areas being observed" — still a brightness picture.
    caveat:
      'Pre-dawn infrared brightness, qualitative, not calibrated temperature. ' +
      'No data poleward of 65°, and straight-edged gaps within it where the ' +
      'mosaic has no image: the grey there is the base map, not cold ground',
    previewUrl: preview(THEMIS_NIGHT, 'png'),
    legend: {
      kind: 'none',
      reason:
        'Brightness is qualitative: USGS calls these mosaics "8-bit (i.e., ' +
        'qualitative) products" and does not recommend them for ' +
        'quantitative analysis ' +
        '(https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/).',
    },
  },
  trekLayer: THEMIS_NIGHT,
  host: 'tiles',
  format: 'png',
  maxZoom: 9,
  sourceResolution: official(
    '100 m/px',
    trekDescription(THEMIS_NIGHT, 'orthoprojected at 100 m/pixel scale'),
  ),
  // WMTS bounding box: -65.0006576 to 65.0007535.
  coverage: { south: -65, north: 65 },
}
