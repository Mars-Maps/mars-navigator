import { useEffect, useMemo, useState } from 'react'
import { loadMedaJezero, type MedaExtract } from '../data/temperature/medaJezero'
import { GALE_BOUNDS, measuredTemperatureLookup } from '../data/temperature/measuredTemperature'
import { loadRemsFeed, type RemsSolRecord } from '../data/temperature/remsGaleFeed'
import { insideBounds, type Classified, type MeasuredTemperatureLookup } from '../domain'
import { useMissionStore } from '../state'

/**
 * The measured ground temperatures the point menu shows. The
 * Perseverance MEDA extract (its own chunk) is read at mount: the app opens
 * on Jezero. The Curiosity REMS feed is 1.7 MB for one row at Gale, so it
 * is read only once a point inside Gale is selected, and kept from then
 * on; a read abandoned on unmount or by leaving Gale writes nothing, and
 * a failed read is tried again the next time a Gale point is selected.
 * The lookup answers while either is still loading, with the reason.
 */
export function useMeasuredTemperature(): MeasuredTemperatureLookup {
  const [jezero, setJezero] = useState<Classified<MedaExtract> | null>(null)
  const [gale, setGale] = useState<Classified<RemsSolRecord[]> | null>(null)
  const galeSelected = useMissionStore(
    (s) => s.selectedPoint !== null && insideBounds(s.selectedPoint, GALE_BOUNDS),
  )
  useEffect(() => {
    let cancelled = false
    loadMedaJezero().then((extract) => {
      if (!cancelled) setJezero(extract)
    })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    if (!galeSelected || gale?.classification === 'OFFICIAL') return
    const controller = new AbortController()
    loadRemsFeed(controller.signal).then((feed) => {
      if (!controller.signal.aborted) setGale(feed)
    })
    return () => controller.abort()
  }, [galeSelected, gale])
  return useMemo(() => measuredTemperatureLookup({ jezero, gale }), [jezero, gale])
}
