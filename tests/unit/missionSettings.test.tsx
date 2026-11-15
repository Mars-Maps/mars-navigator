import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SUITED_SLOPE_LIMIT } from '../../src/domain'
import { MissionSettingsStep } from '../../src/features/mission-ui/walk/MissionSettingsStep'
import {
  DEFAULT_MISSION_SETTINGS,
  SAMPLE_MINUTES,
  SETTING_SPECS,
  clampSetting,
  formatDuration,
  formatSetting,
  settingsProblems,
  settingsValid,
  withSetting,
  type MissionSettings,
} from '../../src/features/mission-ui/walk/missionSettings'

const render = (settings: MissionSettings = DEFAULT_MISSION_SETTINGS) =>
  renderToStaticMarkup(<MissionSettingsStep settings={settings} onChange={() => {}} />)

describe('mission settings', () => {
  it('has four settings, each default inside its range and on its step', () => {
    expect(SETTING_SPECS.map((s) => s.key)).toEqual(['maxSlopeDeg', 'samples', 'energyKcal', 'durationMin'])
    for (const s of SETTING_SPECS) {
      expect(s.min).toBeLessThan(s.max)
      expect(clampSetting(s.key, s.default)).toBe(s.default)
      expect(DEFAULT_MISSION_SETTINGS[s.key]).toBe(s.default)
    }
  })

  it('takes the slope default and its citation from the cited limit; the rest say project choice', () => {
    const slope = SETTING_SPECS.find((s) => s.key === 'maxSlopeDeg')!
    expect(slope.default).toBe(SUITED_SLOPE_LIMIT.deg)
    expect(slope.source).toBe(SUITED_SLOPE_LIMIT.source)
    for (const s of SETTING_SPECS.filter((s) => s.key !== 'maxSlopeDeg')) {
      expect(s.source).toBeUndefined()
      expect(s.basis).toContain('project choice')
    }
  })

  it('clamps to the range, snaps to the step, and falls back to the default for no number', () => {
    expect(clampSetting('maxSlopeDeg', 99)).toBe(30)
    expect(clampSetting('maxSlopeDeg', -3)).toBe(5)
    expect(clampSetting('energyKcal', 623)).toBe(600)
    expect(clampSetting('energyKcal', 626)).toBe(650)
    expect(clampSetting('durationMin', 44)).toBe(45)
    expect(clampSetting('samples', Number.NaN)).toBe(DEFAULT_MISSION_SETTINGS.samples)
    expect(withSetting(DEFAULT_MISSION_SETTINGS, 'samples', 500)).toEqual({ ...DEFAULT_MISSION_SETTINGS, samples: 20 })
  })

  it('prints each value with its unit', () => {
    expect(formatSetting('maxSlopeDeg', 20)).toBe('20°')
    expect(formatSetting('samples', 6)).toBe('6')
    expect(formatSetting('energyKcal', 600)).toBe('600 kcal')
    expect(formatDuration(240)).toBe('4 h')
    expect(formatDuration(150)).toBe('2 h 30 min')
    expect(formatDuration(45)).toBe('45 min')
  })

  it('finds nothing wrong with the defaults', () => {
    expect(settingsProblems(DEFAULT_MISSION_SETTINGS)).toEqual({})
    expect(settingsValid(DEFAULT_MISSION_SETTINGS)).toBe(true)
  })

  it('says at the samples when collecting them takes the whole duration', () => {
    const samples = 30 / SAMPLE_MINUTES
    const full = { ...DEFAULT_MISSION_SETTINGS, samples, durationMin: 30 }
    expect(settingsProblems(full).samples).toContain(`${samples} samples at 5 min each take 30 min, which leaves no time to walk in 30 min`)
    expect(settingsValid(full)).toBe(false)
    const over = { ...DEFAULT_MISSION_SETTINGS, samples: 20, durationMin: 60 }
    expect(settingsProblems(over).samples).toContain('take 1 h 40 min')
    // One minute of walking left is not this check's business: the budget decides with a path.
    expect(settingsValid({ ...DEFAULT_MISSION_SETTINGS, samples: 5, durationMin: 30 })).toBe(true)
  })
})

describe('MissionSettingsStep', () => {
  it('draws four sliders with their ranges, values and labels', () => {
    const html = render()
    expect(html.match(/type="range"/g)).toHaveLength(4)
    for (const s of SETTING_SPECS) {
      expect(html).toContain(`>${s.label}</label>`)
      expect(html).toMatch(new RegExp(`min="${s.min}" max="${s.max}" step="${s.step}"[^>]*value="${s.default}"`))
    }
    expect(html).toContain('aria-valuetext="4 h"')
    expect(html).toContain('>600 kcal<')
  })

  it('says where each default comes from: the citation for the slope, project choice for the rest', () => {
    const html = render()
    expect(html).toContain('Default 20°: lunar xEVA figure, not a Mars requirement')
    expect(html).toContain('EVA-EXP-0075')
    expect(html.match(/: project choice/g)).toHaveLength(3)
    expect(html).toContain('Default 6: project choice, as is 5 min per sample')
    // One citation, so one mark: a project choice is not a classified value.
    expect(html.match(/<span class="sr-only">OFFICIAL<\/span>/g)).toHaveLength(1)
  })

  it('has Reset off at the defaults and on once a value differs', () => {
    expect(render()).toMatch(/<button type="button" disabled=""[^>]*>Reset<\/button>/)
    expect(render({ ...DEFAULT_MISSION_SETTINGS, samples: 3 })).toMatch(/<button type="button"(?! disabled)[^>]*>Reset<\/button>/)
  })

  it('says a combination that cannot work beside its slider', () => {
    const html = render({ ...DEFAULT_MISSION_SETTINGS, samples: 20, durationMin: 60 })
    expect(html).toContain('leaves no time to walk in 1 h')
    expect(html).toContain('aria-invalid="true"')
    // The slider is described by its note and by the problem.
    const problemId = html.match(/<p id="([^"]+-samples-problem)"/)![1]
    expect(html).toMatch(new RegExp(`aria-describedby="[^"]+-samples-note ${problemId}"`))
    expect(render()).not.toContain('-problem')
  })
})
