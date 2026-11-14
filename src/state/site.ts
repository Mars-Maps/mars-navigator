import { create } from 'zustand'
import type { Classified, MarsCoordinate, MissionSite } from '../domain'
import { useMissionStore } from './missionStore'

/**
 * The site the app is about and its landing ellipse. Its own store,
 * like the legends, so missionStore stays under the 500-line limit. The
 * shell sets the site at mount, with the camera altitude that frames it,
 * and the ellipse when its read lands; null means not set or not read yet,
 * and an UNAVAILABLE ellipse says why.
 */
export interface SiteState {
  site: MissionSite | null
  /** The height the camera flies to for the whole site, km; the shell computes it. */
  frameAltitudeKm: number | null
  ellipse: Classified<MarsCoordinate[]> | null
  setSite: (site: MissionSite, frameAltitudeKm: number) => void
  setEllipse: (ellipse: Classified<MarsCoordinate[]>) => void
  /**
   * Flies to the site from any view: one centre request at the framing
   * altitude, leaving welcome first if that is where the user is. Nothing
   * else flies there; a click on the welcome globe only leaves welcome.
   */
  goToSite: () => void
}

export const useSite = create<SiteState>()((set, get) => ({
  site: null,
  frameAltitudeKm: null,
  ellipse: null,
  setSite: (site, frameAltitudeKm) => set({ site, frameAltitudeKm }),
  setEllipse: (ellipse) => set({ ellipse }),
  goToSite: () => {
    const { site, frameAltitudeKm } = get()
    if (!site) return
    const mission = useMissionStore.getState()
    if (mission.viewMode === 'welcome') mission.setViewMode('close-up')
    mission.requestCenter(site.centre, frameAltitudeKm ?? undefined)
  },
}))
