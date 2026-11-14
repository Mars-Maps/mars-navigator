import { useEffect, useRef, useState } from 'react'
import { geologicUnitAreas } from '../data/adapters/GeologyAdapter'
import { unavailable, type Classified, type GeologicUnitArea, type SiteBounds } from '../domain'
import { GEOLOGY_LOADING_REASON } from '../features/mars-3d/geologyLabel'
import { useMissionStore } from '../state'

const LOADING = unavailable<GeologicUnitArea[]>(GEOLOGY_LOADING_REASON)

/**
 * The detailed geologic units over the site, read the first
 * time the geology layer is chosen and kept from then on, so the first
 * load stays free of them. A read abandoned on unmount writes nothing; a
 * failed one is UNAVAILABLE with the adapter's reason, and is tried again
 * the next time the layer is chosen.
 */
export function useGeologicUnits(bounds: SiteBounds): Classified<GeologicUnitArea[]> {
  const [units, setUnits] = useState<Classified<GeologicUnitArea[]>>(LOADING)
  // Set once the units arrive: a ref, so a failed answer does not re-run the read.
  const loaded = useRef(false)
  const active = useMissionStore((s) => s.activeLayerId === 'geology')
  useEffect(() => {
    if (!active || loaded.current) return
    const controller = new AbortController()
    geologicUnitAreas(bounds, controller.signal).then((answer) => {
      if (controller.signal.aborted) return
      loaded.current = answer.classification === 'OFFICIAL'
      setUnits(answer)
    })
    return () => controller.abort()
  }, [active, bounds])
  return units
}
