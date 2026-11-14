import {
  official,
  unavailable,
  type Classified,
  type RoverMotionCounter,
  type SurfaceImage,
} from '../../domain'
import { defaultJsonIo, type JsonIo } from './jsonIo'

/**
 * Perseverance raw images from NASA's public feed: the photos the
 * rover took on a range of sols, so the astronaut can see a stop before
 * reaching it. No key, CORS open (checked 2026-11-05). Read at runtime and
 * never committed, like the traverse.
 *
 * What the live feed does, checked 2026-11-05:
 * - Only the `condition_2=<sol>:sol:gte&condition_3=<sol>:sol:lte` form pages:
 *   `sol=<n>` ignores `num` and `page`. A page past the end carries
 *   `error_message: "No more images."` and no images.
 * - `sol` and `site` arrive as numbers, `drive` as a string; any of them may
 *   be text, and "UNK" means not known.
 * - `date_taken_utc` has no zone; it is UTC.
 * - The credit varies by instrument ("NASA/JPL-Caltech/ASU" for Mastcam-Z),
 *   so each image keeps its own; "NASA/JPL-Caltech" where the feed gives none.
 * - `extended.xyz` is the rover's offset in its site frame, and is
 *   "(0.0,0.0,0.0)" at drive 0. It is not a map position and is not read:
 *   the position comes from joining site/drive to the traverse.
 */

export const RAW_IMAGES_FEED =
  'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&ver=1.2'
export const RAW_IMAGES_CREDIT = 'NASA/JPL-Caltech'
export const RAW_IMAGES_PAGE_SIZE = 100
/** A busy sol holds about 1,000 images; past this the batch says it was cut short. */
export const RAW_IMAGES_MAX_PAGES = 10

const NO_POSITION = 'The raw-image feed gives no position: it is placed from site/drive by the traverse join'

/** Photos for a sol range, and what was left out. */
export interface RawImageBatch {
  images: SurfaceImage[]
  /** How many images the feed says the range holds. */
  totalResults: number
  /**
   * Records listed that could not be shown: no id, sol or image URL, or no
   * camera named when cameras were asked for. Each counted once, by its id,
   * else its content, though the live feed can list it on two pages.
   */
  skipped: number
  /** The page cap stopped the read before the feed ran out. */
  truncated: boolean
  /** The feed stopped listing before it had listed `totalResults` images. */
  ranDry: boolean
}

export interface SolRange {
  fromSol: number
  toSol: number
  /**
   * Only these cameras, as NASA names them (e.g. "NAVCAM_LEFT"); every camera
   * when left out. Sent as the feed's `search=A|B`, checked live 2026-11-05.
   */
  cameras?: readonly string[]
}

const CAMERA_NAME = /^[A-Z0-9_]+$/

/** What `camera` holds when the feed names none: never one of the cameras asked for. */
export const CAMERA_NOT_GIVEN = 'Camera not given'

/** A list the feed's `search` can take as asked: absent, or one or more NASA camera names. */
function isCameraList(cameras: readonly string[] | undefined): boolean {
  return cameras === undefined || (cameras.length > 0 && cameras.every((c) => CAMERA_NAME.test(c)))
}

export function rawImagesUrl({ fromSol, toSol, cameras }: SolRange, page: number, pageSize = RAW_IMAGES_PAGE_SIZE): string {
  // The feed drops a condition it cannot read and answers unfiltered, so a bad sol never reaches it.
  if (!isSol(fromSol) || !isSol(toSol) || !isSol(page) || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(`Not a raw-images query: sols ${fromSol}–${toSol}, page ${page}, ${pageSize} per page`)
  }
  if (!isCameraList(cameras)) throw new RangeError(`Not a camera list: ${JSON.stringify(cameras)}`)
  const search = cameras === undefined ? '' : `&search=${encodeURIComponent(cameras.join('|'))}`
  return (
    `${RAW_IMAGES_FEED}&num=${pageSize}&page=${page}&order=sol+desc` +
    `&condition_2=${fromSol}:sol:gte&condition_3=${toSol}:sol:lte${search}`
  )
}

