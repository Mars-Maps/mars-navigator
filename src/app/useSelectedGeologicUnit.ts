import { useEffect, useState } from 'react'
import { geologicUnitAt } from '../data/adapters/GeologyAdapter'
import { unavailable, type Classified, type GeologicUnit, type MarsCoordinate } from '../domain'
import { useMissionStore } from '../state'

/** Reads the unit at a point; `geologicUnitAt` in the app, a fixture in tests. */
export type UnitReader = (point: MarsCoordinate, signal: AbortSignal) => Promise<Classified<GeologicUnit>>

/**
 * The unit at `point`, or null when the read was abandoned, so the
 * caller writes nothing. The adapter answers a failure as UNAVAILABLE with
 * its reason; a rejection is caught here as one too, never a nearest unit.
 */
export async function readUnitAt(
  point: MarsCoordinate,
  signal: AbortSignal,
  read: UnitReader = geologicUnitAt,
): Promise<Classified<GeologicUnit> | null> {
  const unit = await read(point, signal).catch(
    (e: unknown): Classified<GeologicUnit> =>
      unavailable(`The geologic unit read failed: ${e instanceof Error ? e.message : String(e)}`),
  )
  return signal.aborted ? null : unit
}

/**
 * The selected point's geologic unit for the point menu: one read
 * per selection, as `useSelectedShielding` reads the height.
 */
export function useSelectedGeologicUnit(): Classified<GeologicUnit> | null {
  return useGeologicUnitAt(useMissionStore((s) => s.selectedPoint))
}

/**
 * The geologic unit at `point`: the point menu's read, also the stop
 * card's on a followed route. null with no point and while the read
 * is out; a read abandoned by a new point writes nothing, and a previous
 * point's unit never shows under a new one.
 */
export function useGeologicUnitAt(point: MarsCoordinate | null): Classified<GeologicUnit> | null {
  const [read, setRead] = useState<{ at: MarsCoordinate; unit: Classified<GeologicUnit> } | null>(null)
  useEffect(() => {
    if (!point) return
    const controller = new AbortController()
    readUnitAt(point, controller.signal).then((unit) => {
      if (unit !== null) setRead({ at: point, unit })
    })
    return () => controller.abort()
  }, [point])
  return point !== null && read?.at === point ? read.unit : null
}
