import {
  insideBounds,
  official,
  unavailable,
  type Classified,
  type GeologicFeatures,
  type GeologicMap,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
  type SiteBounds,
} from '../../domain'
import {
  FEATURE_KIND_FIELD,
  GLOBAL_UNITS,
  JEZERO_FEATURE_LAYERS,
  JEZERO_UNITS,
  SIMPLIFY_DEG,
  type UnitSource,
} from '../geology/geologySources'
import { SIM_3464 } from '../sites/sites'
import { defaultJsonIo } from './jsonIo'
import {
  extentQueryUrl,
  pointQueryUrl,
  queryFeatures,
  readPaths,
  readPoint,
  readRings,
  type FeatureIo,
  type RawFeature,
} from './arcgisFeatures'

/**
 * The geologic units and mapped features of the USGS maps: which
 * unit is at a point, the unit polygons in a box, and the features a walk
 * routes around. Text is the map's, verbatim, typos included ("Crater riim
 * unit" sits beside "Crater rim unit" in SIM 3464). A failed or malformed
 * answer is UNAVAILABLE with the reason, never an empty unit.
 */

/** Why `extentQueryUrl` refused the box. */
const NOT_ONE_ENVELOPE =
  'the box cannot be sent as one envelope (it crosses 180°E, or its west edge is not below its east edge)'

/**
 * The unit at `point`: SIM 3464 on its sheet, SIM 3292 off it, or where
 * the sheet maps nothing. A failure on the sheet stays UNAVAILABLE rather
 * than falling back, so the coarse map never stands in for the detailed
 * one without saying so.
 */
export async function geologicUnitAt(
  point: MarsCoordinate,
  signal: AbortSignal,
  io: FeatureIo = defaultJsonIo,
): Promise<Classified<GeologicUnit>> {
  if (insideBounds(point, JEZERO_UNITS.sheet)) {
    const detailed = await unitFrom(JEZERO_UNITS, point, signal, io)
    if (detailed !== null) return detailed
  }
  const global = await unitFrom(GLOBAL_UNITS, point, signal, io)
  return global ?? unavailable('No geologic map covers this point')
}

/** The source's unit at `point`, null when it maps nothing there. */
async function unitFrom(
  source: UnitSource,
  point: MarsCoordinate,
  signal: AbortSignal,
  io: FeatureIo,
): Promise<Classified<GeologicUnit> | null> {
  const fail = (why: string) => unavailable<GeologicUnit>(`Geologic unit (${source.map.id}) failed to load: ${why}`)
  const url = pointQueryUrl(source.serviceUrl, source.layerId, point, Object.values(source.fields))
  const answer = await queryFeatures(url, signal, io)
  if (typeof answer === 'string') return fail(answer)
  if (answer.length === 0) return null
  const units: GeologicUnit[] = []
  for (const [i, feature] of answer.entries()) {
    const unit = readUnit(source, feature, i)
    if (typeof unit === 'string') return fail(unit)
    units.push(unit)
  }
  // A point on a contact touches two polygons. The same unit twice is
  // still one answer; two different units are not, and neither is chosen.
  const names = [...new Set(units.map((u) => `${u.name} (${u.symbol})`))]
  if (names.length > 1) return unavailable(`On a contact between ${names.join(' and ')} (${source.map.id})`)
  return official(units[0], source.map.citation)
}

/**
 * The SIM 3464 unit polygons touching `bounds`, simplified by the service
 * to within SIMPLIFY_DEG. Descriptions stay out: `geologicUnitAt` carries
 * them for the one unit a reader asks about.
 */
export async function geologicUnitAreas(
  bounds: SiteBounds,
  signal: AbortSignal,
  io: FeatureIo = defaultJsonIo,
): Promise<Classified<GeologicUnitArea[]>> {
  const fail = (why: string) => unavailable<GeologicUnitArea[]>(`Geologic units failed to load: ${why}`)
  const s = JEZERO_UNITS
  if (!overlaps(bounds, s.sheet)) return unavailable(`The box lies outside the ${s.map.id} map sheet`)
  const code = s.fields.legendCode ?? s.fields.symbol
  const url = extentQueryUrl(s.serviceUrl, s.layerId, bounds, [s.fields.symbol, s.fields.name, code], SIMPLIFY_DEG)
  if (url === null) return fail(NOT_ONE_ENVELOPE)
  const [answer, legend] = await Promise.all([queryFeatures(url, signal, io), readLegend(s, code, signal, io)])
  if (typeof answer === 'string') return fail(answer)
  const areas: GeologicUnitArea[] = []
  for (const [i, feature] of answer.entries()) {
    const unit = readUnit(s, feature, i)
    if (typeof unit === 'string') return fail(unit)
    const rings = readRings(feature.geometry, i)
    if (typeof rings === 'string') return fail(rings)
    const color = legend?.get(String(feature.attributes[code]))
    areas.push({ unit: color === undefined ? unit : { ...unit, color }, rings })
  }
  const colours = legend === null
    ? " The map's published colours could not be read."
    : " Colours as the map publishes them."
  return official(areas, simplified(s.map) + colours)
}

/**
 * The layer's published colours, by the value of its renderer's field. Null
 * when they cannot be read: the units still stand, as colours only show them.
 */
