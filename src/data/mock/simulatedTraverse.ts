/**
 * SIMULATED DATA — NOT REAL.
 *
 * Invented for development before the official dataset is released
 * (2026-10-28). These coordinates do not represent any real mission, rover,
 * landing site or measurement, and must never be presented as if they did.
 *
 * The shape here is deliberately NOT our domain model: snake_case keys, nulls
 * for missing values, and longitude as ±180. External data arrives in whatever
 * shape it wants; converting it is the adapter's job, not the application's.
 */

export interface SimulatedTraverseRecord {
  point_id: string
  lat_deg: number
  /** −180..180 here, on purpose. The adapter converts to 0..360 east. */
  lon_deg: number
  /** null means the value is genuinely missing, not zero. */
  elev_m: number | null
  note?: string
}

export const SIMULATED_TRAVERSE: SimulatedTraverseRecord[] = [
  { point_id: 'sim-01', lat_deg: -4.5, lon_deg: 137.4, elev_m: -4500, note: 'Simulated start' },
  { point_id: 'sim-02', lat_deg: -4.52, lon_deg: 137.44, elev_m: -4480 },
  { point_id: 'sim-03', lat_deg: -4.56, lon_deg: 137.49, elev_m: null, note: 'Elevation missing on purpose' },
  { point_id: 'sim-04', lat_deg: -4.61, lon_deg: 137.53, elev_m: -4395 },
  { point_id: 'sim-05', lat_deg: -4.64, lon_deg: 137.61, elev_m: -4350, note: 'Simulated end' },
]
