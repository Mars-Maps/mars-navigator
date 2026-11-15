import { describe, expect, it } from 'vitest'
import { stopsPhrase } from '../../src/features/mission-ui/walk/walkCardFigures'

const at = (latitude: number, longitudeEast: number) => ({ coordinate: { latitude, longitudeEast } })

describe('stopsPhrase', () => {
  it('counts every stop after the start on a walk that does not come back', () => {
    expect(stopsPhrase([at(18, 77), at(18.1, 77)])).toBe('the start and 1 stop')
    expect(stopsPhrase([at(18, 77), at(18.1, 77), at(18.2, 77)])).toBe('the start and 2 stops')
  })

  it('names the way back instead of counting it as a stop', () => {
    expect(stopsPhrase([at(18, 77), at(18.1, 77), at(18, 77)])).toBe('the start, 1 stop and the way back')
    expect(stopsPhrase([at(18, 77), at(18.1, 77), at(18.2, 77), at(18, 77)])).toBe('the start, 2 stops and the way back')
  })
})
