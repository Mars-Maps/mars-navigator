import { useEffect, useMemo, useRef, useState } from 'react'
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
  // The selected point while it is inside Gale: each new one is a new reason to read the feed.
  const galePoint = useMissionStore((s) =>
    s.selectedPoint !== null && insideBounds(s.selectedPoint, GALE_BOUNDS) ? s.selectedPoint : null,
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
  // Whether the feed is in hand, and the read under way, kept out of the
  // effect's dependencies: a failed read stores a new UNAVAILABLE answer, and
  // depending on that answer would start the next read at once, for as long
  // as the feed fails. Another Gale point leaves a read under way alone.
  const galeRead = useRef<{ loaded: boolean; running: AbortController | null }>({ loaded: false, running: null })
  useEffect(() => {
    const read = galeRead.current
    if (!galePoint) {
      read.running?.abort()
      read.running = null
      return
    }
    if (read.loaded || read.running) return
    const controller = new AbortController()
    read.running = controller
    loadRemsFeed(controller.signal).then((feed) => {
      if (controller.signal.aborted) return
      read.running = null
      if (feed.classification === 'OFFICIAL') read.loaded = true
      setGale(feed)
    })
  }, [galePoint])
  useEffect(() => {
    const read = galeRead.current
    return () => {
      read.running?.abort()
      read.running = null
    }
  }, [])
  return useMemo(() => measuredTemperatureLookup({ jezero, gale }), [jezero, gale])
}
