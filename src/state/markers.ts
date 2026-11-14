import { unavailable, type MarsCoordinate, type SurfacePoint } from '../domain'

/** Longest description a marked point keeps. The input stops there too. */
export const MARKER_DESCRIPTION_MAX = 60

/**
 * The description as stored: trimmed, then capped at MARKER_DESCRIPTION_MAX,
 * so leading spaces do not use up the limit. Blank or missing is undefined,
 * never an empty string.
 */
export function markerDescription(text: string | undefined): string | undefined {
  const trimmed = text?.trim().slice(0, MARKER_DESCRIPTION_MAX)
  return trimmed ? trimmed : undefined
}

/** `point` with `description` as its label; a blank one deletes the label. */
export function withDescription(point: SurfacePoint, description: string | undefined): SurfacePoint {
  const { label: _old, ...rest } = point
  const label = markerDescription(description)
  return label === undefined ? rest : { ...rest, label }
}

/** Unique within a session; markers are not persisted. */
let nextMarkerId = 1

/**
 * The markers with a new one at `point`, described. Elevation is
 * UNAVAILABLE until a terrain lookup exists.
 */
export function withNewMarker(
  markers: SurfacePoint[],
  point: MarsCoordinate,
  description: string | undefined,
): SurfacePoint[] {
  const marker: SurfacePoint = {
    id: `marker-${nextMarkerId++}`,
    coordinate: point,
    // Not read for a marked point; the point menu reads the height when the point is selected.
    elevationMeters: unavailable('Not read for marked points. In close-up, the point menu shows the height at the selected point'),
  }
  return [...markers, withDescription(marker, description)]
}

/** The markers without `id`; the same array for an unknown id. */
export function withoutMarker(markers: SurfacePoint[], id: string): SurfacePoint[] {
  return markers.some((m) => m.id === id) ? markers.filter((m) => m.id !== id) : markers
}

/** The markers with `id` described; the same array for an unknown id. */
export function describeMarker(
  markers: SurfacePoint[],
  id: string,
  description: string,
): SurfacePoint[] {
  return markers.some((m) => m.id === id)
    ? markers.map((m) => (m.id === id ? withDescription(m, description) : m))
    : markers
}
