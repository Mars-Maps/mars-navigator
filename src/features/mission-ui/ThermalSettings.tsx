import { ClassificationBadge } from '../../components/ClassificationBadge'
import type { Classified } from '../../domain'
import {
  useMissionStore,
  useMissionTime,
  useThermalVariant,
  type ThermalLayerProgress,
  type ThermalVariant,
} from '../../state'
import { ClassifiedValue } from './ClassifiedValue'
import { thermalLocalTime } from './thermalLocalTime'
import { formatHours } from './time/timeControls'

/** The four variants: two mosaics, the TES grid, the model. Labels short enough for one row. */
const VARIANTS: { id: ThermalVariant; label: string; title: string }[] = [
  { id: 'day', label: 'Day', title: 'THEMIS daytime infrared mosaic' },
  { id: 'night', label: 'Night', title: 'THEMIS night infrared mosaic' },
  { id: 'inertia', label: 'Thermal inertia', title: 'TES apparent thermal inertia, 0.5° cells' },
  { id: 'temperature', label: 'Temperature (modelled)', title: 'Modelled surface temperature at mission time: a model estimate, its error bound in the legend' },
]

/**
 * Why the season line is UNAVAILABLE: what a search for a seasonal map found.
 */
export const NO_SEASONAL_MAP_REASON =
  'No official seasonal surface-temperature map was found. The THEMIS ' +
  'mosaics are qualitative brightness, not temperature, and the seasonal maps ' +
  'that exist (MARSTHERM, KRC) are model output, not observations'

/**
 * The thermal layer's settings from the stores: the user's variant, the
 * temperature layer's progress, and the hint's mission time and view
 * centre. Mount it only while thermal is the layer, as it re-renders
 * with the clock.
 */
export function ThermalSettings() {
  const variant = useThermalVariant((s) => s.thermalVariant)
  const setVariant = useThermalVariant((s) => s.setThermalVariant)
  const progress = useThermalVariant((s) => s.layerProgress)
  const { solar } = useMissionTime()
  const centre = useMissionStore((s) => s.camera?.target ?? null)
  return (
    <ThermalSettingsView
      variant={variant}
      onSelect={setVariant}
      localTime={thermalLocalTime(solar, centre)}
      progress={progress}
    />
  )
}

/**
 * The thermal layer's settings, above its legend: the variant
 * switch, the temperature layer's progress while its model runs, the local
 * solar time at the view centre as a hint only, and a plain line that no
 * official seasonal map exists (the Temperature variant is this project's
 * model). Prop-driven: the user alone picks the variant, and nothing here
 * switches it.
 */
export function ThermalSettingsView({
  variant,
  onSelect,
  localTime,
  progress = null,
}: {
  variant: ThermalVariant
  onSelect: (variant: ThermalVariant) => void
  /** Local true solar time at the view centre, hours (`thermalLocalTime`). */
  localTime: Classified<number>
  /** The temperature layer's model runs so far; null when none are running. */
  progress?: ThermalLayerProgress | null
}) {
  return (
    <section aria-label="Thermal settings" className="mb-4">
      <div role="group" aria-label="Thermal layer variant" className="grid grid-cols-2 gap-1">
        {VARIANTS.map((v) => {
          const selected = v.id === variant
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={selected}
              title={v.title}
              onClick={() => onSelect(v.id)}
              className={`rounded-control border px-2 py-1 text-body transition-colors duration-(--duration-fast) ${
                selected
                  ? 'border-accent text-accent'
                  : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
              }`}
            >
              {v.label}
            </button>
          )
        })}
      </div>

      {/* Mounted before it has words, so a screen reader announces the first one too. */}
      <p role="status" className={progress === null ? 'sr-only' : 'mt-2 text-caption text-ink-muted'}>
        {progress !== null && (
          <span data-thermal-progress="">
            {progress.total > 0
              ? `Running the temperature model: ${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')} runs`
              : 'Reading the TES grids…'}
          </span>
        )}
      </p>

      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-caption text-ink-subtle">
        Local time at view centre:
        <ClassifiedValue value={localTime} format={formatHours} />
      </p>
      <p className="text-caption text-ink-subtle">A hint only: the variant never switches by itself.</p>

      <p className="mt-2 flex items-start gap-1.5 text-caption text-ink-subtle">
        <span>No official seasonal surface-temperature map was found.</span>
        <ClassificationBadge classification="UNAVAILABLE" detail={NO_SEASONAL_MAP_REASON} />
      </p>
    </section>
  )
}