export async function loadRawImages(
  range: SolRange,
  signal: AbortSignal,
  io: JsonIo = defaultJsonIo,
  maxPages = RAW_IMAGES_MAX_PAGES,
): Promise<Classified<RawImageBatch>> {
  const fail = (why: string) => unavailable<RawImageBatch>(`Perseverance raw images failed to load: ${why}`)
  if (!isSol(range.fromSol) || !isSol(range.toSol) || range.fromSol > range.toSol) {
    return fail(`not a sol range: ${range.fromSol} to ${range.toSol}`)
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) return fail(`not a page cap: ${maxPages}`)
  const { cameras } = range
  if (!isCameraList(cameras)) return fail(`not a camera list: ${JSON.stringify(cameras)}`)
  const byId = new Map<string, SurfaceImage>()
  // Keyed, not counted: a repeated broken record counted twice could make a read cut short look complete.
  const skippedKeys = new Set<string>()
  const listed = () => byId.size + skippedKeys.size
  let totalResults = 0
  let truncated = false
  let ranDry = false
  for (let page = 0; ; page++) {
    if (page === maxPages) {
      truncated = listed() < totalResults
      break
    }
    if (signal.aborted) return fail('Cancelled')
    let body: unknown
    try {
      body = await io.fetchJson(rawImagesUrl(range, page), signal)
    } catch (error: unknown) {
      return fail(signal.aborted ? 'Cancelled' : error instanceof Error ? error.message : String(error))
    }
    const parsed = parseRawImagesPage(body)
    if (typeof parsed === 'string') return fail(`page ${page}: ${parsed}`)
    // A sol outside the range means the feed ignored the filter: nothing here is what was asked for.
    const stray = parsed.images.find((i) => i.sol < range.fromSol || i.sol > range.toSol)
    if (stray !== undefined) {
      return fail(`page ${page} lists sol ${stray.sol} for sols ${range.fromSol}–${range.toSol}, so the feed's sol filter did not apply`)
    }
    let images = parsed.images
    if (cameras !== undefined) {
      // A record that names no camera cannot be checked against the filter, nor shown as one asked for: counted, not shown.
      for (const i of images) if (i.camera === CAMERA_NOT_GIVEN) skippedKeys.add(idKey(i.id))
      images = images.filter((i) => i.camera !== CAMERA_NOT_GIVEN)
      // The same check as for sols: an unfiltered answer would be counted as the cameras asked for.
      const other = images.find((i) => !cameras.includes(i.camera))
      if (other !== undefined) {
        return fail(`page ${page} lists camera ${other.camera} for ${cameras.join(', ')}, so the feed's camera filter did not apply`)
      }
    }
    totalResults = parsed.totalResults
    for (const key of parsed.skippedKeys) skippedKeys.add(key)
    // The feed is live: a page can repeat an image the last one held.
    for (const image of images) byId.set(image.id, image)
    // An id shown is never also skipped, in either order: listed broken before it read, or after.
    for (const id of byId.keys()) skippedKeys.delete(idKey(id))
    if (parsed.images.length + parsed.skippedKeys.length === 0) {
      ranDry = listed() < totalResults
      break
    }
    if (listed() >= totalResults) break
  }
  if (signal.aborted) return fail('Cancelled')
  const which = cameras === undefined ? '' : `, ${cameras.join(', ')}`
  const source = `${RAW_IMAGES_CREDIT}, Mars 2020 raw images feed, sols ${range.fromSol}–${range.toSol}${which}`
  return official({ images: [...byId.values()], totalResults, skipped: skippedKeys.size, truncated, ranDry }, source)
}

