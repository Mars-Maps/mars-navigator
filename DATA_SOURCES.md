# Data sources

Every external dataset and service the app uses, with the credit and licence
recorded for it. The authoritative copy of each credit is the code next to
the source (`src/data/**`), which is also what the interface shows; this file
collects them in one place. Dates are when a source was last checked.

Rules that apply to all of them:

1. The source URL, citation and licence are recorded in code next to every
   value or layer. A source that cannot be cited is not added.
2. Stated uncertainty is quoted rather than implying precision.
3. Resolution is a limit: a 200 m model cannot answer a question about a
   10 m slope, and the interface says so instead of interpolating.
4. A missing value is `UNAVAILABLE`, never zero or an estimate presented as
   a measurement.
5. Live feeds whose terms do not allow redistribution are read at runtime
   and never committed.

All services below answer cross-origin requests from a browser and need no
API key.

## Base map layers (NASA Mars Trek)

NASA Solar System Treks, Mars Trek: OGC WMTS, no key.

```
https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.{jpg|png}
```

Defined in `src/data/layers/layerSources.ts`, loaded by `LayerAdapter`.

| Layer | Trek product | Max zoom | Coverage | Licence and credit | Caveat shown |
|---|---|---|---|---|---|
| Satellite | `Mars_Viking_MDIM21_ClrMosaic_global_232m` (USGS Viking colourized global mosaic, 232 m) | 7 | global | Public domain; use constraints: none. "Viking colorized mosaic: NASA Ames / USGS Astrogeology" | Colourized Viking mosaic, not true colour |
| Elevation | `Mars_MGS_MOLA_ClrShade_merge_global_463m` (USGS MGS MOLA global colour shaded relief, 463 m) | 7 | global | Public domain; use constraints: none. "MOLA shaded relief: NASA GSFC / USGS Astrogeology" | Elevation-coded colour, not surface colour |
| Thermal (day) | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | 9 | 65°S–65°N | CC0 1.0. "NASA / USGS Controlled THEMIS Mosaics", AWS Open Data Registry, doi:10.5066/P96FA04Z (https://registry.opendata.aws/nasa-usgs-themis-mosaics) | Daytime infrared brightness, not calibrated temperature |
| Thermal (night) | `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` | 9 | 65°S–65°N, with gaps | Same registry entry, CC0 1.0 | Pre-dawn infrared brightness, qualitative; gaps show the base map |
| Geology | `SIM3292_Global_Geology` (USGS Geologic Map of Mars, 1:20,000,000) | 11 | global | USGS: no access constraints, cite the authors. Tanaka, K.L., Skinner, J.A., Jr., Dohm, J.M., Irwin, R.P., III, Kolb, E.J., Fortezzo, C.M., Platz, T., Michael, G.G., and Hare, T.M., 2014, Geologic map of Mars: U.S. Geological Survey Scientific Investigations Map 3292, scale 1:20,000,000, https://doi.org/10.3133/sim3292 | Units coloured by age and rock type, not surface colour; one unit can span hundreds of km |

Notes:

- The geology product is served from Trek's ArcGIS host
  (`trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/…`),
  256 px PNG. Its `legend?f=json` lists the 44 unit names with their
  swatches; the adapter reads it at runtime for the legend.
- USGS calls the THEMIS mosaics "8-bit (i.e., qualitative) products" and does
  not recommend them for quantitative analysis
  (https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/),
  so they have no numeric legend.
- The elevation layer has no numeric legend either: no official scale in
  metres is published, and ASU describes the product only as "colorized by
  elevation" (https://www.mars.asu.edu/data/mola_color/).
- Trek answers HTTP 404, not an empty tile, for a tile row wholly outside a
  product's coverage. The adapter skips those rows and leaves them
  transparent; a failed tile inside coverage fails the image. Where a layer
  has no data the Viking mosaic is drawn underneath in greyscale and the
  caption says so; nothing is interpolated.
- The tiles are pictures: no point query reads a temperature, elevation or
  abundance from them.
- Mars Trek's tile service itself publishes no licence; the products it
  serves are the ones credited above.
- Product descriptions quoted in the interface cite Trek's catalogue entry
  for the product (`trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?key=<product>`);
  the app does not call it at runtime.

## Ground imagery for close zoom and the surface view

Defined in `src/data/layers/groundDetailSources.ts`.

| Product | Service | Licence | Credit | Caveat |
|---|---|---|---|---|
| CTX global mosaic, Murray Lab (Caltech), beta01 uncontrolled, 5 m source (Trek catalogue `CTX_beta01_uncontrolled_5m_Caltech`) | `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{row}/{col}`, 512 px greyscale PNG, zoom 0–11 | The Murray Lab/Caltech grants free use of the V01 mosaic for all purposes and asks that Dickson et al. (2023, Earth and Space Science) be cited; no separate terms are published for beta01. Esri service copyright text: "Source: NASA/JPL/MSSS/Caltech Murray Lab/Esri" | NASA/JPL/MSSS/The Murray Lab | Preliminary and uncontrolled: features can sit a few hundred metres from where the heights put them; seams show; greyscale, so it supplies brightness only |
| USGS Mars 2020 Terrain Relative Navigation HiRISE orthomosaic of Jezero, 25 cm | Mars Trek WMTS, zoom 0–17, 77.2229331–77.583964°E, 18.3067994–18.669315°N | Access constraints none; "Please cite authors" (USGS product page, 2026-10-28) | USGS Astrogeology; NASA/JPL/University of Arizona (HiRISE); Fergason, Hare, Mayer et al. 2020, Mars 2020 Terrain Relative Navigation products | Covers the box above only |
| USGS Mars 2020 Terrain Relative Navigation CTX orthomosaic of Jezero, 6 m | Mars Trek WMTS, zoom 0–13, 77.1604655–77.6991776°E, 18.2110274–18.7211945°N | Same | USGS Astrogeology; NASA/JPL/MSSS (CTX); Fergason, Hare, Mayer et al. 2020 | Covers the box above only |

Product pages:
https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_orthorectified_image_mosaic,
https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_context_camera_orthorectified_image_mosaic,
murray-lab.caltech.edu/CTX.

## Elevation

USGS Astrogeology GeoTIFFs, read in place by HTTP range request
(`DemElevationAdapter`): uncompressed, one row per strip, so a height is a
few bytes and nothing is downloaded whole. Defined in
`src/data/elevation/demSources.ts`; `ELEVATION_CHAIN` tries the finest model
first. Heights are metres above the MOLA areoid on the Mars 2000 sphere
(3,396,190 m).

| Model | File | Licence | Attribution |
|---|---|---|---|
| HRSC–MOLA blended DEM v2, 200 m (global, in use) | `https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif` | MOLA CC0; HRSC CC BY-SA 3.0 IGO; "please cite authors" (USGS product page, 2026-10-25). Share-alike applies to anything derived and redistributed from these heights | USGS Astrogeology, NASA GSFC (MOLA), ESA/DLR/FU Berlin (HRSC); Fergason, Hare and Laura 2018 |
| MOLA DEM, 463 m (global, described as a fallback) | `https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif` | CC0, use constraints none (USGS product page, 2026-10-18) | MOLA Team, NASA GSFC; USGS Astrogeology |
| HiRISE DTM mosaic of Jezero, 1 m (Mars 2020 TRN) | `https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif` | Access constraints none; "Please cite authors" (USGS product pages, 2026-10-28) | USGS Astrogeology; NASA/JPL/University of Arizona (HiRISE), NASA/JPL/MSSS (CTX); Fergason, Hare, Mayer et al. 2020, Mars 2020 Terrain Relative Navigation products |
| CTX DTM mosaic of Jezero, 20 m (Mars 2020 TRN) | `https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif` | Same | Same |

Product pages:
https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m,
https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m,
https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic,
https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic.

The MOLA team states a total elevation uncertainty of at least ±3 m. The
1 m model covers only where HiRISE stereo pairs exist (about a third of its
box is no-data); the 20 m model is used there.

### Models against the rovers' own heights

`npm run datum-check` compares every waypoint of the live rover feeds
(`elev_geoid`) with the nearest cell of each model, through the app's own
adapters. DERIVED: model minus rover, neither corrected. Feeds read
2026-11-07: Perseverance 708 waypoints (sols 13–2022), Curiosity 1,386
(sols 3–5045).

| Rover | Model | Compared | Median | Median abs. | 95% within | Worst |
|---|---|---|---|---|---|---|
| Perseverance | HiRISE DTM of Jezero, 1 m | 612 | +0.0 m | 0.0 m | 4.2 m | +5.4 m |
| Perseverance | CTX DTM of Jezero, 20 m | 708 | −1.1 m | 2.3 m | 7.2 m | +11.0 m |
| Perseverance | HRSC–MOLA blend, 200 m | 708 | +12.0 m | 13.9 m | 50.4 m | +87.0 m |
| Curiosity | HRSC–MOLA blend, 200 m | 1,386 | +1.0 m | 9.0 m | 23.5 m | −40.0 m |

Each model's `uncertainty` text in `demSources.ts` states its own row, and
every height's provenance line quotes it. No height is corrected by these
figures. The 1 m agreement suggests the feed's heights share that model's
source, so it is agreement, not an independent check.

## Geology at the site (USGS SIM 3464)

`src/data/geology/geologySources.ts`, `GeologyAdapter`, `SiteAdapter`.

- Service:
  `https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer`.
  Geologic units (layer 8), location features (layer 4), linear features
  (layer 6), surface features (layer 7), map boundary (layer 0), landing
  ellipse (layer 2). Queried with `outSR=104971` for Mars 2000 degrees
  (planetocentric, ±180°, normalized to 0–360°E by the adapter).
- Citation: Sun, V.Z., and Stack, K.M., 2020, Geologic map of Jezero crater
  and the Nili Planum region, Mars: U.S. Geological Survey Scientific
  Investigations Map 3464, https://doi.org/10.3133/sim3464
- Licence: USGS, no access constraints, cite the authors. The web service is
  "for viewing purposes only", so nothing from it is committed: the site's
  bounds and centre are two figures in `src/data/sites/sites.ts` with the
  query date, and everything else is read live.
- Unit polygons are simplified by the service to 0.0005° (about 30 m) and the
  source string says so. Text is the map's, verbatim, typos included. A point
  on a contact is `UNAVAILABLE`.
- Off the Jezero sheet, the unit under a point comes from SIM 3292 on Mars
  Trek (credited above).

## Rover paths

`src/data/traverse/traverseFeeds.ts`, `TraverseAdapter`.

- `https://mars.nasa.gov/mmgis-maps/{M20,MSL}/Layers/json/*_waypoints.json`
  (GeoJSON). Credit: "NASA/JPL-Caltech, Mars 2020 rover waypoints" and
  "NASA/JPL-Caltech, Mars Science Laboratory rover waypoints".
- Longitude east-positive, −360 to +360; planetocentric latitude;
  `elev_geoid` in metres above the MOLA areoid (Mars 2020 PLACES SIS §3.9.3,
  https://pds-geosciences.wustl.edu/m2020/urn-nasa-pds-mars2020_rover_places/document/Mars2020_Rover_PLACES_PDS_SIS.pdf);
  missing values are `-9999`.
- Licence not stated: fetched live, never committed. One malformed record
  makes the whole path `UNAVAILABLE`.

## Perseverance raw images

`RawImagesAdapter`.

- `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&ver=1.2`
- Credit per image as the feed gives it (for example NASA/JPL-Caltech/ASU),
  else NASA/JPL-Caltech. Fetched live, never committed.
- A sol range pages only as
  `&condition_2=<from>:sol:gte&condition_3=<to>:sol:lte&num=100&page=<n>`;
  cameras filter as `&search=NAVCAM_LEFT|MCZ_LEFT`. `date_taken_utc` has no
  zone and is UTC. Missing values are `"UNK"`. The feed gives no coordinates:
  a photo is placed by joining its site and drive to the rover's waypoints.

## Measured ground temperature

| Site | Source | Licence and citation | Notes |
|---|---|---|---|
| Jezero | Perseverance MEDA TIRS, PDS bundle `mars2020_meda`, collection `data_calibrated_env`, `CAL_TIRS` products, `GROUND_TEMP` (https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/) | PDS: public domain; cite the bundle. Rodriguez-Manfredi, J.A., and de la Torre Juárez, M., 2021, Mars 2020 MEDA Bundle, NASA Planetary Data System, https://doi.org/10.17189/1522849 | Committed as a per-sol minimum/maximum extract, `src/data/temperature/medaJezeroGroundTemperature.ts`. A brightness temperature in the 6.5–30 μm band, not a kinetic one; labelled so |
| Gale | Curiosity REMS ground temperature sensor, mars.nasa.gov MSL weather feed (`https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json&ver=1.0`), `min_gts_temp` / `max_gts_temp` | No terms stated; the feed says it is provided by Centro de Astrobiología (CAB) "for outreach purposes only" and points to the PDS for science use. Credit: Curiosity REMS, NASA/JPL-Caltech/CAB | Read live, never committed; integer °C as published. One exception: a 236-sol sample in `tests/fixtures/remsGaleSampled.ts`, used only by an offline test |

The site boxes these apply to come from the USGS Gazetteer of Planetary
Nomenclature (features 2071 "Gale" and 14300 "Jezero"), quoted in
`src/data/temperature/measuredTemperature.ts`.

## Modelled surface temperature and its inputs

Away from the two measured sites the point menu and the thermal layer's
"modelled temperature" variant show a model estimate, `DERIVED`: a
one-dimensional surface heat balance after KRC, run on official inputs and
labelled with its validated error. It never replaces a measurement.

| Input | Source | Licence |
|---|---|---|
| TES apparent thermal inertia, dayside | Putzig, N. E., and Mellon, M. T., 2007, Apparent thermal inertia of Mars from TES, Icarus 191, 68–94, doi 10.1016/j.icarus.2007.05.013; PDS Geosciences MGS-M-TES-5-TIMAP-V1.0, `GLOBAL_TI_DAY_2007.IMG` and its mask, 20 px/deg (https://pds-geosciences.wustl.edu/missions/mgs/tes-timap.html) | Public domain (NASA PDS); cite the authors |
| TES bolometric albedo | Christensen, P. R., et al., 2001, Mars Global Surveyor Thermal Emission Spectrometer experiment: investigation description and surface science results, J. Geophys. Res. 106, 23823–23871; USGS `Mars_MGS_TES_Albedo_mosaic_global_7410m.tif`, 8 px/deg (https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/) | Public domain (USGS / NASA PDS); cite the authors |
| Solar irradiance, surface pressure, scale height | NASA NSSDCA fact sheets, https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html: 1361.0 W/m² at 1 AU; 6.36 mb at mean radius; 11.0 km | NASA content |
| Mars–Sun distance, declination, local true solar time | Mars24 algorithm (NASA GISS), https://www.giss.nasa.gov/tools/mars24/help/algorithm.html, in `src/domain/mars24.ts` | NASA content |
| CO2 frost point | KRC documentation, "Condensable Atmosphere" (krc.mars.asu.edu): ln P[Pa] = 27.9546 − 3182.48 / T[K] | Citation |
| Reference model | Kieffer, H. H., 2013, Thermal model for analysis of Mars infrared mapping, JGR Planets 118, 451–470, https://doi.org/10.1002/jgre.20073 | Citation |

Both TES grids are committed under `src/data/thermal/` at 2 px/deg globally
(nearest source cell) plus a full-resolution cut over Jezero, each a `.bin`
with a `.json` sidecar holding the source URL, citation, the original's MD5
and the encoding. The thermal layer's "thermal inertia" variant paints the
committed grid directly: `OFFICIAL` values with a colour scale that is this
app's own, stated in the legend.

Validation (`tests/unit/thermalModelValidation.test.ts`, which fails if
either site drifts past the bound): the sol's modelled minimum and maximum
against the measured extremes. Jezero, MEDA, 109 sols: 7.2 K rms. Gale,
REMS, 236 sols: 9.3 K rms. The bound shown in the interface is ± 10 K, the
larger rounded up. The dust and sky terms were fitted at Jezero, so Gale is
the independent check.

## Radiation

No global surface radiation map exists, so radiation per coordinate is
`UNAVAILABLE` and is never interpolated.

- The one surface measurement is shown as a cited reference
  (`src/data/radiation/galeRadReference.ts`): Curiosity RAD at Gale crater.
  Hassler, D.M., et al., 2014, Mars' surface radiation environment measured
  with the Mars Science Laboratory's Curiosity rover: Science, v. 343,
  1244797, https://doi.org/10.1126/science.1244797 (accepted manuscript:
  https://authors.library.caltech.edu/records/kdt88-3aw98/files/RAD_Surface_Results_paper_SCIENCE_12nov13_FINAL.pdf).
  It is never scaled to another place.
- What the app derives is atmospheric shielding at a point: the column mass
  relative to Gale, exp(−(h − h_Gale)/H), with H the 11.0 km scale height
  from the NSSDCA fact sheet (`src/domain/radiation.ts`). It is a `DERIVED`
  fraction, never a dose. The warning line at 0.80 and the LOW / MEDIUM /
  HIGH levels are this app's choice and are labelled as such.

## Place names

- USGS Gazetteer of Planetary Nomenclature, Mars centre points
  (https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.zip),
  names adopted by the IAU; planetocentric, +East 0–360.
- Committed as `src/data/places/marsNames.json` (name, feature type, centre,
  diameter, Gazetteer feature id), with its retrieval date. Read only by
  `PlaceNamesAdapter`.

## Reference constants

- NASA NSSDCA Mars Fact Sheet,
  https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html, in
  `src/data/constants/marsConstants.ts`, each value citing its row. NASA
  content is generally not subject to US copyright; credit "Source: NASA
  NSSDCA Mars Fact Sheet". Axial tilt and the sidereal day used by the globe
  are in `src/features/mars-3d/constants.ts`, same source.

## Sky

`src/features/mars-3d/sky/skyConstants.ts`.

- Planet positions: JPL Solar System Dynamics, approximate positions of the
  planets, https://ssd.jpl.nasa.gov/planets/approx_pos.html.
- Orientation and body radii: IAU WGCCRE 2015 (Archinal et al. 2018) as
  implemented in NAIF's planetary constants kernel `pck00011.tpc`,
  https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc.
- A JPL Horizons sample is committed as a test fixture
  (`tests/fixtures/horizonsMarsSky.ts`) to check the sky positions.

## Walking models

Cited in `src/features/route-analysis/` and `src/domain/walk.ts`; none is a
Mars measurement and every figure derived from them says so.

- Slope limit and level pace in a suit: NASA EVA-EXP-0075 (2020), Lunar
  Excursion Ranges ("Walking up/down/across a slope of up to 20°"; "Assumes
  ~2 km/hr walking pace on relatively level regolith").
- Speed on a slope: Tobler, W. (1993), "Three presentations on geographical
  analysis and modeling", NCGIA Technical Report 93-1.
- Metabolic cost: Minetti, A. E., Moia, C., Roi, G. S., Susta, D. &
  Ferretti, G. (2002), "Energy cost of walking and running at extreme uphill
  and downhill slopes", J Appl Physiol 93:1039–1046,
  doi 10.1152/japplphysiol.01177.2001.
- Reference body mass: NASA-STD-3001 Vol. 2, unsuited crewmember body mass
  range.

## Simulated data

`src/data/mock/` holds invented data used to exercise the pipeline: a
simulated traverse and a sample walk plan (shown only with `?sampleWalk` in
the address). Every value is classified `SIMULATED` and labelled so in the
interface. The globe's spin speed and the surface view's rocks and ground
grain are simulated too and are named on screen.

## Rebuilding the committed data

The committed files are generated; do not edit them by hand.

| Output | Script | Run |
|---|---|---|
| `src/data/places/marsNames.json` | `scripts/build-mars-names.mjs` | Download and unzip the Gazetteer shapefile, then `node scripts/build-mars-names.mjs <MARS_nomenclature_center_pts.dbf> [--retrieved YYYY-MM-DD]` |
| `src/data/thermal/tes-*.bin` and `.json` | `scripts/build-tes-grids.mjs` | `node scripts/build-tes-grids.mjs --cache <dir>` (downloads the PDS and USGS originals into the cache directory) |
| `src/data/temperature/medaJezeroGroundTemperature.ts` | `scripts/build-meda-extract.mjs` | `node scripts/build-meda-extract.mjs --cache <dir> [--workers 4]` (about 9.6 GB crosses the network once; one summary row per sol is kept) |
| `tests/fixtures/remsGaleSampled.ts` | `scripts/build-rems-extract.mjs` | `node scripts/build-rems-extract.mjs [--every 20] [--from <saved feed.json>]` |

Each script documents its source, method and output format in its header.
After rebuilding, run the tests: the adapters' tests, the committed-extract
check (`tests/unit/medaJezeroExtract.test.ts`) and the thermal grid and
model validation tests read the new files.
