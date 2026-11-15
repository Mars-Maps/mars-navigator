import { DEFAULT_MISSION_SETTINGS, MISSION_SETTING_DEFAULTS, type MissionSettingKey, type MissionSettings } from '../../../domain'
import { SAMPLE_MINUTES } from '../../route-analysis/walkBudget'

/**
 * The mission settings sliders of Plan a walk. The settings and
 * their defaults are the walk contract's; this file holds only what
 * the sliders add: labels, ranges and steps.
 */
export type { MissionSettings }
export { DEFAULT_MISSION_SETTINGS }

export type SettingKey = MissionSettingKey

/** The walk budget's minutes per sample, a project choice: one figure for the sliders and the budget. */
export { SAMPLE_MINUTES }

export interface SettingSpec {
  key: SettingKey
  label: string
  min: number
  max: number
  step: number
  default: number
  /** What the default is, in a few words, shown under the slider. */
  basis: string
  /** The citation behind the default; absent for a project choice. */
  source?: string
}

/**
 * The four sliders. Each default, and what it is and where it comes from,
 * is the contract's `MISSION_SETTING_DEFAULTS` (only the slope is cited).
 * The ranges are the sliders' own and claim nothing.
 */
function slider(key: SettingKey, label: string, min: number, max: number, step: number): SettingSpec {
  const { value, basis, source } = MISSION_SETTING_DEFAULTS[key]
  return source === undefined
    ? { key, label, min, max, step, default: value, basis }
    : { key, label, min, max, step, default: value, basis, source }
}

const SPEC: Record<SettingKey, SettingSpec> = {
  maxSlopeDeg: slider('maxSlopeDeg', 'Max slope', 5, 30, 1),
  samples: slider('samples', 'Samples', 1, 20, 1),
  energyKcal: slider('energyKcal', 'Energy', 100, 2000, 50),
  durationMin: slider('durationMin', 'Duration', 30, 480, 15),
}

/** The sliders in the order the panel shows them. */
export const SETTING_SPECS: readonly SettingSpec[] = [SPEC.maxSlopeDeg, SPEC.samples, SPEC.energyKcal, SPEC.durationMin]

/** `value` kept inside the setting's range and on its step; the default for a value that is not a number. */
export function clampSetting(key: SettingKey, value: number): number {
  const { min, max, step, default: fallback } = SPEC[key]
  if (!Number.isFinite(value)) return fallback
  const stepped = min + Math.round((value - min) / step) * step
  return Math.min(max, Math.max(min, stepped))
}

/** `settings` with `key` set to `value`, clamped. */
export function withSetting(settings: MissionSettings, key: SettingKey, value: number): MissionSettings {
  return { ...settings, [key]: clampSetting(key, value) }
}

/** "4 h", "2 h 30 min", "45 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const min = minutes % 60
  if (h === 0) return `${min} min`
  return min === 0 ? `${h} h` : `${h} h ${min} min`
}

/** A setting's value as the panel prints it. */
export function formatSetting(key: SettingKey, value: number): string {
  if (key === 'maxSlopeDeg') return `${value}°`
  if (key === 'energyKcal') return `${value} kcal`
  if (key === 'durationMin') return formatDuration(value)
  return String(value)
}

/**
 * Why these settings cannot give a walk, by the slider to say it at; empty
 * when they can. Only what the settings alone decide: whether a walk fits
 * its energy and time is the budget's to say, once there is a path.
 */
export function settingsProblems(settings: MissionSettings): Partial<Record<SettingKey, string>> {
  const sampling = settings.samples * SAMPLE_MINUTES
  if (sampling < settings.durationMin) return {}
  const count = settings.samples === 1 ? '1 sample' : `${settings.samples} samples`
  return {
    samples: `${count} at ${SAMPLE_MINUTES} min each ${settings.samples === 1 ? 'takes' : 'take'} ${formatDuration(sampling)}, which leaves no time to walk in ${formatDuration(settings.durationMin)}. Fewer samples or a longer duration.`,
  }
}

/** Whether the planner can be asked with these settings. */
export function settingsValid(settings: MissionSettings): boolean {
  return Object.keys(settingsProblems(settings)).length === 0
}
