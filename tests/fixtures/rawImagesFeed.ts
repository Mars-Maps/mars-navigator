/**
 * Two records from NASA's Mars 2020 raw images feed, sol 600, recorded
 * 2026-11-05 and trimmed to the fields the adapter reads plus `xyz`. Real
 * values; the tests derive "UNK" and broken records from them by spreading.
 */
const SOL_600 = 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00600/ids/edr/browse/pixl'

export const PIXL_RECORD = {
  imageid: 'PCS_0600_0720244903_000ECM_N030000020853606902300LUJ',
  sol: 600,
  site: 30,
  drive: '0',
  credit: 'NASA/JPL-Caltech',
  caption:
    "NASA's Mars Perseverance rover acquired this image using its PIXL Micro Context Camera, located on the turret at the end of the rover's robotic arm. \n\nThis image was acquired on  Oct. 28, 2022 (Sol 600) at the local mean solar time of 23:15:09.",
  date_taken_utc: '2022-10-28T16:10:13.365',
  date_taken_mars: 'Sol-00600M23:15:09.867',
  sample_type: 'Full',
  camera: { instrument: 'PIXL_MCC' },
  image_files: {
    small: `${SOL_600}/PCS_0600_0720244903_000ECM_N030000020853606902300LUJ01_320.jpg`,
    medium: `${SOL_600}/PCS_0600_0720244903_000ECM_N030000020853606902300LUJ01_800.jpg`,
    large: `${SOL_600}/PCS_0600_0720244903_000ECM_N030000020853606902300LUJ01_1200.jpg`,
    full_res: `${SOL_600}/PCS_0600_0720244903_000ECM_N030000020853606902300LUJ01.png`,
  },
  extended: { xyz: '(0.0,0.0,0.0)' },
}

/** Sol 2024, Mastcam-Z: the credit names the instrument team. */
const SOL_2024 = 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/02024/ids/edr/browse/zcam'

export const MASTCAM_RECORD = {
  imageid: 'ZL0_2024_0846622583_145EBY_N0930000ZCAM10058_1100LMJ',
  sol: 2024,
  site: 93,
  drive: '0',
  credit: 'NASA/JPL-Caltech/ASU',
  date_taken_utc: '2026-10-30T09:21:53.576',
  date_taken_mars: 'Sol-02024M13:10:59.198',
  sample_type: 'Full',
  camera: { instrument: 'MCZ_LEFT' },
  image_files: {
    small: `${SOL_2024}/ZL0_2024_0846622583_145EBY_N0930000ZCAM10058_1100LMJ01_320.jpg`,
    full_res: `${SOL_2024}/ZL0_2024_0846622583_145EBY_N0930000ZCAM10058_1100LMJ01.png`,
  },
  extended: { xyz: '(0.0,0.0,0.0)' },
}

/** A page as the feed wraps it. */
export const feedPage = (images: unknown[], totalResults: number, page = 0) => ({
  per_page: '100',
  total_results: totalResults,
  type: 'mars2020-images-list-1.1',
  page,
  mission: 'mars2020',
  total_images: 1055816,
  images,
})

/** Past the last page, as the feed answers it. */
export const pastTheEnd = (totalResults: number, page: number) => ({
  ...feedPage([], totalResults, page),
  page: String(page),
  error_message: 'No more images.',
})