async function readLegend(s: UnitSource, code: string, signal: AbortSignal, io: FeatureIo): Promise<Map<string, string> | null> {
  try {
    return parseLegend(await io.fetchJson(`${s.serviceUrl}/${s.layerId}?f=json`, signal), code)
  } catch {
    return null
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** A layer description's unique-value renderer as code → "#rrggbb", or null if it is not one. */
export function parseLegend(body: unknown, code: string): Map<string, string> | null {
  if (!isRecord(body) || !isRecord(body.drawingInfo) || !isRecord(body.drawingInfo.renderer)) return null
  const { field1, uniqueValueInfos } = body.drawingInfo.renderer
  if (field1 !== code || !Array.isArray(uniqueValueInfos)) return null
  const legend = new Map<string, string>()
  for (const info of uniqueValueInfos) {
    if (!isRecord(info) || !isRecord(info.symbol) || !Array.isArray(info.symbol.color)) return null
    const rgb = info.symbol.color.slice(0, 3)
    if (rgb.length !== 3 || !rgb.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) return null
    legend.set(String(info.value), `#${rgb.map((c: number) => c.toString(16).padStart(2, '0')).join('')}`)
  }
  return legend
}

/**
 * The SIM 3464 points, lines and areas touching `bounds`, kinds verbatim.
 * All three or none: a route that saw the ridges but not the craters
 * would be planned on half the map. Not simplified: these layers are a few
 * hundred small geometries, and a ridge crest moved 30 m is a different
 * answer to "does the route cross it" on a 20 m DEM.
 */
export async function geologicFeatures(
  bounds: SiteBounds,
  signal: AbortSignal,
  io: FeatureIo = defaultJsonIo,
): Promise<Classified<GeologicFeatures>> {
  const fail = (why: string) => unavailable<GeologicFeatures>(`Mapped features failed to load: ${why}`)
  const map = SIM_3464
  if (!overlaps(bounds, JEZERO_UNITS.sheet)) return unavailable(`The box lies outside the ${map.id} map sheet`)
  const { points: pointLayer, lines: lineLayer, areas: areaLayer } = JEZERO_FEATURE_LAYERS
  const urls: string[] = []
  for (const layer of [pointLayer, lineLayer, areaLayer]) {
    const url = extentQueryUrl(JEZERO_UNITS.serviceUrl, layer, bounds, [FEATURE_KIND_FIELD])
    if (url === null) return fail(NOT_ONE_ENVELOPE)
    urls.push(url)
  }
  const lists: RawFeature[][] = []
  for (const answer of await Promise.all(urls.map((u) => queryFeatures(u, signal, io)))) {
    if (typeof answer === 'string') return fail(answer)
    lists.push(answer)
  }
  const [points, lines, areas] = lists
  // The sheet's own edges: a box reaching past them is answered only inside them.
  const out: GeologicFeatures = { points: [], lines: [], areas: [], covers: JEZERO_UNITS.sheet }
  for (const [i, f] of points.entries()) {
    const kind = readKind(f)
    const at = readPoint(f.geometry, i)
    if (typeof at === 'string') return fail(`points: ${at}`)
    if (kind === null) return fail(`points: feature ${i} has no ${FEATURE_KIND_FIELD}`)
    out.points.push({ kind, at, map })
  }
  for (const [i, f] of lines.entries()) {
    const kind = readKind(f)
    const paths = readPaths(f.geometry, i)
    if (typeof paths === 'string') return fail(`lines: ${paths}`)
    if (kind === null) return fail(`lines: feature ${i} has no ${FEATURE_KIND_FIELD}`)
    // A multi-part line is several lines of the same kind.
    for (const path of paths) out.lines.push({ kind, path, map })
  }
  for (const [i, f] of areas.entries()) {
    const kind = readKind(f)
    const rings = readRings(f.geometry, i)
    if (typeof rings === 'string') return fail(`areas: ${rings}`)
    if (kind === null) return fail(`areas: feature ${i} has no ${FEATURE_KIND_FIELD}`)
    out.areas.push({ kind, rings, map })
  }
  return official(out, map.citation)
}


/** A unit from a feature's attributes, or what is missing. Text as published, untrimmed. */
function readUnit(source: UnitSource, feature: RawFeature, i: number): GeologicUnit | string {
  const a = feature.attributes
  const symbol = a[source.fields.symbol]
  const name = a[source.fields.name]
  if (typeof symbol !== 'string' || symbol.trim() === '') return `feature ${i} has no unit symbol`
  if (typeof name !== 'string' || name.trim() === '') return `feature ${i} has no unit name`
  const unit: GeologicUnit = { symbol, name, map: source.map }
  const description = source.fields.description ? a[source.fields.description] : undefined
  const interpretation = source.fields.interpretation ? a[source.fields.interpretation] : undefined
  if (typeof description === 'string' && description.trim() !== '') unit.description = description
  if (typeof interpretation === 'string' && interpretation.trim() !== '') unit.interpretation = interpretation
  return unit
}

function readKind(feature: RawFeature): string | null {
  const kind = feature.attributes[FEATURE_KIND_FIELD]
  return typeof kind === 'string' && kind.trim() !== '' ? kind : null
}

function overlaps(a: SiteBounds, b: SiteBounds): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south
}

function simplified(map: GeologicMap): string {
  return `${map.citation}. Geometry simplified by the USGS service to within ${SIMPLIFY_DEG}° (about 30 m).`
}
