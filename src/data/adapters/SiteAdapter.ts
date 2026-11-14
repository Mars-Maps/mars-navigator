import { insideBounds, official, unavailable, type Classified, type MarsCoordinate, type SiteBounds } from '../../domain'
import { featureQueryUrl, queryFeatureRings, type FeatureIo } from './arcgisFeatures'
import { defaultJsonIo } from './jsonIo'

/**
 * The site's landing ellipse from its map's feature service: one
 * polygon, OFFICIAL with the map's citation, or UNAVAILABLE with the reason.
 * Never a partial or guessed outline.
 */
export interface EllipseSource {
  serviceUrl: string
  layerId: number
  /** The map's suggested citation, shown with the ellipse. */
  citation: string
  /** Where the ellipse must lie; a ring outside it is the wrong feature. */
  bounds: SiteBounds
}

export async function loadLandingEllipse(
  source: EllipseSource,
  signal: AbortSignal,
  io: FeatureIo = defaultJsonIo,
): Promise<Classified<MarsCoordinate[]>> {
  const answer = await queryFeatureRings(featureQueryUrl(source.serviceUrl, source.layerId), signal, io)
  if (typeof answer === 'string') return unavailable(`Landing ellipse failed to load: ${answer}`)
  if (answer.length !== 1) return unavailable(`Landing ellipse failed to load: expected one feature, got ${answer.length}`)
  const rings = answer[0]
  if (rings.length !== 1) return unavailable(`Landing ellipse failed to load: expected one ring, got ${rings.length}`)
  const ring = closeRing(rings[0])
  if (!ring.every((c) => insideBounds(c, source.bounds))) {
    return unavailable('Landing ellipse failed to load: the polygon lies outside the site bounds')
  }
  return official(ring, source.citation)
}

/** Esri rings repeat the first vertex last; a ring that does not is closed here. */
function closeRing(ring: readonly MarsCoordinate[]): MarsCoordinate[] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  const closed = first.latitude === last.latitude && first.longitudeEast === last.longitudeEast
  return closed ? [...ring] : [...ring, first]
}
