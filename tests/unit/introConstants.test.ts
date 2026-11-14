import { describe, expect, it } from 'vitest'
import { INTRO_CONSTANT_IDS, INTRO_CONSTANTS } from '../../src/app/introConstants'
import { MARS_CONSTANTS } from '../../src/data/constants/marsConstants'

describe('the intro card\'s figures', () => {
  it('are the four of the intro design, in its order', () => {
    expect(Object.keys(INTRO_CONSTANTS)).toEqual([
      'meanDistanceFromSunMillionKm',
      'solarDayHours',
      'meanSurfaceTemperatureK',
      'surfaceGravityMps2',
    ])
  })

  it('are the cited constants themselves, untouched', () => {
    for (const id of INTRO_CONSTANT_IDS) {
      expect(INTRO_CONSTANTS[id]).toBe(MARS_CONSTANTS[id])
    }
  })
})
