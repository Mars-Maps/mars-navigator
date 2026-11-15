import { useId } from 'react'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import {
  DEFAULT_MISSION_SETTINGS,
  SAMPLE_MINUTES,
  SETTING_SPECS,
  formatSetting,
  settingsProblems,
  withSetting,
  type MissionSettings,
} from './missionSettings'

/**
 * Step 2 of Plan a walk: the mission's limits as four sliders, each
 * with its value, its range and where its default comes from, a citation or
 * the words "project choice". Renders from props; the shell holds the
 * settings and hands them to the planner.
 */
export function MissionSettingsStep({
  settings,
  onChange,
}: {
  settings: MissionSettings
  onChange: (settings: MissionSettings) => void
}) {
  const id = useId()
  const problems = settingsProblems(settings)
  const atDefaults = SETTING_SPECS.every((s) => settings[s.key] === s.default)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-caption text-ink-subtle">Mission settings</legend>
      {SETTING_SPECS.map((spec) => {
        const value = settings[spec.key]
        const problem = problems[spec.key]
        return (
          <div key={spec.key}>
            <div className="mb-1 flex items-baseline justify-between">
              <label htmlFor={`${id}-${spec.key}`} className="text-micro uppercase text-ink-subtle">
                {spec.label}
              </label>
              <span className="text-caption tabular-nums text-ink">{formatSetting(spec.key, value)}</span>
            </div>
            <input
              id={`${id}-${spec.key}`}
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={value}
              aria-valuetext={formatSetting(spec.key, value)}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-${spec.key}-note ${id}-${spec.key}-problem` : `${id}-${spec.key}-note`}
              onChange={(e) => onChange(withSetting(settings, spec.key, Number(e.target.value)))}
              className="w-full accent-accent"
            />
            <p id={`${id}-${spec.key}-note`} className="flex items-start gap-1.5 text-caption text-ink-muted">
              <span>
                {formatSetting(spec.key, spec.min)} to {formatSetting(spec.key, spec.max)}. Default{' '}
                {formatSetting(spec.key, spec.default)}: {spec.basis}
                {spec.key === 'samples' && `, as is ${SAMPLE_MINUTES} min per sample`}
              </span>
              {spec.source && <ClassificationBadge classification="OFFICIAL" detail={spec.source} />}
            </p>
            {/* Tied to the slider, not an alert: its words change on every step of a drag. */}
            {problem && (
              <p id={`${id}-${spec.key}-problem`} className="text-caption text-danger">
                {problem}
              </p>
            )}
          </div>
        )
      })}
      <button
        type="button"
        disabled={atDefaults}
        onClick={() => onChange(DEFAULT_MISSION_SETTINGS)}
        className="self-start rounded-control border border-line px-3 py-1 text-body text-ink transition-colors duration-(--duration-fast) hover:bg-surface-raised disabled:cursor-not-allowed disabled:text-ink-subtle/60"
      >
        Reset
      </button>
    </fieldset>
  )
}