/** One page of the feed, or what is wrong with it. Unreadable records are counted, not shown, each with a key to count it once. */
export function parseRawImagesPage(
  body: unknown,
): { images: SurfaceImage[]; skipped: number; skippedKeys: string[]; totalResults: number } | string {
  if (!isRecord(body) || !Array.isArray(body.images)) return 'no image list in the response'
  const totalResults = toCount(body.total_results)
  if (totalResults === null) return `no total_results in the response (${show(body.total_results)})`
  const images: SurfaceImage[] = []
  const skippedKeys: string[] = []
  for (const record of body.images) {
    const image = readRawImage(record)
    if (image === null) skippedKeys.push(recordKey(record))
    else images.push(image)
  }
  return { images, skipped: skippedKeys.length, skippedKeys, totalResults }
}

function idKey(id: string): string {
  return `id:${id}`
}

/** A broken record's id when it has one, else its whole content: the same record on two pages gets the same key. */
function recordKey(record: unknown): string {
  if (isRecord(record) && typeof record.imageid === 'string' && record.imageid !== '') return idKey(record.imageid)
  return `record:${JSON.stringify(record) ?? String(record)}`
}

/** One feed record as a photo, or null when it cannot be shown. */
export function readRawImage(record: unknown): SurfaceImage | null {
  if (!isRecord(record)) return null
  const id = record.imageid
  const sol = toCount(record.sol)
  const files = isRecord(record.image_files) ? record.image_files : {}
  const thumbnailUrl = firstUrl(files.small, files.medium)
  const fullUrl = firstUrl(files.full_res, files.large)
  if (typeof id !== 'string' || id === '' || sol === null || thumbnailUrl === null || fullUrl === null) return null
  const credit = typeof record.credit === 'string' && record.credit.trim() !== '' ? record.credit.trim() : RAW_IMAGES_CREDIT
  const source = `${credit}, Mars 2020 raw images feed, ${id}`
  const instrument = isRecord(record.camera) ? record.camera.instrument : undefined
  const caption = typeof record.caption === 'string' ? record.caption.trim() : ''
  return {
    id,
    rover: 'perseverance',
    sol,
    camera: typeof instrument === 'string' && instrument !== '' ? instrument : CAMERA_NOT_GIVEN,
    takenUtcMs: readUtc(record.date_taken_utc, source),
    takenLocalMeanSolarTime: readLmst(record.date_taken_mars, source),
    rmc: readRmc(record.site, record.drive, source),
    thumbnailUrl,
    fullUrl,
    credit,
    ...(caption === '' ? {} : { caption }),
    position: unavailable(NO_POSITION),
  }
}

function readRmc(site: unknown, drive: unknown, source: string): Classified<RoverMotionCounter> {
  const s = toCount(site)
  const d = toCount(drive)
  if (s === null || d === null) {
    return unavailable(`The feed gives site ${show(site)}, drive ${show(drive)} for this photo`)
  }
  return official({ site: s, drive: d }, source)
}

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/

function readUtc(v: unknown, source: string): Classified<number> {
  if (typeof v !== 'string' || !UTC.test(v)) return unavailable(`The feed gives no UTC time for this photo (${show(v)})`)
  const ms = Date.parse(v.endsWith('Z') ? v : `${v}Z`)
  return Number.isFinite(ms) ? official(ms, source) : unavailable(`The feed's UTC time "${v}" is not a date`)
}

const LMST = /^Sol-\d+M(\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/

function readLmst(v: unknown, source: string): Classified<string> {
  const m = typeof v === 'string' ? LMST.exec(v) : null
  return m === null ? unavailable(`The feed gives no local solar time for this photo (${show(v)})`) : official(m[1], source)
}

/** A whole number from a number or its text, e.g. 1004 or "1004". "UNK" and anything else: null. */
function toCount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
  return null
}

function firstUrl(...vs: unknown[]): string | null {
  for (const v of vs) if (typeof v === 'string' && v.startsWith('https://')) return v
  return null
}

function isSol(v: number): boolean {
  return Number.isInteger(v) && v >= 0
}

function show(v: unknown): string {
  return v === undefined ? 'nothing' : JSON.stringify(v)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
