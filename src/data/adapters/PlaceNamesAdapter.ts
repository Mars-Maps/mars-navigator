import { isValidCoordinate, official, unavailable, type Classified, type MarsCoordinate } from '../../domain'
import marsNamesUrl from '../places/marsNames.json?url'

/**
 * Mars place names for Search & Go To: the USGS Gazetteer of
 * Planetary Nomenclature's centre points, names adopted by the IAU, as
 * committed by `scripts/build-mars-names.mjs`. The one reader of
 * `src/data/places/marsNames.json`; it is fetched as a static file (about
 * 40 kB compressed) the first time the tool is opened, never on first
 * load. The whole list is OFFICIAL with the Gazetteer's citation, or
 * UNAVAILABLE with the reason. A row that fails
 * validation makes the whole list unavailable, never a partial one.
 */
export interface PlaceName {
  /** The Gazetteer's feature id: planetarynames.wr.usgs.gov/Feature/<id>. */
  featureId: number
  name: string
  /** The feature type, singular: Crater, Vallis, Mons, Albedo Feature… */
  type: string
  /** The Gazetteer's centre, planetocentric, +East 0–360. */
  coordinate: MarsCoordinate
  /** null where the Gazetteer gives none. */
  diameterKm: number | null
}

const COLUMNS = ['name', 'type', 'latitude', 'longitudeEast', 'diameterKm', 'featureId'] as const

/** The committed extract into names, or why it cannot be read. */
export function parsePlaceNames(raw: unknown): Classified<PlaceName[]> {
  if (typeof raw !== 'object' || raw === null) return unavailable('Place names: the file is not an object')
  const { source, retrieved, columns, rows } = raw as Record<string, unknown>
  if (typeof source !== 'string' || typeof retrieved !== 'string') return unavailable('Place names: no source or date')
  if (!Array.isArray(columns) || columns.join() !== COLUMNS.join()) return unavailable('Place names: unexpected columns')
  if (!Array.isArray(rows) || rows.length === 0) return unavailable('Place names: no rows')
  const places: PlaceName[] = []
  // Feature id → the row it was read from. The extract repeats one row
  // exactly (Bohar, 16054); search keys results by id, so a repeat is
  // dropped. One id with two different rows is ambiguous: unavailable.
  const seen = new Map<number, string>()
  for (const row of rows) {
    const place = readRow(row)
    if (typeof place === 'string') return unavailable(`Place names: ${place}`)
    const text = JSON.stringify(row)
    const earlier = seen.get(place.featureId)
    if (earlier === text) continue
    if (earlier !== undefined) return unavailable(`Place names: feature ${place.featureId} has two different rows`)
    seen.set(place.featureId, text)
    places.push(place)
  }
  return official(places, `${source}; retrieved ${retrieved}`)
}

function readRow(row: unknown): PlaceName | string {
  if (!Array.isArray(row) || row.length !== COLUMNS.length) return `a row is not ${COLUMNS.length} columns`
  const [name, type, latitude, longitudeEast, diameterKm, featureId] = row as unknown[]
  if (typeof name !== 'string' || name === '' || typeof type !== 'string') return 'a row has no name or type'
  if (typeof latitude !== 'number' || typeof longitudeEast !== 'number') return `${name}: no centre`
  // A few albedo features give 360°E; the model's range is 0 ≤ lon < 360.
  const coordinate = { latitude, longitudeEast: longitudeEast === 360 ? 0 : longitudeEast }
  if (!isValidCoordinate(coordinate)) return `${name}: centre out of range`
  if (diameterKm !== null && !(typeof diameterKm === 'number' && diameterKm > 0)) return `${name}: bad diameter`
  if (typeof featureId !== 'number' || !Number.isInteger(featureId)) return `${name}: bad feature id`
  return { featureId, name, type, coordinate, diameterKm }
}

let loaded: Promise<Classified<PlaceName[]>> | null = null

/** Every adopted Mars name, read once per page; a failed read is tried again on the next call. */
export function loadPlaceNames(): Promise<Classified<PlaceName[]>> {
  loaded ??= fetch(marsNamesUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<unknown>
    })
    .then(parsePlaceNames)
    .then((names) => {
      if (names.classification === 'UNAVAILABLE') loaded = null
      return names
    })
    .catch((e: unknown) => {
      loaded = null
      return unavailable(`Place names failed to load: ${e instanceof Error ? e.message : String(e)}`)
    })
  return loaded
}
