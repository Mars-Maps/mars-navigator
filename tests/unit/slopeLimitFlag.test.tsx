import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SUITED_SLOPE_LIMIT, derived, type SlopeLimit } from '../../src/domain'
import { SlopeLimitFlag } from '../../src/features/mission-ui/SlopeLimitFlag'
import { isCitedSlopeLimit } from '../../src/features/mission-ui/slopeLimit'

// A limit as the mission settings' slider makes one (`slopeLimitOf` in the shell).
const OWN: SlopeLimit = { deg: 10, label: 'set in the mission settings, not a cited figure', source: 'Plan a walk mission settings' }
const steep = derived(14, 'fixture')

describe('SlopeLimitFlag', () => {
  it('marks the cited suited limit OFFICIAL with its citation', () => {
    const html = renderToStaticMarkup(<SlopeLimitFlag slope={derived(23, 'fixture')} limit={SUITED_SLOPE_LIMIT} />)
    expect(html).toContain('Over the 20° limit')
    expect(html).toContain('OFFICIAL')
    expect(html).toContain('NASA EVA-EXP-0075')
  })

  it('gives a limit set in the settings no OFFICIAL mark, and says in words what it is', () => {
    const html = renderToStaticMarkup(<SlopeLimitFlag slope={steep} limit={OWN} />)
    expect(html).toContain('Over the 10° limit: set in the mission settings, not a cited figure')
    expect(html).not.toContain('OFFICIAL')
  })

  it('reads a limit as cited only when it is the suited figure, number and citation', () => {
    expect(isCitedSlopeLimit(SUITED_SLOPE_LIMIT)).toBe(true)
    expect(isCitedSlopeLimit(OWN)).toBe(false)
    expect(isCitedSlopeLimit({ ...OWN, deg: 20 })).toBe(false)
  })
})
