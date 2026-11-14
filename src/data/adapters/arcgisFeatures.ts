import { validateCoordinate, type MarsCoordinate, type SiteBounds } from '../../domain'
import { defaultJsonIo, type JsonIo } from './jsonIo'

/**
 * One reader for the USGS ArcGIS feature services:
 * builds the query, checks the answer's shape, and turns Esri
 * JSON polygon rings into the project's coordinates. Nothing above the
 * adapters sees Esri JSON.
 *
 * Asking for `outSR=104971` (the Mars 2000 sphere, degrees) returns
 * planetocentric latitude and ±180° longitude, which
 * is normalised to 0–360°E here, as every adapter does.
 */

/** Esri's well-known id for the Mars 2000 sphere in degrees. */
export const MARS_2000_DEGREES_WKID = 104971

/**
 * Esri's well-known id for Mars 2000 geographic degrees. Point queries are
 * sent in it: the global SIM 3292 service is stored in it, and a
 * point sent without it is read in the service's own projection.
 */
export const MARS_2000_GEOGRAPHIC_WKID = 104905

/** The feature services' io: the adapters' one JSON fetch. */
export type FeatureIo = JsonIo

/** The query URL for every feature of `layerId`, geometry in degrees, attributes too. */
export function featureQueryUrl(serviceUrl: string, layerId: number, where = '1=1'): string {
  const params = new URLSearchParams({
    where,
    outFields: '*',
    outSR: String(MARS_2000_DEGREES_WKID),
    f: 'json',
  })
  return `${serviceUrl.replace(/\/$/, '')}/${layerId}/query?${params}`
}

/**
 * 0–360°E as the services read it, ±180°. The global SIM 3292 service
 * answers 226.2 with nothing and −133.8 with Olympus Mons (checked
 * 2026-10-31), so a point is never sent in the project convention.
 */
export function toSignedLongitude(longitudeEast: number): number {
  return longitudeEast > 180 ? longitudeEast - 360 : longitudeEast
}

/** The query URL for the attributes of the features under one point; no geometry. */
export function pointQueryUrl(
  serviceUrl: string,
  layerId: number,
  point: MarsCoordinate,
  outFields: readonly string[],
): string {
  const params = new URLSearchParams({
    geometry: `${toSignedLongitude(point.longitudeEast)},${point.latitude}`,
    geometryType: 'esriGeometryPoint',
    inSR: String(MARS_2000_GEOGRAPHIC_WKID),
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields.join(','),
    returnGeometry: 'false',
    f: 'json',
  })
  return `${serviceUrl.replace(/\/$/, '')}/${layerId}/query?${params}`
}

/**
 * The query URL for the features touching a box, geometry in degrees,
 * simplified by the service to within `maxAllowableOffsetDeg` when given.
 * Null when the box cannot be written as one ±180° envelope: it crosses
 * 180°E, or its west edge is not below its east edge.
 */
