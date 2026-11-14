import {
  MARS_MEAN_RADIUS_KM,
  formatMarsCoordinate,
  parseMarsCoordinate,
  type MarsCoordinate,
  type SurfacePoint,
} from '../../../domain'

/**
 * Search & Go To's matching: a typed coordinate, the user's marked
 * points, and the named places the shell passes in, best first. Pure; the
 * panel renders the results and the shell flies to the one chosen.
 */

/** A named place as the shell passes it: the Gazetteer's, through its adapter. */
export interface Place {
  featureId: number
  name: string
  type: string
  coordinate: MarsCoordinate
  diameterKm: number | null
}

export interface SearchResult {
  key: string
  kind: 'coordinate' | 'marker' | 'place'
  title: string
  /** The line under the title: type, size, coordinate. */
  detail: string
  coordinate: MarsCoordinate
  /** What Go to frames; null flies there at the current altitude. */
  diameterKm: number | null
}

/** How many rows the panel lists; it scrolls, and says when more match. */
export const MAX_RESULTS = 100

/** The filter's value for the user's marked points; every other value is a place type. */
export const MARKER_TYPE = 'Marked points'

/** All types, or one: a Gazetteer type ("Crater", "Patera"…) or `MARKER_TYPE`. */
export type TypeFilter = string | null

export interface SearchAnswer {
  /** Best first, at most `max`. */
  results: SearchResult[]
  /** Every match, of which `results` is the head. */
  total: number
}

/** Lower case, accents off, spaces collapsed: "Ḥellas" and "hellas" match. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** 0 exact, 1 prefix, 2 a word starts with it, 3 anywhere; null for no match. */
export function matchRank(name: string, query: string): number | null {
  const n = normalizeName(name)
  if (n === query) return 0
  if (n.startsWith(query)) return 1
  if (n.includes(` ${query}`) || n.includes(`-${query}`)) return 2
  if (n.includes(query)) return 3
  return null
}

/** The filter's choices: each place type with its count, most common first, then marked points if any. */
export function typeCounts(places: readonly Place[], markerCount: number): { type: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const p of places) counts.set(p.type, (counts.get(p.type) ?? 0) + 1)
  const out = [...counts].map(([type, count]) => ({ type, count }))
  out.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
  if (markerCount > 0) out.push({ type: MARKER_TYPE, count: markerCount })
  return out
}

/**
 * The matches for `query` within `type`. An empty query lists everything of
 * the chosen type, largest first, so a type can be browsed; with all types
 * and no query there is nothing to list.
 */
export function searchPlaces(
  query: string,
  places: readonly Place[],
  markers: readonly SurfacePoint[],
  type: TypeFilter = null,
  max = MAX_RESULTS,
): SearchAnswer {
  const q = normalizeName(query)
  if (q === '' && type === null) return { results: [], total: 0 }
  const rankOf = (name: string | undefined) => (q === '' ? 0 : name ? matchRank(name, q) : null)
  const out: SearchResult[] = []

  const parsed = q === '' || type !== null ? null : parseMarsCoordinate(query)
  if (parsed?.ok) {
    const text = formatMarsCoordinate(parsed.coordinate)
    out.push({
      key: `xy:${text}`,
      kind: 'coordinate',
      title: text,
      detail: 'Typed coordinate',
      coordinate: parsed.coordinate,
      diameterKm: null,
    })
  }

  const ranked: { rank: number; size: number; result: SearchResult }[] = []
  if (type === null || type === MARKER_TYPE) {
    for (const m of markers) {
      const rank = rankOf(m.label)
      if (rank === null) continue
      ranked.push({
        // Markers first among equal matches: they are the user's own.
        rank,
        size: Number.POSITIVE_INFINITY,
        result: {
          key: `marker:${m.id}`,
          kind: 'marker',
          title: m.label ?? 'Unnamed point',
          detail: `Marked point · ${formatMarsCoordinate(m.coordinate)}`,
          coordinate: m.coordinate,
          diameterKm: null,
        },
      })
    }
  }
  if (type !== MARKER_TYPE) {
    for (const p of places) {
      if (type !== null && p.type !== type) continue
      const rank = rankOf(p.name)
      if (rank === null) continue
      ranked.push({ rank, size: p.diameterKm ?? 0, result: placeResult(p) })
    }
  }
  // Better match first; then the larger feature, as the one more likely meant.
  ranked.sort((a, b) => a.rank - b.rank || b.size - a.size || a.result.title.localeCompare(b.result.title))
  for (const r of ranked) {
    if (out.length >= max) break
    out.push(r.result)
  }
  return { results: out, total: ranked.length + (parsed?.ok ? 1 : 0) }
}

/** The arc a feature spans, degrees, from its diameter: what Go to frames. */
export function featureSpanDeg(diameterKm: number): number {
  return (diameterKm / MARS_MEAN_RADIUS_KM) * (180 / Math.PI)
}

function placeResult(p: Place): SearchResult {
  const size = p.diameterKm === null ? '' : ` · ${formatKm(p.diameterKm)} across`
  return {
    key: `place:${p.featureId}`,
    kind: 'place',
    title: p.name,
    detail: `${p.type}${size} · ${formatMarsCoordinate(p.coordinate)}`,
    coordinate: p.coordinate,
    diameterKm: p.diameterKm,
  }
}

function formatKm(km: number): string {
  return km >= 100 ? `${Math.round(km).toLocaleString('en')} km` : `${km.toFixed(1)} km`
}
