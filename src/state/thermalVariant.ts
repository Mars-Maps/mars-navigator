import { create } from 'zustand'

/**
 * What the thermal layer shows: one of the two THEMIS
 * mosaics, the TES thermal inertia grid, or the modelled surface
 * temperature at mission time.
 */
export type ThermalVariant = 'day' | 'night' | 'inertia' | 'temperature'

/** The variants drawn from the committed grids rather than Trek tiles. */
export function isGridVariant(variant: ThermalVariant): variant is 'inertia' | 'temperature' {
  return variant === 'inertia' || variant === 'temperature'
}

/** How far the temperature layer's model runs have got, for the settings panel; null when not running. */
export interface ThermalLayerProgress {
  done: number
  total: number
}

/**
 * The thermal layer's choice.
 * Its own store, as missionStore is near its 500-line limit. Only the user
 * sets the variant: the local-time hint beside the toggle never does. The
 * shell swaps the thermal layer's source by it, and reports the
 * temperature layer's progress here.
 */
export interface ThermalVariantState {
  thermalVariant: ThermalVariant
  setThermalVariant: (variant: ThermalVariant) => void
  layerProgress: ThermalLayerProgress | null
  setLayerProgress: (progress: ThermalLayerProgress | null) => void
}

export const useThermalVariant = create<ThermalVariantState>()((set) => ({
  thermalVariant: 'day',
  setThermalVariant: (variant) => set({ thermalVariant: variant }),
  layerProgress: null,
  setLayerProgress: (progress) => set({ layerProgress: progress }),
}))