export function extentQueryUrl(
  serviceUrl: string,
  layerId: number,
  bounds: SiteBounds,
  outFields: readonly string[],
  maxAllowableOffsetDeg?: number,
): string | null {
  const west = toSignedLongitude(bounds.west)
  const east = toSignedLongitude(bounds.east)
  if (west >= east) return null
  const params = new URLSearchParams({
    geometry: `${west},${bounds.south},${east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: String(MARS_2000_DEGREES_WKID),
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields.join(','),
    outSR: String(MARS_2000_DEGREES_WKID),
    f: 'json',
  })
  if (maxAllowableOffsetDeg !== undefined) params.set('maxAllowableOffset', String(maxAllowableOffsetDeg))
  return `${serviceUrl.replace(/\/$/, '')}/${layerId}/query?${params}`
}

/** One feature of an answer, its attributes checked to be an object, its geometry not yet read. */
export interface RawFeature {
  attributes: Record<string, unknown>
  geometry: unknown
}

/**
 * The features of a query answer, or what is wrong with it. An answer the
 * service cut short (`exceededTransferLimit`) is an error, never a partial
 * list: the caller would draw a map with holes and call it the map.
 */
export function parseFeatureList(body: unknown): RawFeature[] | string {
  if (!isRecord(body)) return 'not a JSON object'
  if (isRecord(body.error)) return `service error: ${String(body.error.message ?? 'unstated')}`
  if (!Array.isArray(body.features)) return 'no "features" list'
  if (body.exceededTransferLimit === true) return 'the service cut the answer short; ask for a smaller area'
  const features: RawFeature[] = []
  for (const [i, feature] of body.features.entries()) {
    if (!isRecord(feature)) return `feature ${i} is not an object`
    features.push({ attributes: isRecord(feature.attributes) ? feature.attributes : {}, geometry: feature.geometry })
  }
  return features
}

/**
 * The polygon rings in a query answer, one list per feature, or what is
 * wrong with the answer. An answer with no features is an empty list, not
 * an error: the caller knows how many it expected.
 */
export function parseFeatureRings(body: unknown): MarsCoordinate[][][] | string {
  const list = parseFeatureList(body)
  if (typeof list === 'string') return list
  const features: MarsCoordinate[][][] = []
  for (const [i, feature] of list.entries()) {
    const rings = readRings(feature.geometry, i)
    if (typeof rings === 'string') return rings
    features.push(rings)
  }
  return features
}

/** A polygon's rings, outer first as Esri lists them, or what is wrong with feature `i`. */
export function readRings(geometry: unknown, i: number): MarsCoordinate[][] | string {
  if (!isRecord(geometry) || !Array.isArray(geometry.rings)) return `feature ${i} has no polygon rings`
  return readVertexLists(geometry.rings, i, 'ring', 3)
}

/** A polyline's paths, or what is wrong with feature `i`. */
export function readPaths(geometry: unknown, i: number): MarsCoordinate[][] | string {
  if (!isRecord(geometry) || !Array.isArray(geometry.paths)) return `feature ${i} has no polyline paths`
  return readVertexLists(geometry.paths, i, 'path', 2)
}

/** A point, or what is wrong with feature `i`. */
export function readPoint(geometry: unknown, i: number): MarsCoordinate | string {
  if (!isRecord(geometry)) return `feature ${i} has no point`
  const c = vertexToCoordinate([geometry.x, geometry.y])
  return c ?? `feature ${i} has a point that is not x, y in range`
}

function readVertexLists(lists: unknown[], i: number, what: string, min: number): MarsCoordinate[][] | string {
  const out: MarsCoordinate[][] = []
  for (const [r, list] of lists.entries()) {
    if (!Array.isArray(list) || list.length < min) return `feature ${i} ${what} ${r} has fewer than ${min} vertices`
    const points: MarsCoordinate[] = []
    for (const vertex of list) {
      const c = vertexToCoordinate(vertex)
      if (c === null) return `feature ${i} ${what} ${r} has a vertex that is not [lon, lat] in range`
      points.push(c)
    }
    out.push(points)
  }
  return out
}

function vertexToCoordinate(vertex: unknown): MarsCoordinate | null {
  if (!Array.isArray(vertex) || vertex.length < 2) return null
  const [lon, lat] = vertex
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) return null
  if (lon < -360 || lon > 360) return null
  // Not ((lon % 360) + 360) % 360: adding 360 and taking it off again moves
  // every positive longitude by a rounding error (77.45 → 77.44999999999999).
  const east = lon % 360
  const c = { latitude: lat, longitudeEast: east < 0 ? east + 360 : east }
  return validateCoordinate(c).ok ? c : null
}

/** Reads and parses one query. Never rejects: an error is a string, a cancel is "Cancelled". */
export async function queryFeatureRings(
  url: string,
  signal: AbortSignal,
  io: FeatureIo = defaultJsonIo,
): Promise<MarsCoordinate[][][] | string> {
  return query(url, signal, io, parseFeatureRings)
}

/** Reads one query into its features. Never rejects, as `queryFeatureRings`. */
export async function queryFeatures(
  url: string,
  signal: AbortSignal,
  io: FeatureIo = defaultJsonIo,
): Promise<RawFeature[] | string> {
  return query(url, signal, io, parseFeatureList)
}

async function query<T>(
  url: string,
  signal: AbortSignal,
  io: FeatureIo,
  parse: (body: unknown) => T | string,
): Promise<T | string> {
  if (signal.aborted) return 'Cancelled'
  try {
    const body = await io.fetchJson(url, signal)
    if (signal.aborted) return 'Cancelled'
    return parse(body)
  } catch (error: unknown) {
    if (signal.aborted) return 'Cancelled'
    return error instanceof Error ? error.message : String(error)
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
