import { create } from 'zustand'
import type { Classified, LegendEntry, MapLayerId } from '../domain'

/**
 * The categorical legends the shell has read from their producers,
 * by layer. Its own store, like the measure points, so missionStore stays
 * under the 500-line limit. A layer absent here is still being read; an
 * UNAVAILABLE entry says why its official legend could not be shown.
 */
export interface LayerLegendsState {
  byLayer: Partial<Record<MapLayerId, Classified<LegendEntry[]>>>
  setLayerLegend: (id: MapLayerId, legend: Classified<LegendEntry[]>) => void
}

export const useLayerLegends = create<LayerLegendsState>()((set) => ({
  byLayer: {},
  setLayerLegend: (id, legend) => set((s) => ({ byLayer: { ...s.byLayer, [id]: legend } })),
}))
